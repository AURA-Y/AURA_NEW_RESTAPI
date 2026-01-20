import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GitHubService } from '../github.service';
import { GitHubProjectsService } from '../github-projects.service';
import {
  ActionItemParserService,
  ParsedActionItem,
} from './action-item-parser.service';
import { v4 as uuidv4 } from 'uuid';

/**
 * Issue 생성 결과
 */
export interface IssueCreationResult {
  actionItem: ParsedActionItem;
  status: 'CREATED' | 'FAILED' | 'SKIPPED';
  issueNumber?: number;
  issueUrl?: string;
  error?: string;
}

/**
 * Issues 일괄 생성 결과
 */
export interface BulkIssueCreationResult {
  total: number;
  created: number;
  failed: number;
  skipped: number;
  results: IssueCreationResult[];
}

/**
 * ActionItemService
 *
 * 회의록에서 액션 아이템을 추출하고 GitHub Issues로 생성하는 서비스
 *
 * 핵심 기능:
 * 1. getActionItemsPreview() - 액션 아이템 미리보기
 * 2. createIssuesFromActionItems() - Issues 일괄 생성
 * 3. getCreatedIssues() - 생성된 Issue 목록 조회
 */
@Injectable()
export class ActionItemService {
  private readonly logger = new Logger(ActionItemService.name);

  constructor(
    private prisma: PrismaService,
    private githubService: GitHubService,
    private githubProjectsService: GitHubProjectsService,
    private parserService: ActionItemParserService,
  ) {}

  /**
   * 액션 아이템 미리보기
   *
   * @param roomId - Room ID
   * @param markdownContent - 회의록 마크다운 내용 (S3에서 가져온)
   * @returns 파싱된 액션 아이템 목록
   */
  async getActionItemsPreview(
    roomId: string,
    markdownContent: string,
  ): Promise<{
    items: ParsedActionItem[];
    existingIssues: Map<string, { issueNumber: number; issueUrl: string }>;
  }> {
    const items = this.parserService.parse(markdownContent);

    // 이미 생성된 Issue 확인
    const existingIssues = await this.prisma.actionItemIssue.findMany({
      where: {
        roomId,
        issueState: 'CREATED',
      },
      select: {
        task: true,
        issueNumber: true,
        issueUrl: true,
      },
    });

    const existingMap = new Map<
      string,
      { issueNumber: number; issueUrl: string }
    >();
    for (const issue of existingIssues) {
      if (issue.issueNumber && issue.issueUrl) {
        existingMap.set(issue.task, {
          issueNumber: issue.issueNumber,
          issueUrl: issue.issueUrl,
        });
      }
    }

    return { items, existingIssues: existingMap };
  }

  /**
   * 액션 아이템에서 GitHub Issues 일괄 생성
   *
   * @param roomId - Room ID
   * @param reportId - Report ID
   * @param markdownContent - 회의록 마크다운 내용
   * @param channelId - Channel ID (GitHub 설정용)
   * @returns 생성 결과
   */
  async createIssuesFromActionItems(
    roomId: string,
    reportId: string,
    markdownContent: string,
    channelId: string,
  ): Promise<BulkIssueCreationResult> {
    const items = this.parserService.parse(markdownContent);

    if (items.length === 0) {
      return {
        total: 0,
        created: 0,
        failed: 0,
        skipped: 0,
        results: [],
      };
    }

    // GitHub 설정 조회
    const config = await this.githubService.resolveConfig(roomId);
    if (!config) {
      throw new NotFoundException('GitHub is not configured for this channel');
    }

    // Project 설정 조회
    const projectConfig = await this.getProjectConfig(channelId);

    const results: IssueCreationResult[] = [];

    for (const item of items) {
      const result = await this.createSingleIssue(
        roomId,
        reportId,
        channelId,
        item,
        config,
        projectConfig,
      );
      results.push(result);
    }

    const created = results.filter((r) => r.status === 'CREATED').length;
    const failed = results.filter((r) => r.status === 'FAILED').length;
    const skipped = results.filter((r) => r.status === 'SKIPPED').length;

    this.logger.log(
      `Created ${created} issues, ${failed} failed, ${skipped} skipped for room ${roomId}`,
    );

    return {
      total: items.length,
      created,
      failed,
      skipped,
      results,
    };
  }

  /**
   * 단일 액션 아이템에서 Issue 생성
   */
  private async createSingleIssue(
    roomId: string,
    reportId: string,
    channelId: string,
    item: ParsedActionItem,
    config: Awaited<ReturnType<typeof this.githubService.resolveConfig>>,
    projectConfig: { projectId: string | null; autoAddToProject: boolean } | null,
  ): Promise<IssueCreationResult> {
    try {
      // 중복 체크
      const existing = await this.prisma.actionItemIssue.findFirst({
        where: {
          reportId,
          task: item.task,
          issueState: 'CREATED',
        },
      });

      if (existing) {
        return {
          actionItem: item,
          status: 'SKIPPED',
          issueNumber: existing.issueNumber ?? undefined,
          issueUrl: existing.issueUrl ?? undefined,
        };
      }

      // GitHub username 매핑
      const githubUsername = await this.resolveGitHubUsername(
        channelId,
        item.assignee,
      );

      // Issue 제목 및 본문 생성
      const title = `[Action Item] ${item.task}`;
      const body = this.formatIssueBody(item, githubUsername);

      // Issue 생성
      const issueResult = await this.githubService.createIssue(
        config!,
        title,
        body,
        config!.labels,
      );

      // Assignee 할당 (GitHub username이 있는 경우)
      if (githubUsername) {
        try {
          await this.githubService.assignIssue(
            config!,
            issueResult.issueNumber,
            [githubUsername],
          );
        } catch (error) {
          this.logger.warn(
            `Failed to assign issue #${issueResult.issueNumber} to ${githubUsername}: ${error.message}`,
          );
        }
      }

      // Project에 Issue 추가 (설정된 경우)
      if (projectConfig?.projectId && projectConfig.autoAddToProject) {
        try {
          await this.githubProjectsService.addIssueToProject(
            channelId,
            projectConfig.projectId,
            issueResult.issueNumber,
            config!.owner,
            config!.repo,
          );
        } catch (error) {
          this.logger.warn(
            `Failed to add issue #${issueResult.issueNumber} to project: ${error.message}`,
          );
        }
      }

      // DB에 기록
      await this.prisma.actionItemIssue.upsert({
        where: {
          reportId_task: {
            reportId,
            task: item.task,
          },
        },
        create: {
          id: uuidv4(),
          reportId,
          roomId,
          assigneeNickName: item.assignee,
          githubUsername,
          task: item.task,
          dueDate: item.dueDate,
          issueNumber: issueResult.issueNumber,
          issueUrl: issueResult.issueUrl,
          issueState: 'CREATED',
        },
        update: {
          issueNumber: issueResult.issueNumber,
          issueUrl: issueResult.issueUrl,
          issueState: 'CREATED',
          updatedAt: new Date(),
        },
      });

      return {
        actionItem: item,
        status: 'CREATED',
        issueNumber: issueResult.issueNumber,
        issueUrl: issueResult.issueUrl,
      };
    } catch (error) {
      this.logger.error(
        `Failed to create issue for "${item.task}": ${error.message}`,
      );

      // 실패 기록
      await this.prisma.actionItemIssue.upsert({
        where: {
          reportId_task: {
            reportId,
            task: item.task,
          },
        },
        create: {
          id: uuidv4(),
          reportId,
          roomId,
          assigneeNickName: item.assignee,
          task: item.task,
          dueDate: item.dueDate,
          issueState: 'FAILED',
        },
        update: {
          issueState: 'FAILED',
          updatedAt: new Date(),
        },
      });

      return {
        actionItem: item,
        status: 'FAILED',
        error: error.message,
      };
    }
  }

  /**
   * AURA 닉네임으로 GitHub username 조회
   */
  private async resolveGitHubUsername(
    channelId: string,
    nickName: string,
  ): Promise<string | null> {
    // Channel 멤버 중에서 닉네임으로 찾기
    const member = await this.prisma.channelMember.findFirst({
      where: {
        channelId,
        User: {
          nickName: {
            equals: nickName,
            mode: 'insensitive', // 대소문자 무시
          },
        },
      },
      include: {
        User: {
          select: {
            githubUsername: true,
          },
        },
      },
    });

    return member?.User?.githubUsername ?? null;
  }

  /**
   * Project 설정 조회
   */
  private async getProjectConfig(
    channelId: string,
  ): Promise<{ projectId: string | null; autoAddToProject: boolean } | null> {
    const channel = await this.prisma.channel.findUnique({
      where: { channelId },
      select: {
        githubProjectId: true,
        githubAutoAddToProject: true,
      },
    });

    if (!channel?.githubProjectId) {
      return null;
    }

    return {
      projectId: channel.githubProjectId,
      autoAddToProject: channel.githubAutoAddToProject,
    };
  }

  /**
   * Issue 본문 포맷팅
   */
  private formatIssueBody(
    item: ParsedActionItem,
    githubUsername: string | null,
  ): string {
    const assigneeInfo = githubUsername
      ? `@${githubUsername} (${item.assignee})`
      : item.assignee;

    const dueDateInfo = item.dueDate ? item.dueDate : '미정';

    return `## 액션 아이템

| 항목 | 내용 |
|------|------|
| **담당자** | ${assigneeInfo} |
| **할 일** | ${item.task} |
| **기한** | ${dueDateInfo} |

---

<sub>이 이슈는 AURA 회의에서 자동 생성되었습니다.</sub>
`;
  }

  /**
   * 생성된 Issue 목록 조회
   */
  async getCreatedIssues(roomId: string): Promise<
    Array<{
      id: string;
      task: string;
      assigneeNickName: string;
      githubUsername: string | null;
      dueDate: string | null;
      issueNumber: number | null;
      issueUrl: string | null;
      issueState: string;
      createdAt: Date;
    }>
  > {
    const issues = await this.prisma.actionItemIssue.findMany({
      where: { roomId },
      orderBy: { createdAt: 'desc' },
    });

    return issues;
  }
}
