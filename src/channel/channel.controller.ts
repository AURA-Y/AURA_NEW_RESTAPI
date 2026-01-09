import { Controller, Post, Get, Body, UseGuards, Request } from '@nestjs/common';
import { ChannelService } from './channel.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { AuthGuard } from '@nestjs/passport';

@Controller('channels')
@UseGuards(AuthGuard('jwt')) // JWT 인증 필요
export class ChannelController {
  constructor(private readonly channelService: ChannelService) {}

  @Post()
  async create(@Body() createChannelDto: CreateChannelDto, @Request() req) {
    // req.user는 JWT Strategy에서 설정됨 (id 포함)
    return this.channelService.createChannel(createChannelDto, req.user.id);
  }

  @Get('my')
  async getMyChannels(@Request() req) {
    return this.channelService.getMyChannels(req.user.id);
  }
}
