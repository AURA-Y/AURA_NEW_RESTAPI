import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoomController } from './room.controller';
import { RoomService } from './room.service';
import { Room, RoomReport } from './entities';
import { ChannelMember } from '../channel/entities/channel-member.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Room, RoomReport, ChannelMember])],
  controllers: [RoomController],
  providers: [RoomService],
  exports: [RoomService],
})
export class RoomModule {}
