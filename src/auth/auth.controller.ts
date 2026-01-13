import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ValidationPipe,
  UseGuards,
  Request,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * 회원가입
   * POST /auth/register
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body(ValidationPipe) registerDto: RegisterDto,
  ): Promise<AuthResponseDto> {
    return this.authService.register(registerDto);
  }

  /**
   * 로그인
   * POST /auth/login
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(  
    @Body(ValidationPipe) loginDto: LoginDto,
  ): Promise<AuthResponseDto> {
    return this.authService.login(loginDto);
  }

  /**
   * 닉네임 중복 확인
   * GET /auth/check-nickname/:nickName
   */
  @Get('check-nickname/:nickName')
  @HttpCode(HttpStatus.OK)
  async checkNickname(
    @Param('nickName') nickName: string,
  ): Promise<{ available: boolean }> {
    const available = await this.authService.checkNicknameAvailability(nickName);
    return { available };
  }

  /**
   * 프로필 수정
   * PATCH /auth/profile
   */
  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async updateProfile(
    @Request() req: { user: { userId: string } },
    @Body(ValidationPipe) updateProfileDto: UpdateProfileDto,
  ): Promise<AuthResponseDto> {
    return this.authService.updateProfile(req.user.userId, updateProfileDto);
  }

  /**
   * 회원 탈퇴
   * DELETE /auth/withdraw
   */
  @Delete('withdraw')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async withdraw(
    @Request() req: { user: { userId: string } },
  ): Promise<{ message: string }> {
    return this.authService.withdraw(req.user.userId);
  }

  // ==================== Google OAuth 로그인 ====================

  /**
   * Google OAuth 로그인 시작 (리다이렉트)
   * GET /auth/google
   */
  @Get('google')
  @HttpCode(HttpStatus.FOUND)
  googleLogin(@Res() res: Response) {
    const authUrl = this.authService.getGoogleAuthUrl();
    res.redirect(authUrl);
  }

  /**
   * Google OAuth 콜백 처리
   * GET /auth/google/callback?code=xxx
   */
  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Res() res: Response,
  ) {
    try {
      const result = await this.authService.handleGoogleCallback(code);

      // 프론트엔드로 토큰과 함께 리다이렉트
      const frontendUrl = process.env.FRONTEND_URL || 'https://aura.ai.kr';
      const params = new URLSearchParams({
        token: result.accessToken,
        user: JSON.stringify(result.user),
      });

      res.redirect(`${frontendUrl}/auth/google/success?${params.toString()}`);
    } catch (error) {
      const frontendUrl = process.env.FRONTEND_URL || 'https://aura.ai.kr';
      res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(error.message)}`);
    }
  }

  /**
   * Google 연동 상태 확인
   * GET /auth/google/status
   */
  @Get('google/status')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async checkGoogleStatus(
    @Request() req: { user: { userId: string } },
  ): Promise<{ connected: boolean }> {
    return this.authService.checkGoogleConnection(req.user.userId);
  }
}
