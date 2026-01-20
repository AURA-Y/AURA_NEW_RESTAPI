import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { GitHubService } from './github.service';
import { GitHubProjectsService } from './github-projects.service';
import { ActionItemService } from './services/action-item.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  UpdateChannelGitHubSettingsDto,
  UpdateRoomGitHubOverrideDto,
  ChannelGitHubSettingsResponseDto,
  RoomGitHubOverrideResponseDto,
} from './dto/github-settings.dto';
import {
  CreateGitHubIssueDto,
  CreateGitHubIssueResponseDto,
} from './dto/create-issue.dto';

/**
 * GitHubController
 *
 * GitHub Issue 연동 API 엔드포인트
 *
 * 엔드포인트:
 * - Channel 설정: GET/PUT/DELETE /github/channels/:channelId
 * - Room 오버라이드: GET/PUT/DELETE /github/rooms/:roomId
 * - Issue 생성: POST /github/rooms/:roomId/issues
 * - 연결 테스트: POST /github/test-connection
 */
@Controller('github')
@UseGuards(JwtAuthGuard)
export class GitHubController {
  constructor(
    private readonly githubService: GitHubService,
    private readonly githubProjectsService: GitHubProjectsService,
    private readonly actionItemService: ActionItemService,
  ) {}

  // ==========================================
  // Channel GitHub 설정 API
  // ==========================================

  /**
   * GET /github/channels/:channelId
   * Channel GitHub 설정 조회
   */
  @Get('channels/:channelId')
  async getChannelSettings(
    @Param('channelId') channelId: string,
  ): Promise<ChannelGitHubSettingsResponseDto> {
    return this.githubService.getChannelSettings(channelId);
  }

  /**
   * PUT /github/channels/:channelId
   * Channel GitHub 설정 저장
   *
   * Request Body (기본 App 사용):
   * {
   *   "installationId": "12345678",
   *   "repoOwner": "acme-org",
   *   "repoName": "meetings",
   *   "labels": ["meeting-summary"],
   *   "autoCreate": true
   * }
   *
   * Request Body (Channel별 독립 App 사용):
   * {
   *   "appId": "9876543",
   *   "privateKey": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----",
   *   "installationId": "12345678",
   *   "repoOwner": "acme-org",
   *   "repoName": "meetings",
   *   "labels": ["meeting-summary"],
   *   "autoCreate": true
   * }
   */
  @Put('channels/:channelId')
  @HttpCode(HttpStatus.OK)
  async updateChannelSettings(
    @Param('channelId') channelId: string,
    @Body() dto: UpdateChannelGitHubSettingsDto,
  ): Promise<{ success: boolean; message: string }> {
    await this.githubService.saveChannelSettings(
      channelId,
      dto.appId,
      dto.privateKey,
      dto.installationId,
      dto.repoOwner,
      dto.repoName,
      dto.labels ?? [],
      dto.autoCreate ?? false,
      dto.projectId,
      dto.autoAddToProject,
    );

    const appInfo = dto.appId ? ` (App ID: ${dto.appId})` : '';
    return {
      success: true,
      message: `GitHub settings saved for channel ${channelId}${appInfo}`,
    };
  }

  /**
   * DELETE /github/channels/:channelId
   * Channel GitHub 연동 해제
   */
  @Delete('channels/:channelId')
  @HttpCode(HttpStatus.OK)
  async removeChannelSettings(
    @Param('channelId') channelId: string,
  ): Promise<{ success: boolean; message: string }> {
    await this.githubService.removeChannelSettings(channelId);

    return {
      success: true,
      message: `GitHub settings removed from channel ${channelId}`,
    };
  }

  // ==========================================
  // Room GitHub 오버라이드 API
  // ==========================================

  /**
   * GET /github/rooms/:roomId
   * Room GitHub 오버라이드 조회
   */
  @Get('rooms/:roomId')
  async getRoomOverride(
    @Param('roomId') roomId: string,
  ): Promise<RoomGitHubOverrideResponseDto> {
    return this.githubService.getRoomOverride(roomId);
  }

  /**
   * PUT /github/rooms/:roomId
   * Room GitHub 오버라이드 설정
   *
   * Request Body:
   * {
   *   "repoOverride": "acme-org/backend",
   *   "labelsOverride": ["backend", "meeting"]
   * }
   */
  @Put('rooms/:roomId')
  @HttpCode(HttpStatus.OK)
  async updateRoomOverride(
    @Param('roomId') roomId: string,
    @Body() dto: UpdateRoomGitHubOverrideDto,
  ): Promise<{ success: boolean; message: string }> {
    await this.githubService.saveRoomOverride(
      roomId,
      dto.repoOverride ?? null,
      dto.labelsOverride ?? [],
    );

    return {
      success: true,
      message: dto.repoOverride
        ? `GitHub override set for room ${roomId}: ${dto.repoOverride}`
        : `GitHub override cleared for room ${roomId}`,
    };
  }

  /**
   * DELETE /github/rooms/:roomId
   * Room GitHub 오버라이드 해제
   */
  @Delete('rooms/:roomId')
  @HttpCode(HttpStatus.OK)
  async clearRoomOverride(
    @Param('roomId') roomId: string,
  ): Promise<{ success: boolean; message: string }> {
    await this.githubService.saveRoomOverride(roomId, null, []);

    return {
      success: true,
      message: `GitHub override cleared for room ${roomId}`,
    };
  }

  // ==========================================
  // Issue 생성 API
  // ==========================================

  /**
   * POST /github/rooms/:roomId/issues
   * GitHub Issue 수동 생성
   *
   * Request Body:
   * {
   *   "title": "[회의 요약] 스프린트 플래닝",
   *   "body": "## 회의 내용...",
   *   "labels": ["meeting-summary"],
   *   "repoOverride": "owner/repo" (선택사항)
   * }
   *
   * title, body가 없으면 roomId로 회의 정보 조회하여 자동 생성
   * repoOverride가 있으면 해당 Repository에 Issue 생성 (일회성)
   */
  @Post('rooms/:roomId/issues')
  async createIssue(
    @Param('roomId') roomId: string,
    @Body() dto: CreateGitHubIssueDto,
  ): Promise<CreateGitHubIssueResponseDto> {
    // Config 획득 (Room/Channel 설정에서 도출)
    const config = await this.githubService.resolveConfig(roomId);

    if (!config) {
      throw new BadRequestException(
        'GitHub is not configured for this room or channel',
      );
    }

    // repoOverride가 있으면 config의 owner/repo를 일회성 오버라이드
    if (dto.repoOverride) {
      const [overrideOwner, overrideRepo] = dto.repoOverride.split('/');
      if (overrideOwner && overrideRepo) {
        config.owner = overrideOwner;
        config.repo = overrideRepo;
      }
    }

    // 제목과 본문이 없으면 기본값 생성
    const title = dto.title ?? `[AURA 회의] Room ${roomId}`;
    const body =
      dto.body ??
      this.githubService.formatIssueBody(
        title,
        [],
        '회의 요약 내용이 제공되지 않았습니다.',
        roomId,
        new Date(),
      );

    // Issue 생성
    const result = await this.githubService.createIssue(
      config,
      title,
      body,
      dto.labels,
    );

    return {
      success: true,
      issueNumber: result.issueNumber,
      issueUrl: result.issueUrl,
      repository: result.repository,
    };
  }

  // ==========================================
  // Action Items API
  // ==========================================

  /**
   * GET /github/rooms/:roomId/action-items
   * 액션 아이템 미리보기
   *
   * Query Parameter:
   * - markdown: 회의록 마크다운 내용 (URL encoded)
   */
  @Post('rooms/:roomId/action-items/preview')
  @HttpCode(HttpStatus.OK)
  async getActionItemsPreview(
    @Param('roomId') roomId: string,
    @Body() body: { markdown: string },
  ): Promise<{
    items: Array<{
      assignee: string;
      task: string;
      dueDate: string | null;
      existingIssue?: { issueNumber: number; issueUrl: string };
    }>;
  }> {
    const { items, existingIssues } =
      await this.actionItemService.getActionItemsPreview(roomId, body.markdown);

    return {
      items: items.map((item) => ({
        ...item,
        existingIssue: existingIssues.get(item.task),
      })),
    };
  }

  /**
   * POST /github/rooms/:roomId/action-items/issues
   * 액션 아이템에서 GitHub Issues 일괄 생성
   */
  @Post('rooms/:roomId/action-items/issues')
  async createIssuesFromActionItems(
    @Param('roomId') roomId: string,
    @Body()
    body: {
      reportId: string;
      markdown: string;
      channelId: string;
    },
  ): Promise<{
    total: number;
    created: number;
    failed: number;
    skipped: number;
    results: Array<{
      task: string;
      assignee: string;
      status: 'CREATED' | 'FAILED' | 'SKIPPED';
      issueNumber?: number;
      issueUrl?: string;
      error?: string;
    }>;
  }> {
    if (!body.reportId || !body.markdown || !body.channelId) {
      throw new BadRequestException(
        'reportId, markdown, and channelId are required',
      );
    }

    const result = await this.actionItemService.createIssuesFromActionItems(
      roomId,
      body.reportId,
      body.markdown,
      body.channelId,
    );

    return {
      total: result.total,
      created: result.created,
      failed: result.failed,
      skipped: result.skipped,
      results: result.results.map((r) => ({
        task: r.actionItem.task,
        assignee: r.actionItem.assignee,
        status: r.status,
        issueNumber: r.issueNumber,
        issueUrl: r.issueUrl,
        error: r.error,
      })),
    };
  }

  /**
   * GET /github/rooms/:roomId/action-items/issues
   * 생성된 Issue 목록 조회
   */
  @Get('rooms/:roomId/action-items/issues')
  async getCreatedIssues(
    @Param('roomId') roomId: string,
  ): Promise<{
    issues: Array<{
      id: string;
      task: string;
      assigneeNickName: string;
      githubUsername: string | null;
      dueDate: string | null;
      issueNumber: number | null;
      issueUrl: string | null;
      issueState: string;
      createdAt: Date;
    }>;
  }> {
    const issues = await this.actionItemService.getCreatedIssues(roomId);
    return { issues };
  }

  // ==========================================
  // GitHub Projects API
  // ==========================================

  /**
   * GET /github/channels/:channelId/projects
   * Channel의 GitHub Projects 목록 조회
   */
  @Get('channels/:channelId/projects')
  async listProjects(
    @Param('channelId') channelId: string,
  ): Promise<{
    projects: Array<{
      id: string;
      number: number;
      title: string;
      url: string;
    }>;
  }> {
    const projects = await this.githubProjectsService.listOwnerProjects(channelId);
    return { projects };
  }

  /**
   * POST /github/channels/:channelId/projects
   * 새 GitHub Project 생성
   */
  @Post('channels/:channelId/projects')
  async createProject(
    @Param('channelId') channelId: string,
    @Body() body: { title: string },
  ): Promise<{
    project: {
      id: string;
      number: number;
      title: string;
      url: string;
    };
  }> {
    const project = await this.githubProjectsService.createProject(
      channelId,
      body.title,
    );
    return { project };
  }

  /**
   * POST /github/channels/:channelId/projects/aura
   * AURA 프로젝트 찾기 또는 생성
   */
  @Post('channels/:channelId/projects/aura')
  async findOrCreateAuraProject(
    @Param('channelId') channelId: string,
  ): Promise<{
    project: {
      id: string;
      number: number;
      title: string;
      url: string;
    };
  }> {
    const project = await this.githubProjectsService.findOrCreateAuraProject(channelId);
    return { project };
  }

  /**
   * PUT /github/channels/:channelId/project-settings
   * Channel의 프로젝트 설정 저장
   */
  @Put('channels/:channelId/project-settings')
  @HttpCode(HttpStatus.OK)
  async updateProjectSettings(
    @Param('channelId') channelId: string,
    @Body() body: { projectId: string | null; autoAddToProject: boolean },
  ): Promise<{ success: boolean; message: string }> {
    await this.githubProjectsService.saveProjectSettings(
      channelId,
      body.projectId,
      body.autoAddToProject,
    );
    return {
      success: true,
      message: `Project settings saved for channel ${channelId}`,
    };
  }

  /**
   * GET /github/channels/:channelId/project-settings
   * Channel의 프로젝트 설정 조회
   */
  @Get('channels/:channelId/project-settings')
  async getProjectSettings(
    @Param('channelId') channelId: string,
  ): Promise<{
    projectId: string | null;
    autoAddToProject: boolean;
  }> {
    return this.githubProjectsService.getProjectSettings(channelId);
  }

  // ==========================================
  // 연결 테스트 API
  // ==========================================

  /**
   * POST /github/test-connection
   * GitHub 연결 테스트
   *
   * Request Body (기본 App 사용):
   * {
   *   "installationId": "12345678",
   *   "repoOwner": "acme-org",
   *   "repoName": "meetings"
   * }
   *
   * Request Body (Channel별 독립 App 사용):
   * {
   *   "appId": "9876543",
   *   "privateKey": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----",
   *   "installationId": "12345678",
   *   "repoOwner": "acme-org",
   *   "repoName": "meetings"
   * }
   */
  @Post('test-connection')
  @HttpCode(HttpStatus.OK)
  async testConnection(
    @Body()
    body: {
      appId?: string;
      privateKey?: string;
      installationId: string;
      repoOwner: string;
      repoName: string;
    },
  ): Promise<{
    success: boolean;
    message: string;
    details?: {
      repositoryName: string;
      repositoryUrl: string;
      permissions: string[];
    };
  }> {
    const { appId, privateKey, installationId, repoOwner, repoName } = body;

    // 유효성 검사
    if (!installationId || !repoOwner || !repoName) {
      throw new BadRequestException(
        'installationId, repoOwner, and repoName are required',
      );
    }

    const installationIdNum = parseInt(installationId, 10);
    if (isNaN(installationIdNum)) {
      throw new BadRequestException('installationId must be a valid number');
    }

    return this.githubService.testConnection(
      appId,
      privateKey,
      installationIdNum,
      repoOwner,
      repoName,
    );
  }
}
