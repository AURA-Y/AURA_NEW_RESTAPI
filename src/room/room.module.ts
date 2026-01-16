import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoomController } from './room.controller';
import { RoomService } from './room.service';
import { Room, RoomReport } from './entities';
import { ChannelMember } from '../channel/entities/channel-member.entity';
import { Channel } from '../channel/entities/channel.entity';
import { SseModule } from '../sse/sse.module';
import { ReportsModule } from '../reports/reports.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Room, RoomReport, ChannelMember, Channel]),
    forwardRef(() => SseModule),
    forwardRef(() => ReportsModule),
  ],
  controllers: [RoomController],
  providers: [RoomService],
  exports: [RoomService],
})
export class RoomModule {}
