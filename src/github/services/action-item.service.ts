import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GitHubService } from '../github.service';
import { ActionItemParserService } from './action-item-parser.service';
import {
  ActionItem,
  ReportData,
} from '../interfaces/action-item.interface';
import {
  CreateActionItemIssuesDto,
  CreateActionItemIssuesResponseDto,
  ActionItemIssueResultDto,
  ActionItemPreviewDto,
} from '../dto/action-item.dto';
import { GitHubConfig } from '../interfaces/github-config.interface';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { ActionItemIssue } from '../../../generated/prisma';

@Injectable()
export class ActionItemService {
  private readonly logger = new Logger(ActionItemService.name);
  private readonly s3Client: S3Client;

  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: ActionItemParserService,
    private readonly githubService: GitHubService,
  ) {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'ap-northeast-2',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID_S3 || process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY_S3 || process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
  }

  /**
   * 미리보기: 파싱 + GitHub 매핑 조회 (Issue 생성 없음)
   */
  async getPreview(roomId: string): Promise<ActionItemPreviewDto[]> {
    const report = await this.getReportData(roomId);
    const parsed = this.parser.parse(report.summary);

    if (parsed.items.length === 0) {
      return [];
    }

    const previews = await Promise.all(
      parsed.items.map(async (item) => {
        const mapping = await this.resolveGitHubUsername(item.assignee, report.channelId);
        return {
          assignee: item.assignee,
          task: item.task,
          dueDate: item.dueDate,
          userId: mapping.userId,
          githubUsername: mapping.githubUsername,
          canCreateIssue: !!mapping.githubUsername,
        };
      }),
    );

    return previews;
  }

  /**
   * 액션 아이템 → GitHub Issue 일괄 생성
   */
  async createIssuesFromReport(
    roomId: string,
    options?: CreateActionItemIssuesDto,
  ): Promise<CreateActionItemIssuesResponseDto> {
    // 1. 리포트 데이터 조회
    const report = await this.getReportData(roomId);

    // 2. 액션 아이템 파싱
    const parsed = this.parser.parse(report.summary);
    if (parsed.items.length === 0) {
      return this.emptyResponse(roomId, report);
    }

    // 3. GitHub 설정 조회
    const githubConfig = await this.githubService.resolveConfig(roomId);
    if (!githubConfig) {
      throw new BadRequestException('GitHub 연동이 설정되지 않았습니다.');
    }

    // 4. 제외 필터 적용
    let items = parsed.items;
    if (options?.excludeAssignees?.length) {
      items = items.filter((i) => !options.excludeAssignees!.includes(i.assignee));
    }

    // 5. Dry run 처리
    if (options?.dryRun) {
      return this.dryRunResponse(roomId, report, items);
    }

    // 6. 각 아이템에 대해 Issue 생성
    const results: ActionItemIssueResultDto[] = [];

    for (const item of items) {
      const result = await this.createSingleIssue(item, report, githubConfig);
      results.push(result);

      // Rate limiting 방지: 100ms 간격
      await this.delay(100);
    }

    this.logger.log(
      `Action Item Issues 생성 완료: ${results.filter((r) => r.state === 'CREATED').length}/${items.length}`,
    );

    return {
      roomId,
      reportId: report.reportId,
      meetingTitle: report.topic,
      totalItems: items.length,
      created: results.filter((r) => r.state === 'CREATED').length,
      failed: results.filter((r) => r.state === 'FAILED').length,
      skipped: results.filter((r) => r.state === 'SKIPPED').length,
      results,
    };
  }

  /**
   * 생성된 Issue 목록 조회
   */
  async getCreatedIssues(roomId: string): Promise<ActionItemIssue[]> {
    return this.prisma.actionItemIssue.findMany({
      where: { roomId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 단일 액션 아이템 Issue 생성
   */
  private async createSingleIssue(
    item: ActionItem,
    report: ReportData,
    config: GitHubConfig,
  ): Promise<ActionItemIssueResultDto> {
    // 1. 중복 체크
    const existing = await this.prisma.actionItemIssue.findUnique({
      where: {
        reportId_task: { reportId: report.reportId, task: item.task },
      },
    });

    if (existing?.issueState === 'CREATED') {
      return {
        assignee: item.assignee,
        task: item.task,
        githubUsername: existing.githubUsername,
        issueNumber: existing.issueNumber,
        issueUrl: existing.issueUrl,
        state: 'SKIPPED',
        error: '이미 생성된 Issue가 있습니다.',
      };
    }

    // 2. GitHub username 매핑
    const mapping = await this.resolveGitHubUsername(item.assignee, report.channelId);

    // 3. Issue 생성
    try {
      const title = `[Action Item] ${item.task}`;
      const body = this.formatIssueBody(item, report);
      const labels = ['action-item', ...(config.labels || [])];
      const assignees = mapping.githubUsername ? [mapping.githubUsername] : [];

      const issueResult = await this.githubService.createIssue(
        config,
        title,
        body,
        labels,
        assignees,
      );

      // 4. DB에 기록
      await this.prisma.actionItemIssue.upsert({
        where: {
          reportId_task: { reportId: report.reportId, task: item.task },
        },
        create: {
          reportId: report.reportId,
          roomId: report.roomId,
          assigneeNickName: item.assignee,
          assigneeUserId: mapping.userId,
          githubUsername: mapping.githubUsername,
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
        },
      });

      return {
        assignee: item.assignee,
        task: item.task,
        githubUsername: mapping.githubUsername,
        issueNumber: issueResult.issueNumber,
        issueUrl: issueResult.issueUrl,
        state: 'CREATED',
      };
    } catch (error) {
      this.logger.error(`Issue 생성 실패 (${item.assignee}): ${error.message}`);

      // 실패 기록
      await this.prisma.actionItemIssue.upsert({
        where: {
          reportId_task: { reportId: report.reportId, task: item.task },
        },
        create: {
          reportId: report.reportId,
          roomId: report.roomId,
          assigneeNickName: item.assignee,
          assigneeUserId: mapping.userId,
          githubUsername: mapping.githubUsername,
          task: item.task,
          dueDate: item.dueDate,
          issueState: 'FAILED',
        },
        update: { issueState: 'FAILED' },
      });

      return {
        assignee: item.assignee,
        task: item.task,
        githubUsername: mapping.githubUsername,
        issueNumber: null,
        issueUrl: null,
        state: 'FAILED',
        error: error.message,
      };
    }
  }

  /**
   * S3에서 리포트 데이터 조회
   */
  private async getReportData(roomId: string): Promise<ReportData> {
    // DB에서 RoomReport 조회
    const roomReport = await this.prisma.roomReport.findUnique({
      where: { roomId },
    });

    if (!roomReport) {
      throw new NotFoundException(`리포트를 찾을 수 없습니다: ${roomId}`);
    }

    // S3에서 전체 리포트 데이터 fetch
    const bucketName = process.env.AURA_S3_BUCKET || 'aura-raw-data-bucket';
    const jsonKey = `rooms/${roomId}/report.json`;

    try {
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: jsonKey,
      });

      const response = await this.s3Client.send(command);
      const bodyString = await response.Body?.transformToString();

      if (!bodyString) {
        throw new Error('S3 응답이 비어있습니다.');
      }

      const s3Data = JSON.parse(bodyString);

      // summary 가져오기: summaryUrl이 있으면 report.md에서 직접 읽기
      let summary = s3Data.summary || '';

      // summary가 비어있거나 URL인 경우, report.md에서 직접 읽기 시도
      if (!summary || summary.startsWith('http') || s3Data.summaryUrl) {
        try {
          const mdKey = `rooms/${roomId}/report.md`;
          const mdCommand = new GetObjectCommand({
            Bucket: bucketName,
            Key: mdKey,
          });
          const mdResponse = await this.s3Client.send(mdCommand);
          const mdContent = await mdResponse.Body?.transformToString();

          if (mdContent) {
            summary = mdContent;
            this.logger.debug(`report.md에서 summary 로드 완료: ${roomId}`);
          }
        } catch (mdError) {
          this.logger.warn(`report.md 읽기 실패 (${roomId}): ${mdError.message}`);
          // report.md가 없으면 기존 summary 유지
        }
      }

      return {
        reportId: s3Data.reportId || roomId,
        roomId: roomId,
        channelId: roomReport.channelId,
        topic: s3Data.topic || s3Data.meetingTitle || roomReport.topic,
        summary,
        attendees: s3Data.attendees || roomReport.attendees || [],
        startedAt: s3Data.startedAt || roomReport.startedAt?.toISOString() || '',
        createdAt: s3Data.createdAt || roomReport.createdAt.toISOString(),
      };
    } catch (error) {
      this.logger.error(`S3에서 리포트 조회 실패: ${error.message}`);

      // S3 실패 시 DB 데이터만으로 반환 (summary 없음)
      return {
        reportId: roomReport.reportId,
        roomId: roomId,
        channelId: roomReport.channelId,
        topic: roomReport.topic,
        summary: '',
        attendees: roomReport.attendees,
        startedAt: roomReport.startedAt?.toISOString() || '',
        createdAt: roomReport.createdAt.toISOString(),
      };
    }
  }

  /**
   * 닉네임 → GitHub username 매핑
   */
  private async resolveGitHubUsername(
    nickName: string,
    channelId: string,
  ): Promise<{ userId: string | null; githubUsername: string | null }> {
    // nickName으로 User 조회
    const user = await this.prisma.user.findFirst({
      where: { nickName },
      select: { userId: true, githubUsername: true, nickName: true },
    });

    if (!user) {
      this.logger.debug(`User not found for nickName: ${nickName}`);
      return { userId: null, githubUsername: null };
    }

    // 1순위: 명시적으로 연동된 GitHub username
    if (user.githubUsername) {
      return { userId: user.userId, githubUsername: user.githubUsername };
    }

    // 2순위: nickName을 GitHub username으로 시도 (fallback)
    this.logger.debug(`Using nickName as GitHub username fallback: ${nickName}`);
    return { userId: user.userId, githubUsername: user.nickName };
  }

  /**
   * Issue Body 포맷팅
   */
  private formatIssueBody(item: ActionItem, report: ReportData): string {
    const dateStr = this.formatDate(report.startedAt);

    return `## 📋 액션 아이템

**할 일:** ${item.task}

**담당자:** ${item.assignee}

**마감일:** ${item.dueDate || '미정'}

---

### 📍 회의 정보

| 항목 | 내용 |
|------|------|
| 회의 주제 | ${report.topic} |
| 회의 일시 | ${dateStr} |
| Room ID | \`${report.roomId}\` |

---

> 이 이슈는 [AURA](https://aura.ai.kr) 회의에서 자동 생성되었습니다.
`;
  }

  /**
   * 날짜 포맷팅
   */
  private formatDate(dateString: string): string {
    if (!dateString) return '정보 없음';

    try {
      const date = new Date(dateString);
      return date.toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateString;
    }
  }

  /**
   * 빈 응답 생성
   */
  private emptyResponse(
    roomId: string,
    report: ReportData,
  ): CreateActionItemIssuesResponseDto {
    return {
      roomId,
      reportId: report.reportId,
      meetingTitle: report.topic,
      totalItems: 0,
      created: 0,
      failed: 0,
      skipped: 0,
      results: [],
    };
  }

  /**
   * Dry run 응답 생성
   */
  private async dryRunResponse(
    roomId: string,
    report: ReportData,
    items: ActionItem[],
  ): Promise<CreateActionItemIssuesResponseDto> {
    const results = await Promise.all(
      items.map(async (item) => {
        const mapping = await this.resolveGitHubUsername(item.assignee, report.channelId);
        return {
          assignee: item.assignee,
          task: item.task,
          githubUsername: mapping.githubUsername,
          issueNumber: null,
          issueUrl: null,
          state: 'SKIPPED' as const,
          error: 'Dry run - Issue not created',
        };
      }),
    );

    return {
      roomId,
      reportId: report.reportId,
      meetingTitle: report.topic,
      totalItems: items.length,
      created: 0,
      failed: 0,
      skipped: items.length,
      results,
    };
  }

  /**
   * 지연 함수
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
