import { Injectable, Logger } from '@nestjs/common';
import { GitHubAppService } from '../github-app.service';

/**
 * GitHub Project 정보 인터페이스
 */
export interface GitHubProject {
  /** Project node ID (GraphQL ID) */
  id: string;
  /** Project number */
  number: number;
  /** Project 제목 */
  title: string;
  /** Project URL */
  url: string;
  /** 생성 시간 */
  createdAt: string;
  /** 업데이트 시간 */
  updatedAt: string;
  /** 공개 여부 */
  public: boolean;
}

/**
 * GitHub Project Item 추가 결과
 */
export interface AddToProjectResult {
  success: boolean;
  itemId?: string;
  projectUrl?: string;
  error?: string;
}

/**
 * GitHubProjectsService
 *
 * GitHub Projects v2 (GraphQL API) 연동 서비스
 *
 * 주요 기능:
 * 1. Repository에 연결된 프로젝트 목록 조회
 * 2. 새 프로젝트 생성
 * 3. Issue를 프로젝트에 추가
 */
@Injectable()
export class GitHubProjectsService {
  private readonly logger = new Logger(GitHubProjectsService.name);

  constructor(private readonly githubAppService: GitHubAppService) {}

  /**
   * Repository에 연결된 프로젝트 목록 조회
   *
   * @param installationId - Installation ID
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param appId - Channel별 App ID (선택)
   * @param privateKey - Channel별 Private Key (선택)
   * @returns 프로젝트 목록
   */
  async listRepositoryProjects(
    installationId: number,
    owner: string,
    repo: string,
    appId?: string,
    privateKey?: string,
  ): Promise<GitHubProject[]> {
    const octokit = await this.githubAppService.getInstallationOctokit(
      installationId,
      appId,
      privateKey,
    );

    try {
      // GraphQL로 repository에 연결된 projects 조회
      const query = `
        query($owner: String!, $repo: String!) {
          repository(owner: $owner, name: $repo) {
            projectsV2(first: 20) {
              nodes {
                id
                number
                title
                url
                createdAt
                updatedAt
                public
              }
            }
          }
        }
      `;

      const result: any = await octokit.graphql(query, { owner, repo });

      const projects: GitHubProject[] =
        result.repository?.projectsV2?.nodes?.map((node: any) => ({
          id: node.id,
          number: node.number,
          title: node.title,
          url: node.url,
          createdAt: node.createdAt,
          updatedAt: node.updatedAt,
          public: node.public,
        })) || [];

      this.logger.debug(
        `Found ${projects.length} projects for ${owner}/${repo}`,
      );

      return projects;
    } catch (error) {
      this.logger.error(`Failed to list projects: ${error.message}`);
      return [];
    }
  }

  /**
   * Owner가 Organization인지 User인지 확인
   */
  private async isOrganization(
    octokit: any,
    owner: string,
  ): Promise<boolean> {
    try {
      const query = `
        query($owner: String!) {
          organization(login: $owner) {
            id
          }
        }
      `;
      const result: any = await octokit.graphql(query, { owner });
      const isOrg = !!result.organization?.id;
      this.logger.debug(`isOrganization check for "${owner}": ${isOrg}`);
      return isOrg;
    } catch (error) {
      this.logger.debug(`isOrganization check for "${owner}": false (error: ${error.message})`);
      return false;
    }
  }

  /**
   * Organization 또는 User의 프로젝트 목록 조회
   *
   * GitHub App은 User projects에 직접 접근이 제한될 수 있으므로,
   * Organization이 아닌 경우 Repository 기반 프로젝트 조회로 fallback
   *
   * @param installationId - Installation ID
   * @param owner - Organization 또는 User name
   * @param isOrg - Organization 여부 (기본: null = 자동 감지)
   * @param appId - Channel별 App ID (선택)
   * @param privateKey - Channel별 Private Key (선택)
   * @param repo - Repository name (User인 경우 필요)
   * @returns 프로젝트 목록
   */
  async listOwnerProjects(
    installationId: number,
    owner: string,
    isOrg: boolean | null = null,
    appId?: string,
    privateKey?: string,
    repo?: string,
  ): Promise<GitHubProject[]> {
    const octokit = await this.githubAppService.getInstallationOctokit(
      installationId,
      appId,
      privateKey,
    );

    try {
      // isOrg가 null이면 자동 감지
      const isOrgActual = isOrg ?? await this.isOrganization(octokit, owner);

      this.logger.debug(`Owner "${owner}" is ${isOrgActual ? 'Organization' : 'User'}`);

      // Organization인 경우 organization.projectsV2 사용
      if (isOrgActual) {
        // 먼저 간단한 쿼리로 Organization 접근 테스트
        try {
          const testQuery = `
            query($owner: String!) {
              organization(login: $owner) {
                name
                login
              }
            }
          `;
          const testResult: any = await octokit.graphql(testQuery, { owner });
          this.logger.debug(`Organization test query success: ${testResult.organization?.name}`);
        } catch (testError) {
          this.logger.error(`Organization test query failed: ${testError.message}`);
        }

        // Projects v2 쿼리 (orderBy 제거하여 단순화)
        const query = `
          query($owner: String!) {
            organization(login: $owner) {
              projectsV2(first: 20) {
                nodes {
                  id
                  number
                  title
                  url
                  public
                }
              }
            }
          }
        `;

        this.logger.debug(`Executing organization projects query for ${owner}...`);

        const result: any = await octokit.graphql(query, { owner });

        this.logger.debug(`Organization projects query result:`, JSON.stringify(result, null, 2));

        const projects: GitHubProject[] =
          result.organization?.projectsV2?.nodes?.map((node: any) => ({
            id: node.id,
            number: node.number,
            title: node.title,
            url: node.url,
            createdAt: node.createdAt || new Date().toISOString(),
            updatedAt: node.updatedAt || new Date().toISOString(),
            public: node.public,
          })) || [];

        this.logger.log(`Found ${projects.length} projects for organization ${owner}`);
        return projects;
      }

      // User인 경우: REST API로 프로젝트 목록 조회 시도
      this.logger.debug(`Trying REST API for user ${owner} projects...`);

      try {
        // REST API를 통한 프로젝트 조회 (user projects)
        const response = await octokit.request('GET /users/{username}/projects', {
          username: owner,
          state: 'open',
          per_page: 20,
          headers: {
            'X-GitHub-Api-Version': '2022-11-28'
          }
        });

        // Projects (classic)는 projectsV2와 다른 형식이므로 변환 필요
        // Projects v2는 REST API로 직접 조회가 어려움
        this.logger.debug(`REST API returned ${response.data.length} classic projects`);
      } catch (restError) {
        this.logger.debug(`REST API failed: ${restError.message}`);
      }

      // GraphQL로 user의 프로젝트 조회 시도 (권한 있으면 작동)
      try {
        const userQuery = `
          query($owner: String!) {
            user(login: $owner) {
              projectsV2(first: 20, orderBy: {field: UPDATED_AT, direction: DESC}) {
                nodes {
                  id
                  number
                  title
                  url
                  createdAt
                  updatedAt
                  public
                }
              }
            }
          }
        `;

        const result: any = await octokit.graphql(userQuery, { owner });
        const projects: GitHubProject[] =
          result.user?.projectsV2?.nodes?.map((node: any) => ({
            id: node.id,
            number: node.number,
            title: node.title,
            url: node.url,
            createdAt: node.createdAt,
            updatedAt: node.updatedAt,
            public: node.public,
          })) || [];

        this.logger.log(`Found ${projects.length} projects for user ${owner}`);
        return projects;
      } catch (userError) {
        this.logger.warn(`User projects query failed: ${userError.message}`);

        // Repository에 연결된 프로젝트 조회로 fallback (repo가 제공된 경우)
        if (repo) {
          this.logger.debug(`Falling back to repository projects for ${owner}/${repo}`);
          return this.listRepositoryProjects(installationId, owner, repo, appId, privateKey);
        }

        this.logger.error(
          `Cannot list projects for user "${owner}". ` +
          `GitHub App tokens have limited access to user projects. ` +
          `Consider using an Organization or providing a repository name.`
        );
        return [];
      }
    } catch (error) {
      this.logger.error(`Failed to list owner projects for ${owner}: ${error.message}`);
      return [];
    }
  }

  /**
   * 새 프로젝트 생성
   *
   * @param installationId - Installation ID
   * @param owner - Organization 또는 User name
   * @param title - 프로젝트 제목
   * @param isOrg - Organization 여부 (기본: null = 자동 감지)
   * @param appId - Channel별 App ID (선택)
   * @param privateKey - Channel별 Private Key (선택)
   * @returns 생성된 프로젝트 정보
   */
  async createProject(
    installationId: number,
    owner: string,
    title: string,
    isOrg: boolean | null = null,
    appId?: string,
    privateKey?: string,
  ): Promise<GitHubProject | null> {
    const octokit = await this.githubAppService.getInstallationOctokit(
      installationId,
      appId,
      privateKey,
    );

    try {
      // isOrg가 null이면 자동 감지
      const isOrgActual = isOrg ?? await this.isOrganization(octokit, owner);

      this.logger.debug(`Creating project for ${isOrgActual ? 'Organization' : 'User'}: ${owner}`);

      // Owner의 node ID를 가져옴
      const ownerIdQuery = isOrgActual
        ? `query($owner: String!) { organization(login: $owner) { id } }`
        : `query($owner: String!) { user(login: $owner) { id } }`;

      const ownerResult: any = await octokit.graphql(ownerIdQuery, { owner });
      const ownerId = isOrgActual
        ? ownerResult.organization?.id
        : ownerResult.user?.id;

      if (!ownerId) {
        this.logger.error(`Owner ID not found for ${owner}. GraphQL result:`, JSON.stringify(ownerResult, null, 2));
        throw new Error(`Owner not found: ${owner}`);
      }

      this.logger.log(`Got owner ID for ${owner}: ${ownerId}`);

      // 프로젝트 생성
      const mutation = `
        mutation($ownerId: ID!, $title: String!) {
          createProjectV2(input: { ownerId: $ownerId, title: $title }) {
            projectV2 {
              id
              number
              title
              url
              createdAt
              updatedAt
              public
            }
          }
        }
      `;

      const result: any = await octokit.graphql(mutation, { ownerId, title });

      const project = result.createProjectV2?.projectV2;
      if (project) {
        this.logger.log(
          `Created project "${title}" for ${owner}: ${project.url}`,
        );
        return {
          id: project.id,
          number: project.number,
          title: project.title,
          url: project.url,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          public: project.public,
        };
      }

      return null;
    } catch (error) {
      this.logger.error(`Failed to create project "${title}" for ${owner}: ${error.message}`);
      this.logger.error(`Error details:`, error);
      return null;
    }
  }

  /**
   * Issue를 프로젝트에 추가
   *
   * @param installationId - Installation ID
   * @param projectId - Project node ID (GraphQL ID)
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param issueNumber - Issue 번호
   * @param appId - Channel별 App ID (선택)
   * @param privateKey - Channel별 Private Key (선택)
   * @returns 추가 결과
   */
  async addIssueToProject(
    installationId: number,
    projectId: string,
    owner: string,
    repo: string,
    issueNumber: number,
    appId?: string,
    privateKey?: string,
  ): Promise<AddToProjectResult> {
    const octokit = await this.githubAppService.getInstallationOctokit(
      installationId,
      appId,
      privateKey,
    );

    try {
      // 먼저 Issue의 node ID를 가져옴
      const issueQuery = `
        query($owner: String!, $repo: String!, $issueNumber: Int!) {
          repository(owner: $owner, name: $repo) {
            issue(number: $issueNumber) {
              id
            }
          }
        }
      `;

      const issueResult: any = await octokit.graphql(issueQuery, {
        owner,
        repo,
        issueNumber,
      });

      const contentId = issueResult.repository?.issue?.id;
      if (!contentId) {
        return {
          success: false,
          error: `Issue #${issueNumber} not found`,
        };
      }

      // Issue를 프로젝트에 추가
      const mutation = `
        mutation AddToProject($projectId: ID!, $contentId: ID!) {
          addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
            item {
              id
            }
          }
        }
      `;

      this.logger.debug(`Adding issue to project: projectId=${projectId}, contentId=${contentId}`);

      const result: any = await octokit.graphql(mutation, {
        projectId,
        contentId,
      });

      const itemId = result.addProjectV2ItemById?.item?.id;

      if (itemId) {
        this.logger.log(
          `Added issue #${issueNumber} to project (item ID: ${itemId})`,
        );
        return {
          success: true,
          itemId,
        };
      }

      return {
        success: false,
        error: 'Failed to add item to project',
      };
    } catch (error) {
      this.logger.error(
        `Failed to add issue to project: ${error.message}`,
      );
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 프로젝트 정보 조회 (ID로)
   *
   * @param installationId - Installation ID
   * @param projectId - Project node ID
   * @param appId - Channel별 App ID (선택)
   * @param privateKey - Channel별 Private Key (선택)
   * @returns 프로젝트 정보
   */
  async getProjectById(
    installationId: number,
    projectId: string,
    appId?: string,
    privateKey?: string,
  ): Promise<GitHubProject | null> {
    const octokit = await this.githubAppService.getInstallationOctokit(
      installationId,
      appId,
      privateKey,
    );

    try {
      const query = `
        query($projectId: ID!) {
          node(id: $projectId) {
            ... on ProjectV2 {
              id
              number
              title
              url
              createdAt
              updatedAt
              public
            }
          }
        }
      `;

      const result: any = await octokit.graphql(query, { projectId });

      if (result.node?.id) {
        return {
          id: result.node.id,
          number: result.node.number,
          title: result.node.title,
          url: result.node.url,
          createdAt: result.node.createdAt,
          updatedAt: result.node.updatedAt,
          public: result.node.public,
        };
      }

      return null;
    } catch (error) {
      this.logger.error(`Failed to get project: ${error.message}`);
      return null;
    }
  }

  /**
   * 기본 AURA 프로젝트를 찾거나 생성
   *
   * @param installationId - Installation ID
   * @param owner - Repository owner
   * @param appId - Channel별 App ID (선택)
   * @param privateKey - Channel별 Private Key (선택)
   * @param repo - Repository name (User인 경우 필요)
   * @returns 프로젝트 정보
   */
  async findOrCreateAuraProject(
    installationId: number,
    owner: string,
    appId?: string,
    privateKey?: string,
    repo?: string,
  ): Promise<GitHubProject | null> {
    const AURA_PROJECT_TITLE = 'AURA Action Items';

    // 기존 프로젝트 검색 (isOrg: null = 자동 감지)
    const projects = await this.listOwnerProjects(
      installationId,
      owner,
      null,
      appId,
      privateKey,
      repo,
    );

    const existingProject = projects.find(
      (p) => p.title === AURA_PROJECT_TITLE,
    );

    if (existingProject) {
      this.logger.debug(
        `Found existing AURA project: ${existingProject.url}`,
      );
      return existingProject;
    }

    // 새 프로젝트 생성 (isOrg: null = 자동 감지)
    this.logger.log(`Creating AURA project for ${owner}...`);
    return this.createProject(
      installationId,
      owner,
      AURA_PROJECT_TITLE,
      null,
      appId,
      privateKey,
    );
  }
}
