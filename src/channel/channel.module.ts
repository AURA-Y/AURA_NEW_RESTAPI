import { Module } from '@nestjs/common';
import { ChannelController } from './channel.controller';
import { ChannelService } from './channel.service';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';

@Module({
  controllers: [ChannelController, TeamController],
  providers: [ChannelService, TeamService],
  exports: [ChannelService, TeamService],
})
export class ChannelModule {}
