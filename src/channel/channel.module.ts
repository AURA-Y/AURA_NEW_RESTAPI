import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelController } from './channel.controller';
import { ChannelService } from './channel.service';
import { Channel } from './entities/channel.entity';
import { User } from '../auth/entities/user.entity';
import { ChannelMember } from './entities/channel-member.entity';
import { Team } from './entities/team.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Channel, User, ChannelMember, Team]), // 엔티티 등록
  ],
  controllers: [ChannelController],
  providers: [ChannelService],
  exports: [ChannelService],
})
export class ChannelModule {}
