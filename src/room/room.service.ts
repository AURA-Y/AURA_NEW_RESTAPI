import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, Brackets } from "typeorm";
import { Room } from "./entities/room.entity";
import { RoomReport } from "./entities/room-report.entity";
import { ChannelMember } from "../channel/entities/channel-member.entity";
import { Channel } from "../channel/entities/channel.entity";
import { CreateRoomDto } from "./dto/create-room.dto";

@Injectable()
export class RoomService {
  private readonly logger = new Logger(RoomService.name);

  constructor(
    @InjectRepository(Room)
    private roomRepository: Repository<Room>,
    @InjectRepository(RoomReport)
    private roomReportRepository: Repository<RoomReport>,
    @InjectRepository(ChannelMember)
    private channelMemberRepository: Repository<ChannelMember>,
    @InjectRepository(Channel)
    private channelRepository: Repository<Channel>,
  ) { }

  /**
   * 공유 링크 생성 (roomId 기반)
   */
  private generateShareLink(roomId: string): string {
    // roomId에서 고유 부분 추출 (room-timestamp-random에서 random 부분)
    const parts = roomId.split("-");
    const shortId = parts.length >= 3 ? parts[2] : roomId.slice(-8);
    return `aura.ai.kr/join/${shortId}`;
  }

  async createRoom(data: CreateRoomDto): Promise<Room> {
    const room = this.roomRepository.create({
      roomId: data.roomId,
      roomTopic: data.roomTopic,
      roomDescription: data.roomDescription || null,
      masterId: data.masterId,
      channelId: data.channelId,
      participantUserIds: data.participantUserIds || [],  // 빈 배열 = 전체 공개
      roomPassword: data.roomPassword || null,
      roomShareLink: this.generateShareLink(data.roomId),
      attendees: data.attendees || [],
      token: data.token || null,
      tags: data.tags || [],
      uploadFileList: data.uploadFileList || [],
    });
    return this.roomRepository.save(room);
  }

  async getAllRooms(): Promise<Room[]> {
    return this.roomRepository.find({
      order: { createdAt: "DESC" },
      relations: ["master", "channel"],
    });
  }

  async getRoomById(roomId: string): Promise<Room> {
    const room = await this.roomRepository.findOne({
      where: { roomId },
      relations: ["master", "channel"],
    });

    if (!room) {
      throw new NotFoundException(`Room not found: ${roomId}`);
    }

    return room;
  }

  /**
   * 접근 권한을 확인한 후 방 정보 조회
   */
  async getRoomByIdWithAccessCheck(roomId: string, userId: string): Promise<Room> {
    const room = await this.getRoomById(roomId);

    // 접근 권한 확인
    const hasAccess = await this.checkRoomAccess(roomId, userId);
    if (!hasAccess) {
      throw new ForbiddenException('이 회의에 접근할 권한이 없습니다');
    }

    return room;
  }

  async getRoomByTopic(roomTopic: string): Promise<{ roomId: string }> {
    const room = await this.roomRepository.findOne({
      where: { roomTopic },
      select: ["roomId"],
    });

    if (!room) {
      throw new NotFoundException(`Room with topic "${roomTopic}" not found`);
    }

    return { roomId: room.roomId };
  }

  async getRoomByShareLink(roomShareLink: string): Promise<Room> {
    const room = await this.roomRepository.findOne({
      where: { roomShareLink },
      relations: ["master", "channel"],
    });

    if (!room) {
      throw new NotFoundException(`Room not found for share link`);
    }

    return room;
  }

  async deleteRoom(roomId: string, userId: string): Promise<void> {
    const room = await this.getRoomById(roomId);

    if (room.masterId !== userId) {
      throw new ForbiddenException("Only the master can delete this room");
    }

    // Room 삭제 전에 attendees를 RoomReport에 동기화 (Room 삭제 후 웹훅에서 사용)
    if (room.attendees && room.attendees.length > 0) {
      const report = await this.roomReportRepository.findOne({
        where: { reportId: roomId },
      });

      if (report) {
        // Room의 attendees를 RoomReport에 병합 (중복 제거)
        const mergedAttendees = [...new Set([...report.attendees, ...room.attendees])];
        await this.roomReportRepository.update(
          { reportId: roomId },
          { attendees: mergedAttendees }
        );
        console.log(`[Room 삭제] RoomReport attendees 동기화: ${mergedAttendees.join(', ')}`);
      }
    }

    // Room 삭제 (RoomReport는 FK 없이 독립적으로 유지됨)
    await this.roomRepository.delete({ roomId });
  }

  async addAttendee(roomId: string, nickName: string): Promise<Room> {
    const room = await this.getRoomById(roomId);

    // nickName으로 저장 (중복 체크)
    if (!room.attendees.includes(nickName)) {
      room.attendees.push(nickName);
      await this.roomRepository.save(room);

      // Report 테이블도 함께 업데이트 (reportId = roomId)
      const report = await this.roomReportRepository.findOne({
        where: { reportId: roomId },
      });

      if (report && !report.attendees.includes(nickName)) {
        report.attendees.push(nickName);
        await this.roomReportRepository.save(report);
      }
    }

    return room;
  }

  /**
   * 접근 권한을 확인한 후 참가자 추가
   */
  async addAttendeeWithAccessCheck(roomId: string, userId: string, nickName: string): Promise<Room> {
    // 접근 권한 확인
    const hasAccess = await this.checkRoomAccess(roomId, userId);
    if (!hasAccess) {
      throw new ForbiddenException('이 회의에 참여할 권한이 없습니다');
    }

    return this.addAttendee(roomId, nickName);
  }

  async checkUserRole(
    roomId: string,
    userId: string
  ): Promise<{ isMaster: boolean; role: "master" | "attendee" }> {
    const room = await this.getRoomById(roomId);

    const isMaster = room.masterId === userId;

    return {
      isMaster,
      role: isMaster ? "master" : "attendee",
    };
  }

  async leaveRoom(roomId: string, nickName: string): Promise<void> {
    // 참여자 목록에서 제거하지 않음 (한번 참여한 기록 유지)
    // 방 삭제는 LiveKit webhook에서 처리
    console.log(`User ${nickName} left room ${roomId} (attendees preserved)`);
  }

  /**
   * 채널 ID로 해당 채널의 모든 방 조회
   */
  async getRoomsByChannelId(channelId: string): Promise<Room[]> {
    return this.roomRepository.find({
      where: { channelId },
      order: { createdAt: "DESC" },
      relations: ["master"],
    });
  }

  /**
   * 사용자가 접근 가능한 방 목록 조회
   * - participantUserIds가 빈 배열이면 전체 공개 (채널 멤버면 접근 가능)
   * - participantUserIds가 있으면 해당 유저만 접근 가능
   */
  async getAccessibleRooms(userId: string, channelId: string): Promise<Room[]> {
    // 1. 사용자의 채널 멤버십 조회
    const membership = await this.channelMemberRepository.findOne({
      where: { userId, channelId }
    });

    if (!membership) {
      throw new ForbiddenException('채널 멤버가 아닙니다');
    }

    // 2. 접근 가능한 회의 조회
    // participantUserIds가 빈 배열이거나, 사용자 ID가 포함된 경우
    const queryBuilder = this.roomRepository
      .createQueryBuilder('room')
      .leftJoinAndSelect('room.master', 'master')
      .leftJoinAndSelect('room.channel', 'channel')
      .where('room.channelId = :channelId', { channelId })
      .andWhere(
        '(room.participantUserIds = :emptyArray OR :userId = ANY(room.participantUserIds))',
        {
          emptyArray: '{}',
          userId
        }
      );

    return queryBuilder
      .orderBy('room.createdAt', 'DESC')
      .getMany();
  }

  /**
   * 사용자가 특정 방에 접근 가능한지 확인
   */
  async checkRoomAccess(roomId: string, userId: string): Promise<boolean> {
    const room = await this.roomRepository.findOne({
      where: { roomId },
      select: ['roomId', 'channelId', 'participantUserIds']
    });

    if (!room) return false;

    // 채널 멤버십 확인
    const membership = await this.channelMemberRepository.findOne({
      where: { userId, channelId: room.channelId }
    });

    if (!membership) return false;

    // 전체 공개인 경우 (participantUserIds가 빈 배열)
    if (!room.participantUserIds || room.participantUserIds.length === 0) {
      return true;
    }

    // 유저 제한인 경우 - 사용자 ID가 포함되어 있는지 확인
    return room.participantUserIds.includes(userId);
  }

  /**
   * 채널 내 태그로 방 검색 (AND 조건: 모든 태그 포함)
   */
  async searchRoomsByTags(channelId: string, tags: string[]): Promise<Room[]> {
    if (!tags || tags.length === 0) {
      return this.getRoomsByChannelId(channelId);
    }

    const queryBuilder = this.roomRepository
      .createQueryBuilder("room")
      .leftJoinAndSelect("room.master", "master")
      .leftJoinAndSelect("room.team", "team")
      .where("room.channelId = :channelId", { channelId });

    // 각 태그가 tags 배열에 포함되어 있는지 확인 (AND 조건)
    tags.forEach((tag, index) => {
      queryBuilder.andWhere(`:tag${index} = ANY(room.tags)`, { [`tag${index}`]: tag });
    });

    return queryBuilder
      .orderBy("room.createdAt", "DESC")
      .getMany();
  }

  /**
   * 채널 내 모든 태그 목록 조회 (자동완성용)
   */
  async getTagsByChannel(channelId: string): Promise<string[]> {
    const rooms = await this.roomRepository.find({
      where: { channelId },
      select: ["tags"],
    });

    // 모든 태그를 합치고 중복 제거
    const allTags = rooms.flatMap(room => room.tags || []);
    const uniqueTags = [...new Set(allTags)];
    return uniqueTags.sort();
  }

  /**
   * 키워드로 방 검색 (제목, 설명, 태그)
   */
  async searchRooms(channelId: string, keyword?: string, tags?: string[]): Promise<Room[]> {
    const queryBuilder = this.roomRepository
      .createQueryBuilder("room")
      .leftJoinAndSelect("room.master", "master")
      .leftJoinAndSelect("room.team", "team")
      .where("room.channelId = :channelId", { channelId });

    // 키워드 검색 (제목 또는 설명에 포함)
    if (keyword && keyword.trim()) {
      const searchKeyword = `%${keyword.trim()}%`;
      queryBuilder.andWhere(
        "(room.roomTopic ILIKE :keyword OR room.roomDescription ILIKE :keyword)",
        { keyword: searchKeyword }
      );
    }

    // 태그 필터링 (AND 조건)
    if (tags && tags.length > 0) {
      tags.forEach((tag, index) => {
        queryBuilder.andWhere(`:tag${index} = ANY(room.tags)`, { [`tag${index}`]: tag });
      });
    }

    return queryBuilder
      .orderBy("room.createdAt", "DESC")
      .getMany();
  }

  /**
   * 회의 생성 시 Slack으로 초대 알림 전송
   */
  async sendSlackMeetingInvite(params: {
    channelId: string;
    roomId: string;
    roomTopic: string;
    roomDescription?: string;
    masterNickName: string;
    scheduledAt?: Date;
  }): Promise<{ success: boolean; message: string }> {
    const { channelId, roomId, roomTopic, roomDescription, masterNickName, scheduledAt } = params;

    // 채널 조회
    const channel = await this.channelRepository.findOne({
      where: { channelId },
    });

    if (!channel) {
      this.logger.warn(`[Slack 초대] 채널을 찾을 수 없음: ${channelId}`);
      return { success: false, message: 'Channel not found' };
    }

    // Slack 웹훅 URL 확인
    if (!channel.slackWebhookUrl) {
      this.logger.debug(`[Slack 초대] 웹훅 URL 미설정: ${channelId}`);
      return { success: false, message: 'Slack webhook not configured' };
    }

    // 시간 포맷팅
    const now = new Date();
    const timeText = scheduledAt
      ? new Date(scheduledAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
      : now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

    // Slack 메시지 구성
    const slackMessage = {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '📢 새로운 회의가 생성되었습니다',
            emoji: true,
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*📝 회의 주제:*\n${roomTopic}`,
            },
            {
              type: 'mrkdwn',
              text: `*👤 주최자:*\n${masterNickName}`,
            },
          ],
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*🕐 시작 시간:*\n${timeText}`,
            },
            {
              type: 'mrkdwn',
              text: `*🔗 참여 링크:*\n<https://aura.ai.kr/room/${roomId}|회의 참여하기>`,
            },
          ],
        },
        ...(roomDescription ? [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*📋 회의 설명:*\n${roomDescription}`,
          },
        }] : []),
        {
          type: 'divider',
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '_AURA 회의 시스템에서 발송됨_',
            },
          ],
        },
      ],
    };

    try {
      const response = await fetch(channel.slackWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(slackMessage),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`[Slack 초대] 웹훅 전송 실패: ${errorText}`);
        return { success: false, message: 'Failed to send Slack message' };
      }

      this.logger.log(`[Slack 초대] 알림 전송 성공: ${roomTopic} (채널: ${channel.channelName})`);
      return { success: true, message: 'Successfully sent Slack invite' };
    } catch (error) {
      this.logger.error(`[Slack 초대] 전송 오류: ${error.message}`);
      return { success: false, message: 'Failed to connect to Slack' };
    }
  }
}
