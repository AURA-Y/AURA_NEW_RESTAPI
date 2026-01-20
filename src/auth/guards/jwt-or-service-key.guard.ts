import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';

/**
 * JWT 또는 Service Key 인증을 허용하는 가드
 * - X-Service-Key 헤더가 있으면 서비스 간 인증으로 처리
 * - 없으면 기존 JWT 인증 수행
 */
@Injectable()
export class JwtOrServiceKeyGuard extends AuthGuard('jwt') implements CanActivate {
  private readonly serviceApiKey: string;

  constructor(private configService: ConfigService) {
    super();
    this.serviceApiKey = this.configService.get<string>('SERVICE_API_KEY') || '';
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const serviceKey = request.headers['x-service-key'];

    // Service Key가 있고 유효하면 인증 성공
    if (serviceKey && this.serviceApiKey && serviceKey === this.serviceApiKey) {
      request.isServiceRequest = true;
      return true;
    }

    // Service Key가 없거나 유효하지 않으면 JWT 인증 시도
    return super.canActivate(context) as Promise<boolean>;
  }
}
