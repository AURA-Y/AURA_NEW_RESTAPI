import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { ChannelMember, ChannelRole } from '../channel/entities/channel-member.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';

// 기본 채널 ID (모든 신규 사용자가 자동으로 가입되는 채널)
const DEFAULT_CHANNEL_ID = 'ba13a3bf-0844-45b0-a408-96cd4186cad5';

// Google OAuth 스코프 (프로필 + 캘린더 읽기/쓰기/공유)
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',  // 일정 생성/수정/삭제 권한
  'https://www.googleapis.com/auth/calendar.acls',    // 캘린더 공유 권한
];

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private oauth2Client: OAuth2Client;

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(ChannelMember)
    private channelMemberRepository: Repository<ChannelMember>,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {
    // Google OAuth2 클라이언트 초기화
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.configService.get<string>('GOOGLE_CLIENT_SECRET');
    const redirectUri = this.configService.get<string>('GOOGLE_AUTH_REDIRECT_URI');

    if (clientId && clientSecret && redirectUri) {
      this.oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);
      this.logger.log(`Google OAuth2 client initialized for auth`);
      this.logger.log(`Redirect URI: ${redirectUri}`);
    } else {
      this.logger.warn(`Google OAuth2 missing config - clientId: ${!!clientId}, clientSecret: ${!!clientSecret}, redirectUri: ${!!redirectUri}`);
    }
  }

  /**
   * 회원가입
   */
  async register(registerDto: RegisterDto): Promise<AuthResponseDto> {
    const { email, password, nickname } = registerDto;

    // 이메일 중복 확인
    const existingEmail = await this.userRepository.findOne({
      where: { email },
    });

    if (existingEmail) {
      throw new ConflictException('Email already exists');
    }

    // 닉네임 중복 확인
    const existingNickname = await this.userRepository.findOne({
      where: { nickName: nickname },
    });

    if (existingNickname) {
      throw new ConflictException('Nickname already exists');
    }

    // 비밀번호 해싱
    const hashedPassword = await bcrypt.hash(password, 10);

    // 사용자 생성
    const user = this.userRepository.create({
      email,
      nickName: nickname,
      userPassword: hashedPassword,
    });

    await this.userRepository.save(user);

    this.logger.log(`New user registered: ${nickname} (${email})`);

    // 기본 채널에 자동 가입 (채널이 존재하는 경우에만)
    try {
      // 채널 존재 여부 확인 (TypeORM의 queryRunner 사용)
      const channelExists = await this.channelMemberRepository.manager.query(
        `SELECT "channelId" FROM "Channel" WHERE "channelId" = $1 LIMIT 1`,
        [DEFAULT_CHANNEL_ID]
      );
      
      if (channelExists && channelExists.length > 0) {
        const membership = this.channelMemberRepository.create({
          channelId: DEFAULT_CHANNEL_ID,
          userId: user.userId,
          role: ChannelRole.MEMBER,
        });
        await this.channelMemberRepository.save(membership);
        this.logger.log(`User added to default channel: ${user.userId}`);
      } else {
        this.logger.warn(`Default channel ${DEFAULT_CHANNEL_ID} not found, skipping auto-join`);
      }
    } catch (e) {
      this.logger.warn(`Failed to add user to default channel: ${e.message}`);
    }

    // JWT 토큰 생성
    const accessToken = this.generateToken(user);

    return new AuthResponseDto(accessToken, {
      id: user.userId,
      userId: user.userId,
      email: user.email,
      nickName: user.nickName,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  }

  /**
   * 로그인
   */
  async login(loginDto: LoginDto): Promise<AuthResponseDto> {
    const { email, password } = loginDto;

    // 사용자 조회 (이메일로 찾기)
    const user = await this.userRepository.findOne({
      where: { email },
      select: {
        userId: true,
        email: true,
        nickName: true,
        userPassword: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // 비밀번호 확인
    const isPasswordValid = await bcrypt.compare(password, user.userPassword);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    this.logger.log(`User logged in: ${user.email} (${user.nickName})`);

    // JWT 토큰 생성
    const accessToken = this.generateToken(user);

    return new AuthResponseDto(accessToken, {
      id: user.userId,
      userId: user.userId,
      email: user.email,
      nickName: user.nickName,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  }

  /**
   * JWT 토큰 생성
   */
  private generateToken(user: User): string {
    const payload = {
      sub: user.userId,
      nickName: user.nickName,
    };

    return this.jwtService.sign(payload);
  }

  /**
   * 사용자 ID로 조회 (JWT 검증용)
   */
  async findById(id: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { userId: id } });
  }

  /**
   * 닉네임 사용 가능 여부 확인
   */
  async checkNicknameAvailability(nickname: string): Promise<boolean> {
    const existingUser = await this.userRepository.findOne({
      where: { nickName: nickname },
    });
    return !existingUser; // 사용자가 없으면 true (사용 가능)
  }

  /**
   * 프로필 수정
   */
  async updateProfile(
    userId: string,
    updateData: { nickName?: string; currentPassword?: string; newPassword?: string; profileImage?: string },
  ): Promise<AuthResponseDto> {
    const user = await this.userRepository.findOne({
      where: { userId },
      select: {
        userId: true,
        email: true,
        nickName: true,
        userPassword: true,
        profileImage: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('사용자를 찾을 수 없습니다.');
    }

    // 닉네임 변경 시 중복 확인
    if (updateData.nickName && updateData.nickName !== user.nickName) {
      const existingNickname = await this.userRepository.findOne({
        where: { nickName: updateData.nickName },
      });

      if (existingNickname) {
        throw new ConflictException('이미 사용 중인 닉네임입니다.');
      }

      user.nickName = updateData.nickName;
    }

    // 비밀번호 변경
    if (updateData.newPassword) {
      if (!updateData.currentPassword) {
        throw new ConflictException('비밀번호 변경 시 현재 비밀번호가 필요합니다.');
      }

      const isPasswordValid = await bcrypt.compare(
        updateData.currentPassword,
        user.userPassword,
      );

      if (!isPasswordValid) {
        throw new UnauthorizedException('현재 비밀번호가 일치하지 않습니다.');
      }

      user.userPassword = await bcrypt.hash(updateData.newPassword, 10);
    }

    // 프로필 이미지 변경
    if (updateData.profileImage !== undefined) {
      user.profileImage = updateData.profileImage || null;
    }

    await this.userRepository.save(user);

    this.logger.log(`User profile updated: ${user.email} (${user.nickName})`);

    // 새 JWT 토큰 생성 (닉네임이 변경되었을 수 있으므로)
    const accessToken = this.generateToken(user);

    return new AuthResponseDto(accessToken, {
      id: user.userId,
      userId: user.userId,
      email: user.email,
      nickName: user.nickName,
      profileImage: user.profileImage,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  }

  /**
   * 회원 탈퇴
   */
  async withdraw(userId: string): Promise<{ message: string }> {
    const user = await this.userRepository.findOne({
      where: { userId },
    });

    if (!user) {
      throw new UnauthorizedException('사용자를 찾을 수 없습니다.');
    }

    await this.userRepository.remove(user);

    this.logger.log(`User withdrawn: ${user.email} (${user.nickName})`);

    return { message: '계정이 성공적으로 삭제되었습니다.' };
  }

  // ==================== Google OAuth 로그인 ====================

  /**
   * Google OAuth URL 생성
   */
  getGoogleAuthUrl(): string {
    if (!this.oauth2Client) {
      throw new Error('Google OAuth2 client not configured');
    }

    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: GOOGLE_SCOPES,
      prompt: 'consent', // 항상 refresh_token 받기
    });

    this.logger.log(`Generated Google Auth URL: ${authUrl}`);
    return authUrl;
  }

  /**
   * Google OAuth 콜백 처리 - 로그인/회원가입 + 토큰 저장
   */
  async handleGoogleCallback(code: string): Promise<AuthResponseDto> {
    if (!this.oauth2Client) {
      throw new Error('Google OAuth2 client not configured');
    }

    // 1. Authorization code로 토큰 획득
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);

    // 2. Google 사용자 정보 가져오기
    const response = await fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      },
    );

    if (!response.ok) {
      throw new UnauthorizedException('Failed to get Google user info');
    }

    const googleUser = await response.json();
    const { email, name, picture } = googleUser;

    this.logger.log(`Google login attempt: ${email} (${name})`);

    // 3. 기존 사용자 조회 또는 신규 생성
    let user = await this.userRepository.findOne({ where: { email } });

    if (!user) {
      // 신규 회원가입 - 닉네임은 Google 이름 사용 (중복 시 랜덤 suffix)
      let nickName = name || email.split('@')[0];
      const existingNickname = await this.userRepository.findOne({
        where: { nickName },
      });

      if (existingNickname) {
        nickName = `${nickName}_${Math.random().toString(36).substring(2, 6)}`;
      }

      user = this.userRepository.create({
        email,
        nickName,
        userPassword: '', // Google 로그인은 비밀번호 없음
        googleAccessToken: tokens.access_token || null,
        googleRefreshToken: tokens.refresh_token || null,
        googleTokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      });

      await this.userRepository.save(user);
      this.logger.log(`New Google user registered: ${nickName} (${email})`);

      // 기본 채널에 자동 가입
      const existingMembership = await this.channelMemberRepository.findOne({
        where: { channelId: DEFAULT_CHANNEL_ID, userId: user.userId },
      });

      if (!existingMembership) {
        const membership = this.channelMemberRepository.create({
          channelId: DEFAULT_CHANNEL_ID,
          userId: user.userId,
          role: ChannelRole.MEMBER,
        });
        await this.channelMemberRepository.save(membership);
        this.logger.log(`Google user added to default channel: ${user.userId}`);
      }
    } else {
      // 기존 사용자 - Google 토큰 업데이트
      user.googleAccessToken = tokens.access_token || user.googleAccessToken;
      if (tokens.refresh_token) {
        user.googleRefreshToken = tokens.refresh_token;
      }
      user.googleTokenExpiry = tokens.expiry_date ? new Date(tokens.expiry_date) : user.googleTokenExpiry;

      await this.userRepository.save(user);
      this.logger.log(`Google user logged in: ${user.nickName} (${email})`);
    }

    // 4. App JWT 생성
    const accessToken = this.generateToken(user);

    return new AuthResponseDto(accessToken, {
      id: user.userId,
      userId: user.userId,
      email: user.email,
      nickName: user.nickName,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      googleConnected: true,
    });
  }

  /**
   * Google 연동 상태 확인
   */
  async checkGoogleConnection(userId: string): Promise<{ connected: boolean }> {
    const user = await this.userRepository.findOne({
      where: { userId },
      select: ['userId', 'googleAccessToken'],
    });

    return { connected: !!(user?.googleAccessToken) };
  }

  // ==================== GitHub 계정 연동 ====================

  /**
   * GitHub 연동 상태 조회
   */
  async getGitHubStatus(userId: string): Promise<{
    isConnected: boolean;
    githubUsername: string | null;
    linkedAt: Date | null;
  }> {
    const user = await this.userRepository.findOne({
      where: { userId },
      select: ['userId', 'githubUsername', 'githubLinkedAt'],
    });

    if (!user) {
      throw new UnauthorizedException('사용자를 찾을 수 없습니다.');
    }

    return {
      isConnected: !!user.githubUsername,
      githubUsername: user.githubUsername || null,
      linkedAt: user.githubLinkedAt || null,
    };
  }

  /**
   * GitHub 계정 연동
   *
   * @param userId 사용자 ID
   * @param githubUsername GitHub username
   * @returns 성공 메시지
   */
  async linkGitHub(
    userId: string,
    githubUsername: string,
  ): Promise<{ success: boolean; message: string }> {
    const user = await this.userRepository.findOne({
      where: { userId },
    });

    if (!user) {
      throw new UnauthorizedException('사용자를 찾을 수 없습니다.');
    }

    // 이미 다른 사용자가 해당 GitHub username을 사용 중인지 확인
    const existingUser = await this.userRepository.findOne({
      where: { githubUsername },
    });

    if (existingUser && existingUser.userId !== userId) {
      throw new ConflictException(
        `GitHub username '${githubUsername}'은(는) 이미 다른 사용자가 연동 중입니다.`,
      );
    }

    // GitHub username 연동
    user.githubUsername = githubUsername;
    user.githubLinkedAt = new Date();

    await this.userRepository.save(user);

    this.logger.log(`GitHub linked: ${user.nickName} → @${githubUsername}`);

    return {
      success: true,
      message: `GitHub 계정 @${githubUsername}이(가) 연동되었습니다.`,
    };
  }

  /**
   * GitHub 연동 해제
   */
  async unlinkGitHub(userId: string): Promise<{ success: boolean; message: string }> {
    const user = await this.userRepository.findOne({
      where: { userId },
    });

    if (!user) {
      throw new UnauthorizedException('사용자를 찾을 수 없습니다.');
    }

    if (!user.githubUsername) {
      return {
        success: true,
        message: 'GitHub 계정이 연동되어 있지 않습니다.',
      };
    }

    const previousUsername = user.githubUsername;

    // GitHub 연동 정보 초기화
    user.githubUsername = null;
    user.githubId = null;
    user.githubLinkedAt = null;

    await this.userRepository.save(user);

    this.logger.log(`GitHub unlinked: ${user.nickName} (was @${previousUsername})`);

    return {
      success: true,
      message: 'GitHub 연동이 해제되었습니다.',
    };
  }
}
