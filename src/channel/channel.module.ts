import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelController } from './channel.controller';
import { ChannelService } from './channel.service';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';
import { Channel } from './entities/channel.entity';
import { ChannelMember } from './entities/channel-member.entity';
import { Team } from './entities/team.entity';
import { JoinRequest } from './entities/join-request.entity';
import { User } from '../auth/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Channel, ChannelMember, Team, JoinRequest, User])],
  controllers: [ChannelController, TeamController],
  providers: [ChannelService, TeamService],
  exports: [ChannelService, TeamService],
})
export class ChannelModule {}

