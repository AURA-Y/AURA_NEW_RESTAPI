import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ValidationPipe,
  UseGuards,
  Request,
} from '@nestjs/common';
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
}
