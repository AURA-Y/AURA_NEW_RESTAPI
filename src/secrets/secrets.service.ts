import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

/**
 * GitHub App 인증에 필요한 시크릿 인터페이스
 */
interface GitHubAppSecrets {
  APP_ID: string;
  PRIVATE_KEY: string;
  ENCRYPTION_KEY: string;
}

/**
 * 캐시된 시크릿 정보
 */
interface CachedSecrets {
  secrets: GitHubAppSecrets;
  loadedAt: Date;
  expiresAt: Date;
}

/**
 * SecretsService
 *
 * 역할: AWS Secrets Manager 또는 환경변수에서 민감한 키를 로드
 *
 * 동작 원리:
 * 1. 서버 시작 시 OnModuleInit에서 키 로드
 * 2. USE_SECRETS_MANAGER=true → AWS Secrets Manager에서 로드
 * 3. USE_SECRETS_MANAGER=false → 환경변수에서 로드 (개발용)
 * 4. 로드된 키는 메모리에만 저장 (파일/환경변수 노출 X)
 *
 * Phase 4 개선사항:
 * - 재시도 로직 (지수 백오프)
 * - 시크릿 캐싱 (TTL 기반)
 * - 자동 갱신 메커니즘
 * - 상세한 에러 핸들링
 */
@Injectable()
export class SecretsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SecretsService.name);
  private cachedSecrets: CachedSecrets | null = null;
  private client: SecretsManagerClient | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private isRefreshing = false;

  // 설정 상수
  private readonly MAX_RETRIES = 3;
  private readonly INITIAL_RETRY_DELAY_MS = 1000; // 1초
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1시간
  private readonly REFRESH_BEFORE_EXPIRY_MS = 10 * 60 * 1000; // 만료 10분 전 갱신

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const useSecretsManager =
      this.configService.get<string>('USE_SECRETS_MANAGER') === 'true';

    if (useSecretsManager) {
      await this.loadFromSecretsManagerWithRetry();
      this.scheduleAutoRefresh();
    } else {
      this.loadFromEnv();
    }
  }

  /**
   * 모듈 종료 시 타이머 정리
   */
  onModuleDestroy() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
      this.logger.log('Secrets auto-refresh timer cleared');
    }
  }

  /**
   * 재시도 로직이 포함된 Secrets Manager 로드
   *
   * 지수 백오프 전략:
   * - 1차 실패: 1초 대기 후 재시도
   * - 2차 실패: 2초 대기 후 재시도
   * - 3차 실패: 4초 대기 후 재시도
   * - 모두 실패: 에러 발생
   */
  private async loadFromSecretsManagerWithRetry(): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        await this.loadFromSecretsManager();
        return; // 성공 시 종료
      } catch (error) {
        lastError = error;
        const delay = this.INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);

        this.logger.warn(
          `Secrets Manager load attempt ${attempt}/${this.MAX_RETRIES} failed: ${error.message}`,
        );

        if (attempt < this.MAX_RETRIES) {
          this.logger.log(`Retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }

    // 모든 재시도 실패
    this.logger.error(
      `Failed to load secrets after ${this.MAX_RETRIES} attempts`,
    );
    throw lastError;
  }

  /**
   * 자동 갱신 스케줄링
   *
   * 캐시 만료 10분 전에 백그라운드에서 갱신
   * → 서비스 중단 없이 시크릿 로테이션 지원
   */
  private scheduleAutoRefresh(): void {
    if (!this.cachedSecrets) return;

    const refreshTime =
      this.cachedSecrets.expiresAt.getTime() -
      Date.now() -
      this.REFRESH_BEFORE_EXPIRY_MS;

    if (refreshTime > 0) {
      this.refreshTimer = setTimeout(async () => {
        await this.refreshSecrets();
      }, refreshTime);

      const refreshAt = new Date(Date.now() + refreshTime);
      this.logger.debug(
        `Secrets auto-refresh scheduled at ${refreshAt.toISOString()}`,
      );
    }
  }

  /**
   * 시크릿 갱신 (백그라운드)
   */
  private async refreshSecrets(): Promise<void> {
    if (this.isRefreshing) {
      this.logger.debug('Secrets refresh already in progress, skipping');
      return;
    }

    this.isRefreshing = true;

    try {
      this.logger.log('Starting secrets auto-refresh...');
      await this.loadFromSecretsManagerWithRetry();
      this.scheduleAutoRefresh();
      this.logger.log('Secrets auto-refresh completed successfully');
    } catch (error) {
      this.logger.error(`Secrets auto-refresh failed: ${error.message}`);
      // 갱신 실패해도 기존 캐시 유지, 다음 갱신 시도 예약
      this.scheduleAutoRefresh();
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * 지연 유틸리티
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * AWS Secrets Manager에서 시크릿 로드
   *
   * Flow:
   * 1. SecretsManagerClient 초기화 (region 설정)
   * 2. GetSecretValueCommand로 시크릿 요청
   * 3. JSON 파싱하여 캐시에 저장 (TTL 포함)
   *
   * 캐싱:
   * - 로드된 시크릿은 CACHE_TTL_MS 동안 캐시
   * - 만료 전 자동 갱신으로 무중단 로테이션 지원
   */
  private async loadFromSecretsManager(): Promise<void> {
    const region = this.configService.get<string>(
      'AWS_REGION',
      'ap-northeast-2',
    );
    const secretName = this.configService.get<string>(
      'AWS_SECRETS_NAME',
      'aura/github-app-secret',
    );

    // 클라이언트 초기화 (재사용)
    if (!this.client) {
      this.client = new SecretsManagerClient({ region });
    }

    const command = new GetSecretValueCommand({ SecretId: secretName });

    try {
      const response = await this.client.send(command);

      if (!response.SecretString) {
        throw new Error('SecretString is empty');
      }

      const secrets = JSON.parse(response.SecretString) as GitHubAppSecrets;

      // 필수 필드 검증
      this.validateSecrets(secrets);

      // 캐시에 저장 (TTL 포함)
      const now = new Date();
      this.cachedSecrets = {
        secrets,
        loadedAt: now,
        expiresAt: new Date(now.getTime() + this.CACHE_TTL_MS),
      };

      this.logger.log(
        `Secrets loaded from AWS Secrets Manager (${secretName}) - expires at ${this.cachedSecrets.expiresAt.toISOString()}`,
      );
    } catch (error) {
      // 에러 유형별 상세 메시지
      if (error.name === 'ResourceNotFoundException') {
        throw new Error(
          `Secret '${secretName}' not found in AWS Secrets Manager. Please create it first.`,
        );
      } else if (error.name === 'AccessDeniedException') {
        throw new Error(
          `Access denied to secret '${secretName}'. Check IAM permissions.`,
        );
      } else if (error.name === 'InvalidParameterException') {
        throw new Error(
          `Invalid parameter when accessing secret '${secretName}': ${error.message}`,
        );
      } else if (error.name === 'DecryptionFailureException') {
        throw new Error(
          `Failed to decrypt secret '${secretName}'. Check KMS key permissions.`,
        );
      }

      throw error;
    }
  }

  /**
   * 시크릿 필수 필드 검증
   */
  private validateSecrets(secrets: GitHubAppSecrets): void {
    const requiredFields: (keyof GitHubAppSecrets)[] = [
      'APP_ID',
      'PRIVATE_KEY',
      'ENCRYPTION_KEY',
    ];

    const missingFields = requiredFields.filter((field) => !secrets[field]);

    if (missingFields.length > 0) {
      throw new Error(
        `Missing required fields in secret: ${missingFields.join(', ')}`,
      );
    }

    // ENCRYPTION_KEY 형식 검증 (64자리 hex)
    if (!/^[a-fA-F0-9]{64}$/.test(secrets.ENCRYPTION_KEY)) {
      throw new Error(
        'ENCRYPTION_KEY must be 64 hexadecimal characters (32 bytes)',
      );
    }

    // PRIVATE_KEY 형식 검증
    if (
      !secrets.PRIVATE_KEY.includes('-----BEGIN') ||
      !secrets.PRIVATE_KEY.includes('PRIVATE KEY-----')
    ) {
      throw new Error('PRIVATE_KEY must be in PEM format');
    }
  }

  /**
   * 환경변수에서 시크릿 로드 (개발 환경용)
   *
   * Flow:
   * 1. .env 파일에서 GITHUB_APP_ID, GITHUB_PRIVATE_KEY, ENCRYPTION_KEY 읽기
   * 2. 캐시에 저장 (만료 없음)
   */
  private loadFromEnv(): void {
    const appId = this.configService.get<string>('GITHUB_APP_ID', '');
    const privateKey = this.configService.get<string>(
      'GITHUB_PRIVATE_KEY',
      '',
    );
    const encryptionKey = this.configService.get<string>('ENCRYPTION_KEY', '');

    // Private Key의 \n 문자열을 실제 줄바꿈으로 변환
    const formattedPrivateKey = privateKey.replace(/\\n/g, '\n');

    const secrets: GitHubAppSecrets = {
      APP_ID: appId,
      PRIVATE_KEY: formattedPrivateKey,
      ENCRYPTION_KEY: encryptionKey,
    };

    // 환경변수는 만료 없이 캐시 (매우 먼 미래)
    const now = new Date();
    this.cachedSecrets = {
      secrets,
      loadedAt: now,
      expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000), // 1년
    };

    if (!appId || !privateKey || !encryptionKey) {
      this.logger.warn(
        'Some GitHub App secrets are missing in environment variables',
      );
    } else {
      this.logger.log('Secrets loaded from environment variables');
    }
  }

  /**
   * 시크릿 가져오기 (내부 헬퍼)
   */
  private getSecrets(): GitHubAppSecrets {
    if (!this.cachedSecrets) {
      throw new Error('Secrets not loaded. Please check server initialization.');
    }
    return this.cachedSecrets.secrets;
  }

  /**
   * GitHub App ID 반환
   */
  getAppId(): string {
    const secrets = this.getSecrets();
    if (!secrets.APP_ID) {
      throw new Error('GitHub App ID not loaded');
    }
    return secrets.APP_ID;
  }

  /**
   * GitHub App Private Key 반환
   */
  getPrivateKey(): string {
    const secrets = this.getSecrets();
    if (!secrets.PRIVATE_KEY) {
      throw new Error('GitHub App Private Key not loaded');
    }
    return secrets.PRIVATE_KEY;
  }

  /**
   * 암호화 키 반환 (AES-256-GCM용 64자리 hex)
   */
  getEncryptionKey(): string {
    const secrets = this.getSecrets();
    if (!secrets.ENCRYPTION_KEY) {
      throw new Error('Encryption Key not loaded');
    }
    return secrets.ENCRYPTION_KEY;
  }

  /**
   * 시크릿 로드 여부 확인
   */
  isLoaded(): boolean {
    if (!this.cachedSecrets) return false;

    const secrets = this.cachedSecrets.secrets;
    return (
      !!secrets.APP_ID && !!secrets.PRIVATE_KEY && !!secrets.ENCRYPTION_KEY
    );
  }

  /**
   * 캐시 상태 정보 반환 (디버깅/모니터링용)
   */
  getCacheStatus(): {
    isLoaded: boolean;
    loadedAt: Date | null;
    expiresAt: Date | null;
    isExpired: boolean;
    source: 'secrets-manager' | 'environment' | 'none';
  } {
    const useSecretsManager =
      this.configService.get<string>('USE_SECRETS_MANAGER') === 'true';

    if (!this.cachedSecrets) {
      return {
        isLoaded: false,
        loadedAt: null,
        expiresAt: null,
        isExpired: true,
        source: 'none',
      };
    }

    return {
      isLoaded: true,
      loadedAt: this.cachedSecrets.loadedAt,
      expiresAt: this.cachedSecrets.expiresAt,
      isExpired: Date.now() > this.cachedSecrets.expiresAt.getTime(),
      source: useSecretsManager ? 'secrets-manager' : 'environment',
    };
  }

  /**
   * 시크릿 강제 갱신 (관리 목적)
   */
  async forceRefresh(): Promise<void> {
    const useSecretsManager =
      this.configService.get<string>('USE_SECRETS_MANAGER') === 'true';

    if (!useSecretsManager) {
      this.logger.warn(
        'Force refresh called but USE_SECRETS_MANAGER is false. Reloading from env.',
      );
      this.loadFromEnv();
      return;
    }

    this.logger.log('Force refreshing secrets from AWS Secrets Manager...');
    await this.loadFromSecretsManagerWithRetry();
    this.logger.log('Force refresh completed');
  }
}
