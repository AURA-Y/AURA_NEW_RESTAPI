import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ChannelService } from './channel.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('channels')
@UseGuards(JwtAuthGuard)
export class ChannelController {
  constructor(private readonly channelService: ChannelService) {}

  /**
   * POST /channels - 채널 생성
   */
  @Post()
  async createChannel(@Body() createChannelDto: CreateChannelDto, @Request() req) {
    return this.channelService.createChannel(createChannelDto, req.user.userId);
  }

  /**
   * GET /channels - 내 채널 목록 조회
   */
  @Get()
  async getMyChannels(@Request() req) {
    return this.channelService.getMyChannels(req.user.userId);
  }

  /**
   * GET /channels/:channelId - 특정 채널 상세 조회
   */
  @Get(':channelId')
  async getChannelById(@Param('channelId') channelId: string, @Request() req) {
    return this.channelService.getChannelById(channelId, req.user.userId);
  }

  /**
   * PUT /channels/:channelId - 채널 수정
   */
  @Put(':channelId')
  async updateChannel(
    @Param('channelId') channelId: string,
    @Body() updateChannelDto: UpdateChannelDto,
    @Request() req
  ) {
    return this.channelService.updateChannel(channelId, updateChannelDto, req.user.userId);
  }

  /**
   * DELETE /channels/:channelId - 채널 삭제
   */
  @Delete(':channelId')
  async deleteChannel(@Param('channelId') channelId: string, @Request() req) {
    return this.channelService.deleteChannel(channelId, req.user.userId);
  }

  /**
   * POST /channels/:channelId/members - 채널에 멤버 추가
   */
  @Post(':channelId/members')
  async addMember(
    @Param('channelId') channelId: string,
    @Body('userId') targetUserId: string,
    @Body('role') role: string,
    @Request() req
  ) {
    return this.channelService.addMember(channelId, targetUserId, req.user.userId, role);
  }
}
