import { Controller, Get, Post, Put, Patch, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ChannelService } from './channel.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { ShareToSlackDto } from './dto/share-to-slack.dto';
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
    return this.channelService.createChannel(createChannelDto, req.user.id);
  }

  /**
   * GET /channels/my - 내 채널 목록 조회
   */
  @Get('my')
  async getMyChannels(@Request() req) {
    return this.channelService.getMyChannels(req.user.id);
  }

  /**
   * GET /channels - 모든 채널 목록 조회 (채널 검색용)
   * 채널 메타데이터만 반환 (channelId, channelName, createdAt, owner 정보)
   */
  @Get()
  async getAllChannels() {
    return this.channelService.getAllChannels();
  }

  /**
   * GET /channels/my-pending-requests - 내가 보낸 대기 중인 가입 요청 목록
   * 주의: :channelId 라우트보다 먼저 정의해야 함
   */
  @Get('my-pending-requests')
  async getMyPendingJoinRequests(@Request() req) {
    return this.channelService.getMyPendingJoinRequests(req.user.id);
  }

  /**
   * GET /channels/:channelId - 특정 채널 상세 조회
   */
  @Get(':channelId')
  async getChannelById(@Param('channelId') channelId: string, @Request() req) {
    return this.channelService.getChannelById(channelId, req.user.id);
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
    return this.channelService.updateChannel(channelId, updateChannelDto, req.user.id);
  }

  /**
   * DELETE /channels/:channelId - 채널 삭제
   */
  @Delete(':channelId')
  async deleteChannel(@Param('channelId') channelId: string, @Request() req) {
    return this.channelService.deleteChannel(channelId, req.user.id);
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
    return this.channelService.addMember(channelId, targetUserId, req.user.id, role);
  }

  /**
   * PATCH /channels/:channelId/members/:userId/role - 멤버 권한 변경
   * @returns boolean - 성공 여부
   */
  @Patch(':channelId/members/:userId/role')
  async updateMemberRole(
    @Param('channelId') channelId: string,
    @Param('userId') targetUserId: string,
    @Body('role') role: string,
    @Request() req
  ): Promise<boolean> {
    return this.channelService.updateMemberRole(channelId, targetUserId, req.user.id, role);
  }

  /**
   * DELETE /channels/:channelId/members/:userId - 채널에서 멤버 제거
   * @returns boolean - 성공 여부
   */
  @Delete(':channelId/members/:userId')
  async removeMember(
    @Param('channelId') channelId: string,
    @Param('userId') targetUserId: string,
    @Request() req
  ): Promise<boolean> {
    return this.channelService.removeMember(channelId, targetUserId, req.user.id);
  }

  // ==================== Join Request Endpoints ====================

  /**
   * POST /channels/:channelId/join-request - 가입 요청 생성
   */
  @Post(':channelId/join-request')
  async createJoinRequest(
    @Param('channelId') channelId: string,
    @Request() req
  ) {
    return this.channelService.createJoinRequest(channelId, req.user.id);
  }

  /**
   * GET /channels/:channelId/join-requests - 채널의 가입 요청 목록 조회 (Owner만)
   */
  @Get(':channelId/join-requests')
  async getJoinRequests(
    @Param('channelId') channelId: string,
    @Request() req
  ) {
    return this.channelService.getJoinRequests(channelId, req.user.id);
  }

  /**
   * PATCH /channels/join-requests/:requestId/approve - 가입 요청 승인
   */
  @Patch('join-requests/:requestId/approve')
  async approveJoinRequest(
    @Param('requestId') requestId: string,
    @Request() req
  ) {
    return this.channelService.approveJoinRequest(requestId, req.user.id);
  }

  /**
   * PATCH /channels/join-requests/:requestId/reject - 가입 요청 거절
   */
  @Patch('join-requests/:requestId/reject')
  async rejectJoinRequest(
    @Param('requestId') requestId: string,
    @Request() req
  ) {
    return this.channelService.rejectJoinRequest(requestId, req.user.id);
  }

  // ==================== Slack Integration Endpoints ====================

  /**
   * POST /channels/:channelId/slack/share - Slack으로 회의록 공유
   */
  @Post(':channelId/slack/share')
  async shareToSlack(
    @Param('channelId') channelId: string,
    @Body() shareDto: ShareToSlackDto,
    @Request() req
  ) {
    return this.channelService.shareToSlack(channelId, shareDto, req.user.id);
  }

  /**
   * GET /channels/:channelId/slack/status - Slack 웹훅 설정 여부 확인
   */
  @Get(':channelId/slack/status')
  async getSlackStatus(
    @Param('channelId') channelId: string,
    @Request() req
  ) {
    const hasWebhook = await this.channelService.hasSlackWebhook(channelId, req.user.id);
    return { hasWebhook };
  }
}
