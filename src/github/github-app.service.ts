import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { App, Octokit } from 'octokit';
import { SecretsService } from '../secrets/secrets.service';

/**
 * GitHubAppService
 *
 * 역할: GitHub App 인증 처리
 *
 * GitHub App 인증 흐름:
 * 1. App ID + Private Key로 JWT 생성 (10분 유효)
 * 2. JWT로 Installation Access Token 발급 요청
 * 3. Installation Token으로 GitHub API 호출 (1시간 유효)
 *
 * JWT (JSON Web Token):
 * - Header: {"alg": "RS256", "typ": "JWT"}
 * - Payload: {"iss": APP_ID, "iat": 현재시간, "exp": 현재시간+10분}
 * - Signature: Private Key로 서명
 *
 * Installation Token:
 * - GitHub가 발급하는 임시 토큰
 * - 1시간 후 자동 만료
 * - 특정 Organization/User의 리소스에 접근 가능
 *
 * Channel별 독립 GitHub App 지원:
 * - appId + privateKey 파라미터가 제공되면 → Channel 자체 App 사용
 * - 파라미터가 없으면 → 서버 기본 App 사용 (하위 호환)
 */
@Injectable()
export class GitHubAppService implements OnModuleInit {
  private readonly logger = new Logger(GitHubAppService.name);
  private app: App | null = null;

  constructor(private secretsService: SecretsService) {}

  onModuleInit() {
    this.initializeApp();
  }

  /**
   * GitHub App 인스턴스 초기화
   *
   * Octokit의 App 클래스는 내부적으로:
   * 1. Private Key로 JWT 자동 생성
   * 2. JWT 만료 시 자동 재생성
   * 3. Installation Token 캐싱 및 자동 갱신
   */
  private initializeApp(): void {
    try {
      if (!this.secretsService.isLoaded()) {
        this.logger.warn('Secrets not loaded yet, GitHub App not initialized');
        return;
      }

      const appId = this.secretsService.getAppId();
      const privateKey = this.secretsService.getPrivateKey();

      this.app = new App({
        appId,
        privateKey,
      });

      this.logger.log(`GitHub App initialized (App ID: ${appId})`);
    } catch (error) {
      this.logger.error(`Failed to initialize GitHub App: ${error.message}`);
    }
  }

  /**
   * App 인스턴스 확인 및 지연 초기화
   */
  private ensureApp(): App {
    if (!this.app) {
      this.initializeApp();
    }

    if (!this.app) {
      throw new Error('GitHub App not initialized. Check secrets configuration.');
    }

    return this.app;
  }

  /**
   * Installation ID로 인증된 Octokit 인스턴스 반환
   *
   * @param installationId - GitHub App이 설치된 Organization/User의 Installation ID
   * @param appId - Channel별 GitHub App ID (선택, 없으면 기본 App 사용)
   * @param privateKey - Channel별 GitHub App Private Key (선택, 없으면 기본 App 사용)
   * @returns 인증된 Octokit 인스턴스
   *
   * 내부 동작:
   * 1. appId + privateKey가 제공되면 → 임시 App 인스턴스 생성 (Channel 자체 App)
   * 2. 없으면 → 서버 기본 App 인스턴스 사용
   * 3. App에서 JWT 생성 (자동)
   * 4. POST /app/installations/{id}/access_tokens 호출 (자동)
   * 5. Installation Token으로 인증된 Octokit 반환
   *
   * 예시 (기본 App):
   * const octokit = await getInstallationOctokit(12345678);
   * await octokit.rest.issues.create({ owner, repo, title, body });
   *
   * 예시 (Channel 자체 App):
   * const octokit = await getInstallationOctokit(12345678, "9876543", "-----BEGIN...");
   * await octokit.rest.issues.create({ owner, repo, title, body });
   */
  async getInstallationOctokit(
    installationId: number,
    appId?: string,
    privateKey?: string,
  ): Promise<Octokit> {
    // Channel 자체 App 사용 (appId + privateKey 모두 제공된 경우)
    if (appId && privateKey) {
      this.logger.debug(
        `Creating temporary App instance for Channel (App ID: ${appId})`,
      );

      const tempApp = new App({
        appId,
        privateKey,
      });

      return await tempApp.getInstallationOctokit(installationId);
    }

    // 기본 App 사용 (하위 호환)
    const app = this.ensureApp();
    return await app.getInstallationOctokit(installationId);
  }

  /**
   * Installation Token 직접 발급
   *
   * @param installationId - Installation ID
   * @param appId - Channel별 GitHub App ID (선택)
   * @param privateKey - Channel별 GitHub App Private Key (선택)
   * @returns Installation Access Token 문자열
   *
   * 사용 시나리오:
   * - 외부 라이브러리에 토큰 전달 필요 시
   * - 디버깅/로깅 목적
   */
  async getInstallationToken(
    installationId: number,
    appId?: string,
    privateKey?: string,
  ): Promise<string> {
    const octokit = await this.getInstallationOctokit(
      installationId,
      appId,
      privateKey,
    );

    // Octokit의 auth() 메서드로 현재 토큰 정보 조회
    const auth = (await octokit.auth({
      type: 'installation',
    })) as { token: string };

    return auth.token;
  }

  /**
   * App 정보 조회 (연결 테스트용)
   *
   * @returns GitHub App 메타데이터
   */
  async getAppInfo(): Promise<{
    id: number;
    name: string;
    ownerLogin: string | null;
  }> {
    const app = this.ensureApp();
    const { data } = await app.octokit.rest.apps.getAuthenticated();

    // owner가 User인 경우 login 속성이 있고, Enterprise인 경우 slug 사용
    let ownerLogin: string | null = null;
    if (data.owner) {
      ownerLogin = 'login' in data.owner ? data.owner.login : data.owner.slug;
    }

    return {
      id: data.id,
      name: data.name,
      ownerLogin,
    };
  }

  /**
   * Installation이 접근 가능한 Repository 목록 조회
   *
   * @param installationId - Installation ID
   * @param appId - Channel별 GitHub App ID (선택)
   * @param privateKey - Channel별 GitHub App Private Key (선택)
   * @returns Repository 목록
   */
  async getInstallationRepositories(
    installationId: number,
    appId?: string,
    privateKey?: string,
  ): Promise<Array<{ owner: string; name: string; fullName: string }>> {
    const octokit = await this.getInstallationOctokit(
      installationId,
      appId,
      privateKey,
    );

    const { data } =
      await octokit.rest.apps.listReposAccessibleToInstallation({
        per_page: 100,
      });

    return data.repositories.map((repo) => ({
      owner: repo.owner.login,
      name: repo.name,
      fullName: repo.full_name,
    }));
  }

  /**
   * 특정 App 정보 조회 (Channel별 App 연결 테스트용)
   *
   * @param appId - GitHub App ID
   * @param privateKey - GitHub App Private Key
   * @returns GitHub App 메타데이터
   *
   * 사용 시나리오:
   * - Channel 설정 시 App 연결 유효성 검증
   * - App 정보 확인 (이름, 소유자 등)
   */
  async getCustomAppInfo(
    appId: string,
    privateKey: string,
  ): Promise<{
    id: number;
    name: string;
    ownerLogin: string | null;
  }> {
    const tempApp = new App({
      appId,
      privateKey,
    });

    const { data } = await tempApp.octokit.rest.apps.getAuthenticated();

    let ownerLogin: string | null = null;
    if (data.owner) {
      ownerLogin = 'login' in data.owner ? data.owner.login : data.owner.slug;
    }

    this.logger.debug(`Custom App info retrieved: ${data.name} (ID: ${data.id})`);

    return {
      id: data.id,
      name: data.name,
      ownerLogin,
    };
  }
}
