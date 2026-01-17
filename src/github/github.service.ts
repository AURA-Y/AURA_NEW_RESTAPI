import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../encryption/encryption.service';
import { GitHubAppService } from './github-app.service';
import {
  GitHubConfig,
  GitHubIssueResult,
  GitHubConnectionTestResult,
} from './interfaces/github-config.interface';

/**
 * GitHubService
 *
 * 역할: GitHub Issue 생성 및 설정 관리
 *
 * 핵심 기능:
 * 1. resolveConfig() - Room/Channel 설정에서 GitHub Config 도출
 * 2. createIssue() - GitHub Issue 생성
 * 3. testConnection() - GitHub 연결 테스트
 * 4. saveChannelSettings() - Channel GitHub 설정 저장
 * 5. saveRoomOverride() - Room 오버라이드 저장
 */
@Injectable()
export class GitHubService {
  private readonly logger = new Logger(GitHubService.name);

  constructor(
    private prisma: PrismaService,
    private encryptionService: EncryptionService,
    private githubAppService: GitHubAppService,
  ) {}

  /**
   * Room/Channel 설정에서 GitHub Config를 도출
   *
   * @param roomId - Room ID
   * @returns GitHub Config 또는 null (설정 안됨)
   *
   * 우선순위 로직:
   * 1. Room.githubRepoOverride가 있으면 → Room 설정 사용
   * 2. 없으면 → Channel 기본 설정 사용
   * 3. Channel 설정도 없으면 → null 반환
   *
   * 예시:
   * Channel: { repoOwner: "acme", repoName: "meetings", labels: ["meeting"] }
   * Room A: { repoOverride: null } → acme/meetings
   * Room B: { repoOverride: "acme/backend" } → acme/backend
   */
  async resolveConfig(roomId: string): Promise<GitHubConfig | null> {
    // Room과 Channel 함께 조회
    const room = await this.prisma.room.findUnique({
      where: { roomId },
      include: { channel: true },
    });

    if (!room) {
      throw new NotFoundException(`Room not found: ${roomId}`);
    }

    const channel = room.channel;

    // Channel에 GitHub 설정이 없으면 null
    if (!channel.githubInstallationId) {
      this.logger.debug(`Channel ${channel.channelId} has no GitHub settings`);
      return null;
    }

    // Installation ID 복호화
    let installationId: number;
    try {
      const decrypted = this.encryptionService.decrypt(
        channel.githubInstallationId,
      );
      installationId = parseInt(decrypted, 10);

      if (isNaN(installationId)) {
        throw new Error('Invalid Installation ID');
      }
    } catch (error) {
      this.logger.error(
        `Failed to decrypt Installation ID: ${error.message}`,
      );
      return null;
    }

    // Room 오버라이드 확인
    let owner: string;
    let repo: string;
    let labels: string[];

    if (room.githubRepoOverride) {
      // Room 오버라이드 사용
      const [overrideOwner, overrideRepo] = room.githubRepoOverride.split('/');
      owner = overrideOwner;
      repo = overrideRepo;

      // 라벨: Room 오버라이드가 있으면 Room 것, 없으면 Channel 것
      labels =
        room.githubLabelsOverride.length > 0
          ? room.githubLabelsOverride
          : channel.githubIssueLabels;

      this.logger.debug(
        `Using Room override: ${owner}/${repo} (Room: ${roomId})`,
      );
    } else {
      // Channel 기본 설정 사용
      if (!channel.githubRepoOwner || !channel.githubRepoName) {
        this.logger.debug(`Channel ${channel.channelId} has incomplete GitHub settings`);
        return null;
      }

      owner = channel.githubRepoOwner;
      repo = channel.githubRepoName;
      labels = channel.githubIssueLabels;

      this.logger.debug(
        `Using Channel default: ${owner}/${repo} (Channel: ${channel.channelId})`,
      );
    }

    return { installationId, owner, repo, labels };
  }

  /**
   * GitHub Issue 생성
   *
   * @param config - resolveConfig()에서 얻은 설정
   * @param title - Issue 제목
   * @param body - Issue 본문 (Markdown)
   * @param labels - 라벨 (선택, 없으면 config.labels 사용)
   * @returns Issue 번호와 URL
   *
   * Flow:
   * 1. GitHubAppService로 인증된 Octokit 획득
   * 2. GitHub API 호출: POST /repos/{owner}/{repo}/issues
   * 3. 응답에서 Issue 번호와 URL 추출
   */
  async createIssue(
    config: GitHubConfig,
    title: string,
    body: string,
    labels?: string[],
  ): Promise<GitHubIssueResult> {
    const octokit = await this.githubAppService.getInstallationOctokit(
      config.installationId,
    );

    const issueLabels = labels ?? config.labels;

    this.logger.log(
      `Creating issue in ${config.owner}/${config.repo}: "${title}"`,
    );

    const response = await octokit.rest.issues.create({
      owner: config.owner,
      repo: config.repo,
      title,
      body,
      labels: issueLabels.length > 0 ? issueLabels : undefined,
    });

    this.logger.log(
      `Issue created: #${response.data.number} (${response.data.html_url})`,
    );

    return {
      issueNumber: response.data.number,
      issueUrl: response.data.html_url,
      repository: `${config.owner}/${config.repo}`,
    };
  }

  /**
   * GitHub 연결 테스트
   *
   * @param installationId - Installation ID (평문)
   * @param owner - Repository Owner
   * @param repo - Repository 이름
   * @returns 테스트 결과
   *
   * 테스트 내용:
   * 1. Installation Token 발급 가능한지
   * 2. 해당 Repository에 접근 가능한지
   * 3. Issues 권한이 있는지
   */
  async testConnection(
    installationId: number,
    owner: string,
    repo: string,
  ): Promise<GitHubConnectionTestResult> {
    try {
      const octokit =
        await this.githubAppService.getInstallationOctokit(installationId);

      // Repository 정보 조회
      const { data: repoData } = await octokit.rest.repos.get({ owner, repo });

      // 권한 확인
      const permissions: string[] = [];
      if (repoData.permissions?.push) permissions.push('write');
      if (repoData.permissions?.pull) permissions.push('read');

      return {
        success: true,
        message: `Successfully connected to ${owner}/${repo}`,
        details: {
          repositoryName: repoData.full_name,
          repositoryUrl: repoData.html_url,
          permissions,
        },
      };
    } catch (error) {
      this.logger.error(`Connection test failed: ${error.message}`);

      let message = 'Connection failed';
      if (error.status === 404) {
        message = 'Repository not found or no access';
      } else if (error.status === 401) {
        message = 'Invalid Installation ID or App not installed';
      } else if (error.status === 403) {
        message = 'Insufficient permissions';
      }

      return {
        success: false,
        message,
      };
    }
  }

  /**
   * Channel GitHub 설정 저장
   *
   * @param channelId - Channel ID
   * @param installationId - Installation ID (평문, 암호화해서 저장)
   * @param repoOwner - Repository Owner
   * @param repoName - Repository 이름
   * @param labels - 라벨 배열
   * @param autoCreate - 자동 생성 여부
   */
  async saveChannelSettings(
    channelId: string,
    installationId: string,
    repoOwner: string,
    repoName: string,
    labels: string[],
    autoCreate: boolean,
  ): Promise<void> {
    // Installation ID 암호화
    const encryptedInstallationId =
      this.encryptionService.encrypt(installationId);

    await this.prisma.channel.update({
      where: { channelId },
      data: {
        githubInstallationId: encryptedInstallationId,
        githubRepoOwner: repoOwner,
        githubRepoName: repoName,
        githubIssueLabels: labels,
        githubAutoCreate: autoCreate,
      },
    });

    this.logger.log(
      `Saved GitHub settings for Channel ${channelId}: ${repoOwner}/${repoName}`,
    );
  }

  /**
   * Channel GitHub 설정 조회
   *
   * @param channelId - Channel ID
   * @returns 설정 정보 (Installation ID는 노출하지 않음)
   */
  async getChannelSettings(channelId: string): Promise<{
    isConnected: boolean;
    repoOwner?: string;
    repoName?: string;
    labels?: string[];
    autoCreate?: boolean;
  }> {
    const channel = await this.prisma.channel.findUnique({
      where: { channelId },
      select: {
        githubInstallationId: true,
        githubRepoOwner: true,
        githubRepoName: true,
        githubIssueLabels: true,
        githubAutoCreate: true,
      },
    });

    if (!channel || !channel.githubInstallationId) {
      return { isConnected: false };
    }

    return {
      isConnected: true,
      repoOwner: channel.githubRepoOwner ?? undefined,
      repoName: channel.githubRepoName ?? undefined,
      labels: channel.githubIssueLabels,
      autoCreate: channel.githubAutoCreate,
    };
  }

  /**
   * Channel GitHub 연동 해제
   *
   * @param channelId - Channel ID
   */
  async removeChannelSettings(channelId: string): Promise<void> {
    await this.prisma.channel.update({
      where: { channelId },
      data: {
        githubInstallationId: null,
        githubRepoOwner: null,
        githubRepoName: null,
        githubIssueLabels: [],
        githubAutoCreate: false,
      },
    });

    this.logger.log(`Removed GitHub settings for Channel ${channelId}`);
  }

  /**
   * Room GitHub 오버라이드 저장
   *
   * @param roomId - Room ID
   * @param repoOverride - "owner/repo" 형식 또는 null (해제)
   * @param labelsOverride - 라벨 배열
   */
  async saveRoomOverride(
    roomId: string,
    repoOverride: string | null,
    labelsOverride: string[],
  ): Promise<void> {
    await this.prisma.room.update({
      where: { roomId },
      data: {
        githubRepoOverride: repoOverride,
        githubLabelsOverride: labelsOverride,
      },
    });

    if (repoOverride) {
      this.logger.log(`Saved GitHub override for Room ${roomId}: ${repoOverride}`);
    } else {
      this.logger.log(`Cleared GitHub override for Room ${roomId}`);
    }
  }

  /**
   * Room GitHub 오버라이드 조회
   *
   * @param roomId - Room ID
   * @returns 오버라이드 정보 및 Channel 기본 설정
   */
  async getRoomOverride(roomId: string): Promise<{
    hasOverride: boolean;
    repoOverride?: string;
    labelsOverride?: string[];
    channelSettings?: {
      repoOwner: string;
      repoName: string;
      labels: string[];
    };
  }> {
    const room = await this.prisma.room.findUnique({
      where: { roomId },
      include: { channel: true },
    });

    if (!room) {
      throw new NotFoundException(`Room not found: ${roomId}`);
    }

    const result: {
      hasOverride: boolean;
      repoOverride?: string;
      labelsOverride?: string[];
      channelSettings?: {
        repoOwner: string;
        repoName: string;
        labels: string[];
      };
    } = {
      hasOverride: !!room.githubRepoOverride,
    };

    if (room.githubRepoOverride) {
      result.repoOverride = room.githubRepoOverride;
      result.labelsOverride = room.githubLabelsOverride;
    }

    // Channel 설정도 함께 반환 (참고용)
    if (room.channel.githubRepoOwner && room.channel.githubRepoName) {
      result.channelSettings = {
        repoOwner: room.channel.githubRepoOwner,
        repoName: room.channel.githubRepoName,
        labels: room.channel.githubIssueLabels,
      };
    }

    return result;
  }

  /**
   * 회의 요약을 GitHub Issue 본문 형식으로 변환
   *
   * @param topic - 회의 주제
   * @param attendees - 참석자 목록
   * @param summary - 회의 요약 내용
   * @param roomId - Room ID
   * @param createdAt - 회의 일시
   * @returns Markdown 형식의 Issue 본문
   */
  formatIssueBody(
    topic: string,
    attendees: string[],
    summary: string,
    roomId: string,
    createdAt: Date,
  ): string {
    const dateStr = createdAt.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    return `## 회의 정보

| 항목 | 내용 |
|------|------|
| **주제** | ${topic} |
| **일시** | ${dateStr} |
| **참석자** | ${attendees.join(', ') || '정보 없음'} |
| **회의 ID** | \`${roomId}\` |

---

## 회의 요약

${summary}

---

<sub>이 이슈는 AURA 회의 플랫폼에서 자동 생성되었습니다.</sub>
`;
  }
}
