import { Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { Channel } from './entities/channel.entity';
import { ChannelMember, ChannelRole } from './entities/channel-member.entity';
import { JoinRequest, JoinRequestStatus } from './entities/join-request.entity';
import { User } from '../auth/entities/user.entity';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { ShareToSlackDto } from './dto/share-to-slack.dto';

@Injectable()
export class ChannelService {
  private readonly logger = new Logger(ChannelService.name);

  constructor(
    @InjectRepository(Channel)
    private channelRepository: Repository<Channel>,
    @InjectRepository(ChannelMember)
    private channelMemberRepository: Repository<ChannelMember>,
    @InjectRepository(JoinRequest)
    private joinRequestRepository: Repository<JoinRequest>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  /**
   * 채널 생성
   */
  async createChannel(createChannelDto: CreateChannelDto, userId: string) {
    const { channelName } = createChannelDto;

    // 사용자 확인
    const user = await this.userRepository.findOne({
      where: { userId }
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // 채널 생성
    const channel = this.channelRepository.create({
      channelName,
      ownerId: userId,
    });

    await this.channelRepository.save(channel);

    // 소유자를 자동으로 멤버로 추가
    const ownerMember = this.channelMemberRepository.create({
      channelId: channel.channelId,
      userId: userId,
      role: ChannelRole.OWNER,
    });

    await this.channelMemberRepository.save(ownerMember);

    // 생성된 채널 정보 반환 (relations 포함)
    return this.channelRepository.findOne({
      where: { channelId: channel.channelId },
      relations: ['owner', 'members', 'members.user'],
    });
  }

  /**
   * 내 채널 목록 조회 (내가 소유하거나 참여 중인)
   */
  async getMyChannels(userId: string) {
    const channels = await this.channelRepository
      .createQueryBuilder('channel')
      .leftJoinAndSelect('channel.owner', 'owner')
      .leftJoinAndSelect('channel.members', 'members')
      .leftJoinAndSelect('members.user', 'user')
      .leftJoinAndSelect('members.team', 'memberTeam')
      .leftJoinAndSelect('channel.teams', 'teams')
      .leftJoinAndSelect('teams.members', 'teamMembers')
      .leftJoinAndSelect('teamMembers.user', 'teamMemberUser')
      .leftJoin('channel.members', 'myMembership')
      .where('myMembership.userId = :userId', { userId })
      .orderBy('channel.createdAt', 'ASC')
      .getMany();

    return channels;
  }

  /**
   * 모든 채널 목록 조회 (채널 검색용 - 메타데이터만)
   */
  async getAllChannels() {
    const channels = await this.channelRepository
      .createQueryBuilder('channel')
      .leftJoinAndSelect('channel.owner', 'owner')
      .select([
        'channel.channelId',
        'channel.channelName',
        'channel.createdAt',
        'owner.userId',
        'owner.nickName',
        'owner.email',
      ])
      .orderBy('channel.createdAt', 'DESC')
      .getMany();

    return channels;
  }

  /**
   * 특정 채널 상세 조회
   */
  async getChannelById(channelId: string, userId: string) {
    // 채널 존재 및 접근 권한 확인
    const channel = await this.channelRepository
      .createQueryBuilder('channel')
      .leftJoinAndSelect('channel.owner', 'owner')
      .leftJoinAndSelect('channel.members', 'members')
      .leftJoinAndSelect('members.user', 'user')
      .leftJoinAndSelect('members.team', 'memberTeam')
      .leftJoinAndSelect('channel.teams', 'teams')
      .leftJoinAndSelect('teams.members', 'teamMembers')
      .leftJoinAndSelect('teamMembers.user', 'teamMemberUser')
      .leftJoin('channel.members', 'myMembership')
      .where('channel.channelId = :channelId', { channelId })
      .andWhere('myMembership.userId = :userId', { userId })
      .getOne();

    if (!channel) {
      throw new NotFoundException('Channel not found or access denied');
    }

    return channel;
  }

  /**
   * 채널 수정 (소유자만 가능)
   */
  async updateChannel(channelId: string, updateChannelDto: UpdateChannelDto, userId: string) {
    // 채널 존재 및 소유자 확인
    const channel = await this.channelRepository.findOne({
      where: { channelId },
      relations: ['owner']
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    if (channel.ownerId !== userId) {
      throw new ForbiddenException('Only channel owner can update the channel');
    }

    // 채널 업데이트
    Object.assign(channel, updateChannelDto);
    await this.channelRepository.save(channel);

    // 업데이트된 채널 정보 반환
    return this.channelRepository.findOne({
      where: { channelId },
      relations: ['owner', 'members', 'members.user', 'teams'],
    });
  }

  /**
   * 채널 삭제 (소유자만 가능)
   */
  async deleteChannel(channelId: string, userId: string) {
    // 채널 존재 및 소유자 확인
    const channel = await this.channelRepository.findOne({
      where: { channelId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    if (channel.ownerId !== userId) {
      throw new ForbiddenException('Only channel owner can delete the channel');
    }

    // 채널 삭제 (CASCADE로 관련 데이터도 삭제됨)
    await this.channelRepository.delete({ channelId });

    return { message: 'Channel deleted successfully' };
  }

  /**
   * 채널 멤버 추가
   */
  async addMember(channelId: string, targetUserId: string, requestUserId: string, role: string = 'MEMBER') {
    // 채널 존재 확인
    const channel = await this.channelRepository.findOne({
      where: { channelId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    // 요청자가 OWNER 또는 ADMIN인지 확인
    const requesterMember = await this.channelMemberRepository.findOne({
      where: {
        channelId,
        userId: requestUserId,
      }
    });

    if (!requesterMember || (requesterMember.role !== ChannelRole.OWNER && requesterMember.role !== ChannelRole.ADMIN)) {
      throw new ForbiddenException('Only channel owner or admin can add members');
    }

    // 대상 사용자 존재 확인
    const targetUser = await this.userRepository.findOne({
      where: { userId: targetUserId },
    });

    if (!targetUser) {
      throw new NotFoundException('Target user not found');
    }

    // 이미 멤버인지 확인
    const existingMember = await this.channelMemberRepository.findOne({
      where: {
        channelId,
        userId: targetUserId,
      }
    });

    if (existingMember) {
      throw new ConflictException('User is already a member of this channel');
    }

    // 멤버 추가
    const newMember = this.channelMemberRepository.create({
      channelId,
      userId: targetUserId,
      role: role as ChannelRole,
    });

    await this.channelMemberRepository.save(newMember);

    // 추가된 멤버 정보 반환
    return this.channelMemberRepository.findOne({
      where: { channelId, userId: targetUserId },
      relations: ['user'],
    });
  }

  /**
   * 멤버 권한 변경 (채널 소유자만 가능)
   * @returns boolean - 성공 여부
   */
  async updateMemberRole(
    channelId: string,
    targetUserId: string,
    requestUserId: string,
    role: string
  ): Promise<boolean> {
    // 채널 존재 확인
    const channel = await this.channelRepository.findOne({
      where: { channelId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    // 요청자가 OWNER인지 확인 (권한 변경은 Owner만 가능)
    if (channel.ownerId !== requestUserId) {
      throw new ForbiddenException('Only channel owner can change member roles');
    }

    // 대상 멤버 조회
    const targetMember = await this.channelMemberRepository.findOne({
      where: {
        channelId,
        userId: targetUserId,
      }
    });

    if (!targetMember) {
      throw new NotFoundException('Member not found in this channel');
    }

    // Owner 권한은 변경 불가
    if (targetMember.role === ChannelRole.OWNER) {
      throw new ForbiddenException('Cannot change owner role');
    }

    // 권한 업데이트
    targetMember.role = role as ChannelRole;
    await this.channelMemberRepository.save(targetMember);

    return true;
  }

  /**
   * 채널에서 멤버 제거 (채널 소유자만 가능)
   * @returns boolean - 성공 여부
   */
  async removeMember(
    channelId: string,
    targetUserId: string,
    requestUserId: string
  ): Promise<boolean> {
    // 채널 존재 확인
    const channel = await this.channelRepository.findOne({
      where: { channelId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    // 요청자가 OWNER인지 확인
    if (channel.ownerId !== requestUserId) {
      throw new ForbiddenException('Only channel owner can remove members');
    }

    // Owner 본인은 제거 불가
    if (channel.ownerId === targetUserId) {
      throw new ForbiddenException('Cannot remove channel owner');
    }

    // 멤버 삭제
    const result = await this.channelMemberRepository.delete({
      channelId,
      userId: targetUserId,
    });

    return result.affected !== undefined && result.affected > 0;
  }

  // ==================== Join Request Methods ====================

  /**
   * 가입 요청 생성
   */
  async createJoinRequest(channelId: string, userId: string) {
    // 채널 존재 확인
    const channel = await this.channelRepository.findOne({
      where: { channelId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    // 이미 멤버인지 확인
    const existingMember = await this.channelMemberRepository.findOne({
      where: { channelId, userId },
    });

    if (existingMember) {
      throw new ConflictException('You are already a member of this channel');
    }

    // 이미 대기 중인 요청이 있는지 확인
    const existingRequest = await this.joinRequestRepository.findOne({
      where: { channelId, userId, status: JoinRequestStatus.PENDING },
    });

    if (existingRequest) {
      throw new ConflictException('You already have a pending join request');
    }

    // 가입 요청 생성
    const joinRequest = this.joinRequestRepository.create({
      channelId,
      userId,
    });

    return this.joinRequestRepository.save(joinRequest);
  }

  /**
   * 채널의 가입 요청 목록 조회 (Owner만)
   */
  async getJoinRequests(channelId: string, requestUserId: string) {
    // 채널 조회 및 Owner 확인
    const channel = await this.channelRepository.findOne({
      where: { channelId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    if (channel.ownerId !== requestUserId) {
      throw new ForbiddenException('Only channel owner can view join requests');
    }

    // PENDING 상태의 요청만 조회
    return this.joinRequestRepository.find({
      where: { channelId, status: JoinRequestStatus.PENDING },
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * 가입 요청 승인
   */
  async approveJoinRequest(requestId: string, requestUserId: string) {
    const joinRequest = await this.joinRequestRepository.findOne({
      where: { id: requestId },
      relations: ['channel'],
    });

    if (!joinRequest) {
      throw new NotFoundException('Join request not found');
    }

    // Owner만 승인 가능
    if (joinRequest.channel.ownerId !== requestUserId) {
      throw new ForbiddenException('Only channel owner can approve requests');
    }

    if (joinRequest.status !== JoinRequestStatus.PENDING) {
      throw new ConflictException('This request has already been processed');
    }

    // 만료 시간 설정 (처리 후 24시간)
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    // 요청 상태 업데이트
    await this.joinRequestRepository.update(requestId, {
      status: JoinRequestStatus.APPROVED,
      processedAt: new Date(),
      expiresAt,
    });

    // ChannelMember로 추가
    const newMember = this.channelMemberRepository.create({
      channelId: joinRequest.channelId,
      userId: joinRequest.userId,
      role: ChannelRole.MEMBER,
    });

    await this.channelMemberRepository.save(newMember);

    return { success: true, message: 'Join request approved' };
  }

  /**
   * 가입 요청 거절
   */
  async rejectJoinRequest(requestId: string, requestUserId: string) {
    const joinRequest = await this.joinRequestRepository.findOne({
      where: { id: requestId },
      relations: ['channel'],
    });

    if (!joinRequest) {
      throw new NotFoundException('Join request not found');
    }

    // Owner만 거절 가능
    if (joinRequest.channel.ownerId !== requestUserId) {
      throw new ForbiddenException('Only channel owner can reject requests');
    }

    if (joinRequest.status !== JoinRequestStatus.PENDING) {
      throw new ConflictException('This request has already been processed');
    }

    // 만료 시간 설정 (처리 후 24시간)
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    // 요청 상태 업데이트
    await this.joinRequestRepository.update(requestId, {
      status: JoinRequestStatus.REJECTED,
      processedAt: new Date(),
      expiresAt,
    });

    return { success: true, message: 'Join request rejected' };
  }

  /**
   * 내가 보낸 대기 중인 가입 요청 목록 조회
   */
  async getMyPendingJoinRequests(userId: string) {
    return this.joinRequestRepository.find({
      where: { userId, status: JoinRequestStatus.PENDING },
      select: ['id', 'channelId', 'createdAt'],
    });
  }

  // ==================== Slack Integration ====================

  /**
   * 일반 마크다운을 Slack mrkdwn 포맷으로 변환
   */
  private convertToSlackMarkdown(text: string): string {
    // 1. 첫 번째 "## 회의 요약" 이전 내용 제거 (제목, 일시, 구분선)
    let processed = text;
    const summaryStartMatch = text.match(/## 회의 요약/);
    if (summaryStartMatch && summaryStartMatch.index !== undefined) {
      processed = text.substring(summaryStartMatch.index);
    }

    return processed
      // **bold** → *bold*
      .replace(/\*\*(.+?)\*\*/g, '*$1*')
      // # Heading → *Heading*
      .replace(/^### (.+)$/gm, '*$1*')
      .replace(/^## (.+)$/gm, '*$1*')
      .replace(/^# (.+)$/gm, '*$1*')
      // --- → ─────────────
      .replace(/^---$/gm, '─────────────────────')
      // - item → • item
      .replace(/^- (.+)$/gm, '• $1')
      // `code` → `code` (동일)
      // > quote → > quote (동일)
      ;
  }

  /**
   * Slack으로 회의록 공유
   */
  async shareToSlack(channelId: string, shareDto: ShareToSlackDto, userId: string) {
    // 채널 조회
    const channel = await this.channelRepository.findOne({
      where: { channelId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    // 멤버십 확인
    const membership = await this.channelMemberRepository.findOne({
      where: { channelId, userId },
    });

    if (!membership) {
      throw new ForbiddenException('You are not a member of this channel');
    }

    // Slack 웹훅 URL 확인
    if (!channel.slackWebhookUrl) {
      throw new BadRequestException('Slack webhook URL is not configured for this channel');
    }

    // Slack 메시지 구성
    const attendeesText = shareDto.attendees?.length
      ? shareDto.attendees.join(', ')
      : '(참석자 정보 없음)';

    // 마크다운을 Slack 포맷으로 변환
    const slackFormattedSummary = this.convertToSlackMarkdown(shareDto.summary);

    const slackMessage = {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `📝 ${shareDto.title}`,
            emoji: true,
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*📅 회의 일시:*\n${shareDto.date || '날짜 정보 없음'}`,
            },
            {
              type: 'mrkdwn',
              text: `*👥 참석자:*\n${attendeesText}`,
            },
          ],
        },
        {
          type: 'divider',
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: slackFormattedSummary,
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '_AURA 회의 시스템에서 공유됨_',
            },
          ],
        },
      ],
    };

    try {
      // Slack 웹훅으로 전송
      const response = await fetch(channel.slackWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(slackMessage),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Slack webhook failed: ${errorText}`);
        throw new BadRequestException('Failed to send message to Slack');
      }

      this.logger.log(`Meeting report shared to Slack for channel ${channelId}`);
      return { success: true, message: 'Successfully shared to Slack' };
    } catch (error) {
      this.logger.error(`Slack sharing error: ${error.message}`);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Failed to connect to Slack');
    }
  }

  /**
   * 채널의 Slack 웹훅 설정 여부 확인
   */
  async hasSlackWebhook(channelId: string, userId: string): Promise<boolean> {
    const channel = await this.channelRepository.findOne({
      where: { channelId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    // 멤버십 확인
    const membership = await this.channelMemberRepository.findOne({
      where: { channelId, userId },
    });

    if (!membership) {
      throw new ForbiddenException('You are not a member of this channel');
    }

    return !!channel.slackWebhookUrl;
  }
}
