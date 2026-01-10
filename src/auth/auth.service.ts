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
import { UpdateProfileDto } from './dto/update-profile.dto';

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
    const { email, userPassword, nickName } = registerDto;

    // 이메일 중복 확인
    const existingEmail = await this.userRepository.findOne({
      where: { email },
    });

    if (existingEmail) {
      throw new ConflictException('Email already exists');
    }

    // 닉네임 중복 확인
    const existingNickname = await this.userRepository.findOne({
      where: { nickName },
    });

    if (existingNickname) {
      throw new ConflictException('Nickname already exists');
    }

    // 비밀번호 해싱
    const hashedPassword = await bcrypt.hash(userPassword, 10);

    // 사용자 생성
    const user = this.userRepository.create({
      email,
      nickName,
      userPassword: hashedPassword,
    });

    await this.userRepository.save(user);

    this.logger.log(`New user registered: ${nickName} (${email})`);

    // JWT 토큰 생성
    const accessToken = this.generateToken(user);

    return new AuthResponseDto(accessToken, {
      id: user.userId,
      userId: user.userId,
      email: user.email,
      nickName: user.nickName,
      nickname: user.nickName,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  }

  /**
   * 로그인
   */
  async login(loginDto: LoginDto): Promise<AuthResponseDto> {
    const { email, userPassword } = loginDto;

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
    const isPasswordValid = await bcrypt.compare(userPassword, user.userPassword);

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
      nickname: user.nickName,
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
      username: user.nickName,
      name: user.nickName,
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
   * 회원정보 수정
   */
  async updateProfile(userId: string, updateProfileDto: UpdateProfileDto): Promise<AuthResponseDto> {
    const { nickName, currentPassword, newPassword } = updateProfileDto;

    const user = await this.userRepository.findOne({ where: { userId } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // 닉네임 변경 시 중복 확인
    if (nickName && nickName !== user.nickName) {
      const existingNickname = await this.userRepository.findOne({
        where: { nickName },
      });
      if (existingNickname) {
        throw new ConflictException('Nickname already exists');
      }
      user.nickName = nickName;
    }

    // 비밀번호 변경
    if (newPassword) {
      if (!currentPassword) {
        throw new ConflictException('Current password is required to set a new password');
      }

      const isPasswordValid = await bcrypt.compare(currentPassword, user.userPassword);
      if (!isPasswordValid) {
        throw new UnauthorizedException('Invalid current password');
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      user.userPassword = hashedPassword;
    }

    await this.userRepository.save(user);

    this.logger.log(`User profile updated: ${user.nickName} (${user.email})`);

    // 새 토큰 발급 (선택사항이나 정보가 바뀌었으므로 갱신)
    const accessToken = this.generateToken(user);

    return new AuthResponseDto(accessToken, {
      id: user.userId,
      userId: user.userId,
      email: user.email,
      nickName: user.nickName,
      nickname: user.nickName,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  }

  async withdraw(userId: string): Promise<void> {
    const user = await this.userRepository.findOne({ where: { userId } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    await this.userRepository.remove(user);
  }
}
