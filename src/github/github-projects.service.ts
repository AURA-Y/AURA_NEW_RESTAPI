import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../encryption/encryption.service';
import { GitHubAppService } from './github-app.service';

/**
 * GitHub Project v2 정보
 */
export interface GitHubProject {
  id: string; // node_id (GraphQL ID)
  number: number;
  title: string;
  url: string;
}

/**
 * GitHubProjectsService
 *
 * GitHub Projects v2 API (GraphQL) 연동 서비스
 *
 * 핵심 기능:
 * 1. listOwnerProjects() - Owner(Org/User)의 프로젝트 목록 조회
 * 2. createProject() - 새 프로젝트 생성
 * 3. addIssueToProject() - Issue를 프로젝트에 추가
 * 4. findOrCreateAuraProject() - AURA 프로젝트 찾기 또는 생성
 */
@Injectable()
export class GitHubProjectsService {
  private readonly logger = new Logger(GitHubProjectsService.name);

  constructor(
    private prisma: PrismaService,
    private encryptionService: EncryptionService,
    private githubAppService: GitHubAppService,
  ) {}

  /**
   * Owner가 Organization인지 User인지 자동 감지
   */
  private async isOrganization(
    octokit: Awaited<
      ReturnType<typeof this.githubAppService.getInstallationOctokit>
    >,
    owner: string,
  ): Promise<boolean> {
    try {
      // Organization 정보 조회 시도
      await octokit.rest.orgs.get({ org: owner });
      return true;
    } catch (error) {
      // 404면 User
      if (error.status === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Owner(Org/User)의 Projects v2 목록 조회
   *
   * @param channelId - Channel ID (설정에서 GitHub 인증 정보 획득)
   * @returns 프로젝트 목록
   */
  async listOwnerProjects(channelId: string): Promise<GitHubProject[]> {
    const channel = await this.prisma.channel.findUnique({
      where: { channelId },
      select: {
        githubAppId: true,
        githubPrivateKey: true,
        githubInstallationId: true,
        githubRepoOwner: true,
      },
    });

    if (!channel?.githubInstallationId || !channel.githubRepoOwner) {
      this.logger.warn(`Channel ${channelId} has no GitHub settings`);
      return [];
    }

    // Installation ID 복호화
    const installationId = parseInt(
      this.encryptionService.decrypt(channel.githubInstallationId),
      10,
    );

    // Private Key 복호화 (있는 경우)
    const privateKey = channel.githubPrivateKey
      ? this.encryptionService.decrypt(channel.githubPrivateKey)
      : undefined;

    const octokit = await this.githubAppService.getInstallationOctokit(
      installationId,
      channel.githubAppId ?? undefined,
      privateKey,
    );

    const owner = channel.githubRepoOwner;

    // Organization인지 User인지 자동 감지
    const isOrg = await this.isOrganization(octokit, owner);
    this.logger.debug(`Owner ${owner} is ${isOrg ? 'Organization' : 'User'}`);

    // GraphQL 쿼리
    const query = isOrg
      ? `
        query($login: String!, $first: Int!) {
          organization(login: $login) {
            projectsV2(first: $first) {
              nodes {
                id
                number
                title
                url
              }
            }
          }
        }
      `
      : `
        query($login: String!, $first: Int!) {
          user(login: $login) {
            projectsV2(first: $first) {
              nodes {
                id
                number
                title
                url
              }
            }
          }
        }
      `;

    try {
      const response = await octokit.graphql<{
        organization?: { projectsV2: { nodes: GitHubProject[] } };
        user?: { projectsV2: { nodes: GitHubProject[] } };
      }>(query, { login: owner, first: 20 });

      const projects = isOrg
        ? response.organization?.projectsV2.nodes
        : response.user?.projectsV2.nodes;

      this.logger.log(
        `Found ${projects?.length ?? 0} projects for ${owner} (${isOrg ? 'org' : 'user'})`,
      );

      return projects ?? [];
    } catch (error) {
      this.logger.error(`Failed to list projects: ${error.message}`);

      // 권한 문제일 경우 안내
      if (error.message?.includes('Resource not accessible')) {
        throw new Error(
          `GitHub App에 Projects 권한이 필요합니다. ` +
            `GitHub App 설정에서 ${isOrg ? 'Organization permissions → Projects' : 'Account permissions → Projects'} 를 ` +
            `"Read and write"로 설정해주세요.`,
        );
      }

      throw error;
    }
  }

  /**
   * 새 프로젝트 생성
   *
   * @param channelId - Channel ID
   * @param title - 프로젝트 제목
   * @returns 생성된 프로젝트 정보
   */
  async createProject(
    channelId: string,
    title: string,
  ): Promise<GitHubProject> {
    const channel = await this.prisma.channel.findUnique({
      where: { channelId },
      select: {
        githubAppId: true,
        githubPrivateKey: true,
        githubInstallationId: true,
        githubRepoOwner: true,
      },
    });

    if (!channel?.githubInstallationId || !channel.githubRepoOwner) {
      throw new Error('Channel has no GitHub settings');
    }

    const installationId = parseInt(
      this.encryptionService.decrypt(channel.githubInstallationId),
      10,
    );

    const privateKey = channel.githubPrivateKey
      ? this.encryptionService.decrypt(channel.githubPrivateKey)
      : undefined;

    const octokit = await this.githubAppService.getInstallationOctokit(
      installationId,
      channel.githubAppId ?? undefined,
      privateKey,
    );

    const owner = channel.githubRepoOwner;
    const isOrg = await this.isOrganization(octokit, owner);

    // Owner ID 조회
    const ownerIdQuery = isOrg
      ? `query($login: String!) { organization(login: $login) { id } }`
      : `query($login: String!) { user(login: $login) { id } }`;

    const ownerIdResponse = await octokit.graphql<{
      organization?: { id: string };
      user?: { id: string };
    }>(ownerIdQuery, { login: owner });

    const ownerId = isOrg
      ? ownerIdResponse.organization?.id
      : ownerIdResponse.user?.id;

    if (!ownerId) {
      throw new Error(`Failed to get owner ID for ${owner}`);
    }

    // 프로젝트 생성
    const createMutation = `
      mutation($ownerId: ID!, $title: String!) {
        createProjectV2(input: { ownerId: $ownerId, title: $title }) {
          projectV2 {
            id
            number
            title
            url
          }
        }
      }
    `;

    const createResponse = await octokit.graphql<{
      createProjectV2: { projectV2: GitHubProject };
    }>(createMutation, { ownerId, title });

    const project = createResponse.createProjectV2.projectV2;
    this.logger.log(`Created project: ${project.title} (${project.url})`);

    return project;
  }

  /**
   * Issue를 프로젝트에 추가
   *
   * @param channelId - Channel ID
   * @param projectId - 프로젝트 node_id
   * @param issueNumber - Issue 번호
   * @param owner - Repository owner
   * @param repo - Repository name
   * @returns 성공 여부
   */
  async addIssueToProject(
    channelId: string,
    projectId: string,
    issueNumber: number,
    owner: string,
    repo: string,
  ): Promise<boolean> {
    this.logger.log(
      `addIssueToProject called: channelId=${channelId}, projectId=${projectId}, issue=#${issueNumber}, repo=${owner}/${repo}`,
    );

    const channel = await this.prisma.channel.findUnique({
      where: { channelId },
      select: {
        githubAppId: true,
        githubPrivateKey: true,
        githubInstallationId: true,
      },
    });

    if (!channel?.githubInstallationId) {
      this.logger.warn(`Channel ${channelId} has no GitHub settings`);
      return false;
    }

    const installationId = parseInt(
      this.encryptionService.decrypt(channel.githubInstallationId),
      10,
    );

    const privateKey = channel.githubPrivateKey
      ? this.encryptionService.decrypt(channel.githubPrivateKey)
      : undefined;

    const octokit = await this.githubAppService.getInstallationOctokit(
      installationId,
      channel.githubAppId ?? undefined,
      privateKey,
    );

    // Issue의 node_id 조회
    const issueQuery = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          issue(number: $number) {
            id
          }
        }
      }
    `;

    try {
      this.logger.log(`Fetching issue node ID for #${issueNumber}...`);
      const issueResponse = await octokit.graphql<{
        repository: { issue: { id: string } };
      }>(issueQuery, { owner, repo, number: issueNumber });

      const issueNodeId = issueResponse.repository.issue.id;
      this.logger.log(`Issue node ID: ${issueNodeId}`);

      // 프로젝트에 추가
      const addMutation = `
        mutation($projectId: ID!, $contentId: ID!) {
          addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
            item {
              id
            }
          }
        }
      `;

      this.logger.log(
        `Executing addProjectV2ItemById mutation: projectId=${projectId}, contentId=${issueNodeId}`,
      );
      const mutationResult = await octokit.graphql(addMutation, {
        projectId,
        contentId: issueNodeId,
      });

      this.logger.log(
        `addProjectV2ItemById result: ${JSON.stringify(mutationResult)}`,
      );
      this.logger.log(
        `Successfully added issue #${issueNumber} to project ${projectId}`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to add issue to project: ${error.message}`,
      );
      return false;
    }
  }

  /**
   * AURA 프로젝트 찾기 또는 생성
   *
   * @param channelId - Channel ID
   * @returns 프로젝트 정보
   */
  async findOrCreateAuraProject(channelId: string): Promise<GitHubProject> {
    const projects = await this.listOwnerProjects(channelId);

    // "AURA Action Items" 프로젝트 찾기
    const auraProject = projects.find((p) =>
      p.title.includes('AURA'),
    );

    if (auraProject) {
      this.logger.log(`Found existing AURA project: ${auraProject.title}`);
      return auraProject;
    }

    // 없으면 생성
    return this.createProject(channelId, 'AURA Action Items');
  }

  /**
   * Channel의 프로젝트 설정 저장
   *
   * @param channelId - Channel ID
   * @param projectId - 프로젝트 node_id
   * @param autoAddToProject - 자동 프로젝트 배치 여부
   */
  async saveProjectSettings(
    channelId: string,
    projectId: string | null,
    autoAddToProject: boolean,
  ): Promise<void> {
    await this.prisma.channel.update({
      where: { channelId },
      data: {
        githubProjectId: projectId,
        githubAutoAddToProject: autoAddToProject,
      },
    });

    this.logger.log(
      `Saved project settings for Channel ${channelId}: projectId=${projectId}, autoAdd=${autoAddToProject}`,
    );
  }

  /**
   * Channel의 프로젝트 설정 조회
   *
   * @param channelId - Channel ID
   * @returns 프로젝트 설정
   */
  async getProjectSettings(channelId: string): Promise<{
    projectId: string | null;
    autoAddToProject: boolean;
  }> {
    const channel = await this.prisma.channel.findUnique({
      where: { channelId },
      select: {
        githubProjectId: true,
        githubAutoAddToProject: true,
      },
    });

    return {
      projectId: channel?.githubProjectId ?? null,
      autoAddToProject: channel?.githubAutoAddToProject ?? false,
    };
  }
}
