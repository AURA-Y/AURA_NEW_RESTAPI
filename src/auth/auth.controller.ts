import {
  Controller,
  Post,
  Get,
  Put,
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
import { LinkGitHubDto, GitHubStatusResponseDto } from './dto/github-link.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * 회원가입 (비활성화)
   * POST /auth/register
   */
  @Post('register')
  @HttpCode(HttpStatus.FORBIDDEN)
  async register(
    @Body(ValidationPipe) registerDto: RegisterDto,
  ): Promise<{ message: string }> {
    return { message: '회원가입이 비활성화되었습니다.' };
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

  // ==================== GitHub 계정 연동 ====================

  /**
   * GitHub 연동 상태 조회
   * GET /auth/github/status
   *
   * Response:
   * {
   *   "isConnected": true,
   *   "githubUsername": "jomyeonggi",
   *   "linkedAt": "2024-01-15T09:30:00.000Z"
   * }
   */
  @Get('github/status')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getGitHubStatus(
    @Request() req: { user: { userId: string } },
  ): Promise<GitHubStatusResponseDto> {
    const status = await this.authService.getGitHubStatus(req.user.userId);
    return new GitHubStatusResponseDto(status);
  }

  /**
   * GitHub 계정 연동
   * PUT /auth/github/link
   *
   * Request Body:
   * {
   *   "githubUsername": "jomyeonggi"
   * }
   *
   * Response:
   * {
   *   "success": true,
   *   "message": "GitHub 계정 @jomyeonggi이(가) 연동되었습니다."
   * }
   */
  @Put('github/link')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async linkGitHub(
    @Request() req: { user: { userId: string } },
    @Body(ValidationPipe) dto: LinkGitHubDto,
  ): Promise<{ success: boolean; message: string }> {
    return this.authService.linkGitHub(req.user.userId, dto.githubUsername);
  }

  /**
   * GitHub 연동 해제
   * DELETE /auth/github/unlink
   *
   * Response:
   * {
   *   "success": true,
   *   "message": "GitHub 연동이 해제되었습니다."
   * }
   */
  @Delete('github/unlink')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async unlinkGitHub(
    @Request() req: { user: { userId: string } },
  ): Promise<{ success: boolean; message: string }> {
    return this.authService.unlinkGitHub(req.user.userId);
  }
}
