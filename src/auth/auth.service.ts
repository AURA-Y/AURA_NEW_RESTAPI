import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private jwtService: JwtService,
  ) {}

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
    updateData: { nickName?: string; currentPassword?: string; newPassword?: string },
  ): Promise<AuthResponseDto> {
    const user = await this.userRepository.findOne({
      where: { userId },
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

    await this.userRepository.save(user);

    this.logger.log(`User profile updated: ${user.email} (${user.nickName})`);

    // 새 JWT 토큰 생성 (닉네임이 변경되었을 수 있으므로)
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
}
