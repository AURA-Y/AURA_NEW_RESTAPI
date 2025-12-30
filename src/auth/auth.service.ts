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
    const { username, password, name } = registerDto;

    // 사용자 이름 중복 확인
    const existingUser = await this.userRepository.findOne({
      where: { username },
    });

    if (existingUser) {
      throw new ConflictException('Username already exists');
    }

    // 비밀번호 해싱
    const hashedPassword = await bcrypt.hash(password, 10);

    // 사용자 생성
    const user = this.userRepository.create({
      username,
      password: hashedPassword,
      name,
    });

    await this.userRepository.save(user);

    this.logger.log(`New user registered: ${username}`);

    // JWT 토큰 생성
    const accessToken = this.generateToken(user);

    return new AuthResponseDto(accessToken, {
      id: user.id,
      username: user.username,
      name: user.name,
    });
  }

  /**
   * 로그인
   */
  async login(loginDto: LoginDto): Promise<AuthResponseDto> {
    const { username, password } = loginDto;

    // 사용자 조회
    const user = await this.userRepository.findOne({
      where: { username },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // 비밀번호 확인
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    this.logger.log(`User logged in: ${username}`);

    // JWT 토큰 생성
    const accessToken = this.generateToken(user);

    return new AuthResponseDto(accessToken, {
      id: user.id,
      username: user.username,
      name: user.name,
    });
  }

  /**
   * JWT 토큰 생성
   */
  private generateToken(user: User): string {
    const payload = {
      sub: user.id,
      username: user.username,
      name: user.name,
    };

    return this.jwtService.sign(payload);
  }

  /**
   * 사용자 ID로 조회 (JWT 검증용)
   */
  async findById(id: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }
}
