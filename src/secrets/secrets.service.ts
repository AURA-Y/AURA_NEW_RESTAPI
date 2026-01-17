import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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
 * SecretsService
 *
 * 역할: AWS Secrets Manager 또는 환경변수에서 민감한 키를 로드
 *
 * 동작 원리:
 * 1. 서버 시작 시 OnModuleInit에서 키 로드
 * 2. USE_SECRETS_MANAGER=true → AWS Secrets Manager에서 로드
 * 3. USE_SECRETS_MANAGER=false → 환경변수에서 로드 (개발용)
 * 4. 로드된 키는 메모리에만 저장 (파일/환경변수 노출 X)
 */
@Injectable()
export class SecretsService implements OnModuleInit {
  private readonly logger = new Logger(SecretsService.name);
  private secrets: GitHubAppSecrets | null = null;
  private client: SecretsManagerClient | null = null;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const useSecretsManager =
      this.configService.get<string>('USE_SECRETS_MANAGER') === 'true';

    if (useSecretsManager) {
      await this.loadFromSecretsManager();
    } else {
      this.loadFromEnv();
    }
  }

  /**
   * AWS Secrets Manager에서 시크릿 로드
   *
   * Flow:
   * 1. SecretsManagerClient 초기화 (region 설정)
   * 2. GetSecretValueCommand로 시크릿 요청
   * 3. JSON 파싱하여 메모리에 저장
   */
  private async loadFromSecretsManager(): Promise<void> {
    try {
      const region = this.configService.get<string>(
        'AWS_REGION',
        'ap-northeast-2',
      );
      const secretName = this.configService.get<string>(
        'AWS_SECRETS_NAME',
        'aura/github-app-secret',
      );

      this.client = new SecretsManagerClient({ region });

      const command = new GetSecretValueCommand({ SecretId: secretName });
      const response = await this.client.send(command);

      if (!response.SecretString) {
        throw new Error('SecretString is empty');
      }

      this.secrets = JSON.parse(response.SecretString) as GitHubAppSecrets;
      this.logger.log(
        `Secrets loaded from AWS Secrets Manager (${secretName})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to load secrets from AWS Secrets Manager: ${error.message}`,
      );
      // 프로덕션에서 실패하면 서버 시작 중단
      throw error;
    }
  }

  /**
   * 환경변수에서 시크릿 로드 (개발 환경용)
   *
   * Flow:
   * 1. .env 파일에서 GITHUB_APP_ID, GITHUB_PRIVATE_KEY, ENCRYPTION_KEY 읽기
   * 2. 메모리에 저장
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

    this.secrets = {
      APP_ID: appId,
      PRIVATE_KEY: formattedPrivateKey,
      ENCRYPTION_KEY: encryptionKey,
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
   * GitHub App ID 반환
   */
  getAppId(): string {
    if (!this.secrets?.APP_ID) {
      throw new Error('GitHub App ID not loaded');
    }
    return this.secrets.APP_ID;
  }

  /**
   * GitHub App Private Key 반환
   */
  getPrivateKey(): string {
    if (!this.secrets?.PRIVATE_KEY) {
      throw new Error('GitHub App Private Key not loaded');
    }
    return this.secrets.PRIVATE_KEY;
  }

  /**
   * 암호화 키 반환 (AES-256-GCM용 64자리 hex)
   */
  getEncryptionKey(): string {
    if (!this.secrets?.ENCRYPTION_KEY) {
      throw new Error('Encryption Key not loaded');
    }
    return this.secrets.ENCRYPTION_KEY;
  }

  /**
   * 시크릿 로드 여부 확인
   */
  isLoaded(): boolean {
    return (
      this.secrets !== null &&
      !!this.secrets.APP_ID &&
      !!this.secrets.PRIVATE_KEY &&
      !!this.secrets.ENCRYPTION_KEY
    );
  }
}
