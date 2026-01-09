import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { ReportsModule } from './reports/reports.module';
import { RoomModule } from './room/room.module';
import { ChannelModule } from './channel/channel.module';
import { User } from './auth/entities/user.entity';
import { Channel } from './channel/entities/channel.entity';
import { ChannelMember } from './channel/entities/channel-member.entity';
import { Team } from './channel/entities/team.entity';
import { HealthController } from './health/health.controller';
import {
  Room,
  RoomReport,
} from './room/entities';


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
          Room,
          RoomReport,
        ],
        synchronize: configService.get<string>('NODE_ENV') !== 'production',
        logging: configService.get<string>('NODE_ENV') !== 'production',
        ssl:
          configService.get<string>('DB_SSL') === 'true'
            ? { rejectUnauthorized: false }
            : false,
      }),
    }),
    AuthModule,
    ReportsModule,
    RoomModule,
    ChannelModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
