import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SseController } from './sse.controller';
import { SseService } from './sse.service';
import { User } from '../auth/entities/user.entity';
import { Room } from '../room/entities/room.entity';
import { RoomReport } from '../room/entities/room-report.entity';
import { ReportsModule } from '../reports/reports.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Room, RoomReport]),
    forwardRef(() => ReportsModule),
  ],
  controllers: [SseController],
  providers: [SseService],
  exports: [SseService],
})
export class SseModule {}
