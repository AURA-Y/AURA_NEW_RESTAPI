import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ValidationPipe,
  Patch,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
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
   * 회원정보 수정
   * PATCH /auth/profile
   * 
   * @throws {UnauthorizedException} 401 - User not found (토큰 만료/유효하지 않음)
   * @throws {ConflictException} 409 - Nickname already exists (닉네임 중복)
   * @throws {ConflictException} 409 - Current password is required (비밀번호 변경 시 현재 비밀번호 누락)
   * @throws {UnauthorizedException} 401 - Invalid current password (현재 비밀번호 불일치)
   */
  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  @HttpCode(HttpStatus.OK)
  async updateProfile(
    @Req() req: any,
    @Body(ValidationPipe) updateProfileDto: UpdateProfileDto,
  ): Promise<AuthResponseDto> {
    return this.authService.updateProfile(req.user.userId, updateProfileDto);
  }
}
