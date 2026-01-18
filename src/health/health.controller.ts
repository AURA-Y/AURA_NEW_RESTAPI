import { Controller, Get } from '@nestjs/common';
import { SecretsService } from '../secrets/secrets.service';

@Controller('health')
export class HealthController {
  constructor(private secretsService: SecretsService) {}

  @Get()
  health() {
    return { status: 'ok' };
  }

  /**
   * GET /health/secrets
   * 시크릿 상태 확인 (디버깅/모니터링용)
   *
   * 주의: 실제 시크릿 값은 반환하지 않음
   */
  @Get('secrets')
  secretsHealth() {
    const cacheStatus = this.secretsService.getCacheStatus();

    return {
      status: cacheStatus.isLoaded && !cacheStatus.isExpired ? 'ok' : 'warning',
      secrets: {
        loaded: cacheStatus.isLoaded,
        source: cacheStatus.source,
        loadedAt: cacheStatus.loadedAt?.toISOString() ?? null,
        expiresAt: cacheStatus.expiresAt?.toISOString() ?? null,
        isExpired: cacheStatus.isExpired,
      },
    };
  }
}
