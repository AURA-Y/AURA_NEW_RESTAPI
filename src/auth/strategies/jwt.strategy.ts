import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { AuthService } from '../auth.service';

// 쿼리 파라미터에서 토큰 추출 (SSE용)
const extractFromQuery = (req: Request): string | null => {
  if (req.query && req.query.token) {
    return req.query.token as string;
  }
  return null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super({
      // 헤더 또는 쿼리 파라미터에서 토큰 추출
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        extractFromQuery,
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'default-secret-change-in-production',
    });
  }

  async validate(payload: any) {
    const user = await this.authService.findById(payload.sub);

    if (!user) {
      throw new UnauthorizedException();
    }

    return {
      id: user.userId,
      userId: user.userId,
      username: user.nickName,
      nickName: user.nickName,
      name: user.nickName,
    };
  }
}
