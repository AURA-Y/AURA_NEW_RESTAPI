import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { ReportsModule } from './reports/reports.module';
import { RoomModule } from './room/room.module';
import { ChannelModule } from './channel/channel.module';
import { SseModule } from './sse/sse.module';
import { CalendarModule } from './calendar/calendar.module';
import { RecordingsModule } from './recordings/recordings.module';
import { User } from './auth/entities/user.entity';
import { Channel } from './channel/entities/channel.entity';
import { ChannelMember } from './channel/entities/channel-member.entity';
import { Team } from './channel/entities/team.entity';
import { JoinRequest } from './channel/entities/join-request.entity';
import { HealthController } from './health/health.controller';
import {
  Room,
  RoomReport,
} from './room/entities';

// GitHub Issue Integration 모듈
import { PrismaModule } from './prisma/prisma.module';
import { SecretsModule } from './secrets/secrets.module';
import { EncryptionModule } from './encryption/encryption.module';
import { GitHubModule } from './github/github.module';

// 회의 예약 스케줄러 모듈
import { SchedulerModule } from './scheduler/scheduler.module';

// Push 알림 모듈
import { NotificationsModule } from './notifications/notifications.module';


@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres' as const,
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 5432),
        username: configService.get<string>('DB_USERNAME', 'postgres'),
        password: configService.get<string>('DB_PASSWORD', 'postgres'),
        database: configService.get<string>('DB_NAME', 'aura'),
        entities: [
          User,
          Channel,
          ChannelMember,
          Team,
          JoinRequest,
          Room,
          RoomReport,
        ],
        // Prisma가 스키마를 관리하므로 TypeORM synchronize 비활성화
        synchronize: false,
        logging: configService.get<string>('NODE_ENV') !== 'production',
        ssl:
          configService.get<string>('DB_SSL') === 'true'
            ? { rejectUnauthorized: false }
            : false,
      }),
    }),
    // Global 모듈 (GitHub Issue Integration)
    PrismaModule,
    SecretsModule,
    EncryptionModule,
    SchedulerModule,

    // 기존 모듈
    AuthModule,
    ReportsModule,
    RoomModule,
    ChannelModule,
    SseModule,
    CalendarModule,
    RecordingsModule,

    // GitHub 모듈
    GitHubModule,

    // Push 알림 모듈
    NotificationsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
