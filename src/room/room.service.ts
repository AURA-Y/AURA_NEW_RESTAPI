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
import { ScheduleRoomDto } from "./dto/schedule-room.dto";
import { UpdateScheduleRoomDto } from "./dto/update-schedule-room.dto";

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
      masterId: data.masterId,
      channelId: data.channelId,
      participantUserIds: data.participantUserIds || [],  // 빈 배열 = 전체 공개
      expectedAttendees: data.expectedAttendees || [],  // 예정 참여자 (불참자 확인용)
      roomPassword: data.roomPassword || null,
      roomShareLink: this.generateShareLink(data.roomId),
      attendees: data.attendees || [],
      token: data.token || null,
      tags: data.tags || [],
      uploadFileList: data.uploadFileList || [],
      referencedFiles: data.referencedFiles || [],
      status: "ACTIVE",
    });
    return this.roomRepository.save(room);
  }

  /**
   * 예약 회의 생성 (SCHEDULED 상태로 저장)
   * 반복 예약인 경우 첫 번째 회의만 생성하고, 이후 회의는 onStart 콜백에서 자동 생성
   */
  async createScheduledRoom(data: ScheduleRoomDto): Promise<Room> {
    // roomId 생성: scheduled-{timestamp}-{random}
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const roomId = `scheduled-${timestamp}-${random}`;

    const room = this.roomRepository.create({
      roomId,
      roomTopic: data.roomTopic,
      masterId: data.masterId,
      channelId: data.channelId,
      participantUserIds: data.participantUserIds || [],
      expectedAttendees: data.expectedAttendees || [],
      roomShareLink: this.generateShareLink(roomId),
      attendees: [],
      tags: data.tags || [],
      uploadFileList: data.uploadFileList || [],
      referencedFiles: data.referencedFiles || [],
      // 예약 관련 필드
      scheduledAt: new Date(data.scheduledAt),
      duration: data.duration,
      status: "SCHEDULED",
      // 반복 예약 필드
      recurrenceRule: data.recurrenceRule || "NONE",
      recurrenceEndDate: data.recurrenceEndDate ? new Date(data.recurrenceEndDate) : null,
      parentRoomId: null,  // 원본 회의이므로 null
      recurrenceIndex: 0,  // 첫 번째 회의
    });

    return this.roomRepository.save(room);
  }

  /**
   * 반복 회의의 다음 인스턴스 생성
   * @param parentRoom 원본 회의 (또는 이전 인스턴스)
   * @returns 새로 생성된 다음 회의
   */
  async createNextRecurringRoom(parentRoom: Room): Promise<Room | null> {
    // 반복 규칙 확인
    if (parentRoom.recurrenceRule === "NONE") {
      return null;
    }

    // 다음 예약 시간 계산
    const nextScheduledAt = this.calculateNextScheduledAt(
      parentRoom.scheduledAt,
      parentRoom.recurrenceRule,
    );

    // 반복 종료일 확인
    if (parentRoom.recurrenceEndDate && nextScheduledAt > parentRoom.recurrenceEndDate) {
      this.logger.log(`[반복 회의] 종료일 도달: ${parentRoom.roomId}`);
      return null;
    }

    // 원본 roomId 결정 (시리즈 추적용)
    const originalRoomId = parentRoom.parentRoomId || parentRoom.roomId;

    // 새 roomId 생성
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const roomId = `recurring-${timestamp}-${random}`;

    // 다음 회의 생성
    const nextRoom = this.roomRepository.create({
      roomId,
      roomTopic: parentRoom.roomTopic,
      masterId: parentRoom.masterId,
      channelId: parentRoom.channelId,
      participantUserIds: parentRoom.participantUserIds || [],
      expectedAttendees: parentRoom.expectedAttendees || [],
      roomShareLink: this.generateShareLink(roomId),
      attendees: [],
      tags: parentRoom.tags || [],
      uploadFileList: [],  // 파일은 새로 업로드해야 함
      referencedFiles: [],
      scheduledAt: nextScheduledAt,
      duration: parentRoom.duration,
      status: "SCHEDULED",
      recurrenceRule: parentRoom.recurrenceRule,
      recurrenceEndDate: parentRoom.recurrenceEndDate,
      parentRoomId: originalRoomId,
      recurrenceIndex: parentRoom.recurrenceIndex + 1,
    });

    const savedRoom = await this.roomRepository.save(nextRoom);
    this.logger.log(`[반복 회의] 다음 회의 생성: ${savedRoom.roomId}, 예약 시간: ${nextScheduledAt.toISOString()}`);

    return savedRoom;
  }

  /**
   * 다음 예약 시간 계산
   */
  private calculateNextScheduledAt(
    currentScheduledAt: Date,
    recurrenceRule: string,
  ): Date {
    const next = new Date(currentScheduledAt);

    switch (recurrenceRule) {
      case "DAILY":
        next.setDate(next.getDate() + 1);
        break;
      case "WEEKLY":
        next.setDate(next.getDate() + 7);
        break;
      case "BIWEEKLY":
        next.setDate(next.getDate() + 14);
        break;
      case "MONTHLY":
        next.setMonth(next.getMonth() + 1);
        break;
      default:
        // NONE 또는 알 수 없는 규칙
        break;
    }

    return next;
  }

  /**
   * 반복 회의 시리즈 전체 취소
   */
  async cancelRecurringSeries(parentRoomId: string, userId: string): Promise<number> {
    // 권한 확인을 위해 원본 회의 조회
    const parentRoom = await this.getRoomById(parentRoomId);
    if (parentRoom.masterId !== userId) {
      throw new ForbiddenException("반복 회의 시리즈를 취소할 권한이 없습니다");
    }

    // 시리즈의 모든 SCHEDULED 회의 취소
    const result = await this.roomRepository
      .createQueryBuilder()
      .update(Room)
      .set({ status: "CANCELLED" })
      .where("status = :status", { status: "SCHEDULED" })
      .andWhere(
        "(roomId = :parentRoomId OR parentRoomId = :parentRoomId)",
        { parentRoomId }
      )
      .execute();

    this.logger.log(`[반복 회의] 시리즈 취소: ${result.affected}개 회의 취소됨`);
    return result.affected || 0;
  }

  /**
   * 예약 정보 업데이트 (jobId, calendarEventId 저장)
   */
  async updateSchedulingInfo(roomId: string, info: {
    jobId?: string;
    calendarEventId?: string;
  }): Promise<void> {
    await this.roomRepository.update({ roomId }, info);
  }

  /**
   * 회의 상태 업데이트
   */
  async updateRoomStatus(roomId: string, status: "SCHEDULED" | "ACTIVE" | "ENDED" | "CANCELLED"): Promise<void> {
    await this.roomRepository.update({ roomId }, { status });
  }

  /**
   * 예약된 회의 목록 조회 (특정 사용자)
   */
  async getScheduledRooms(userId: string, channelId?: string): Promise<Room[]> {
    const queryBuilder = this.roomRepository
      .createQueryBuilder("room")
      .leftJoinAndSelect("room.master", "master")
      .leftJoinAndSelect("room.channel", "channel")
      .where("room.status = :status", { status: "SCHEDULED" })
      .andWhere(
        "(room.masterId = :userId OR :userId = ANY(room.participantUserIds))",
        { userId }
      );

    if (channelId) {
      queryBuilder.andWhere("room.channelId = :channelId", { channelId });
    }

    return queryBuilder
      .orderBy("room.scheduledAt", "ASC")
      .getMany();
  }

  /**
   * 예약 취소
   */
  async cancelScheduledRoom(roomId: string, userId: string): Promise<Room> {
    const room = await this.getRoomById(roomId);

    // 권한 확인: 방 생성자만 취소 가능
    if (room.masterId !== userId) {
      throw new ForbiddenException("예약을 취소할 권한이 없습니다");
    }

    // SCHEDULED 상태인지 확인
    if (room.status !== "SCHEDULED") {
      throw new ForbiddenException("예약된 회의만 취소할 수 있습니다");
    }

    room.status = "CANCELLED";
    return this.roomRepository.save(room);
  }

  /**
   * 예약된 회의 수정
   */
  async updateScheduledRoom(
    roomId: string,
    userId: string,
    data: UpdateScheduleRoomDto,
  ): Promise<Room> {
    const room = await this.getRoomById(roomId);

    // 권한 확인: 방 생성자만 수정 가능
    if (room.masterId !== userId) {
      throw new ForbiddenException("예약을 수정할 권한이 없습니다");
    }

    // SCHEDULED 상태인지 확인
    if (room.status !== "SCHEDULED") {
      throw new ForbiddenException("예약된 회의만 수정할 수 있습니다");
    }

    // 새 시작 시간 검증 (5분 이후인지)
    if (data.scheduledAt) {
      const newScheduledAt = new Date(data.scheduledAt);
      const now = new Date();
      const diffMinutes = (newScheduledAt.getTime() - now.getTime()) / (1000 * 60);

      if (diffMinutes <= 5) {
        throw new ForbiddenException("시작 시간은 현재로부터 5분 이후여야 합니다");
      }

      room.scheduledAt = newScheduledAt;
    }

    // 회의 주제 업데이트
    if (data.roomTopic) {
      room.roomTopic = data.roomTopic;
    }

    // 소요 시간 업데이트
    if (data.duration !== undefined) {
      room.duration = data.duration;
    }

    return this.roomRepository.save(room);
  }

  /**
   * 예약된 회의 조기 입장 처리
   * - 5분 전부터 입장 가능
   * - 입장 시 상태를 ACTIVE로 변경하고 스케줄러 Job 취소
   */
  async handleEarlyEntry(roomId: string, userId: string): Promise<{
    canEnter: boolean;
    room: Room;
    minutesUntilStart?: number;
    message: string;
  }> {
    const room = await this.getRoomById(roomId);

    // 접근 권한 확인
    const hasAccess = await this.checkRoomAccess(roomId, userId);
    if (!hasAccess) {
      return {
        canEnter: false,
        room,
        message: "이 회의에 접근할 권한이 없습니다",
      };
    }

    // 이미 활성화된 회의인 경우
    if (room.status === "ACTIVE") {
      return {
        canEnter: true,
        room,
        message: "회의가 이미 진행 중입니다",
      };
    }

    // 종료되거나 취소된 회의인 경우
    if (room.status === "ENDED" || room.status === "CANCELLED") {
      return {
        canEnter: false,
        room,
        message: room.status === "ENDED"
          ? "이미 종료된 회의입니다"
          : "취소된 회의입니다",
      };
    }

    // SCHEDULED 상태인 경우 시간 확인
    if (room.status === "SCHEDULED" && room.scheduledAt) {
      const now = new Date();
      const scheduledAt = new Date(room.scheduledAt);
      const diffMinutes = (scheduledAt.getTime() - now.getTime()) / (1000 * 60);

      // 5분 전부터 입장 가능
      if (diffMinutes <= 5) {
        // 상태를 ACTIVE로 변경
        room.status = "ACTIVE";
        await this.roomRepository.save(room);

        this.logger.log(`[조기 입장] 회의 활성화: ${roomId}, 남은 시간: ${Math.round(diffMinutes)}분`);

        return {
          canEnter: true,
          room,
          minutesUntilStart: Math.max(0, Math.round(diffMinutes)),
          message: diffMinutes > 0
            ? `회의 시작 ${Math.round(diffMinutes)}분 전입니다. 입장이 허용됩니다.`
            : "회의가 시작되었습니다",
        };
      }

      // 아직 입장 불가
      return {
        canEnter: false,
        room,
        minutesUntilStart: Math.round(diffMinutes),
        message: `아직 회의 시간이 아닙니다. ${Math.round(diffMinutes)}분 후에 시작됩니다.`,
      };
    }

    // 기타 상태 (예약되지 않은 즉시 생성 회의)
    return {
      canEnter: true,
      room,
      message: "회의에 입장할 수 있습니다",
    };
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

    // 1. 기본 권한 체크: 방 생성자인지 확인
    const isMaster = room.masterId === userId;

    // 2. 방 생성자가 아니면 채널 관리자/오너 권한 확인
    if (!isMaster) {
      const channelMember = await this.channelMemberRepository.findOne({
        where: { userId, channelId: room.channelId },
        select: { role: true },
      });

      // 채널 멤버가 아니거나 ADMIN/OWNER가 아니면 권한 없음
      if (!channelMember || (channelMember.role !== "ADMIN" && channelMember.role !== "OWNER")) {
        throw new ForbiddenException("Only the master or channel admin/owner can delete this room");
      }

      this.logger.log(`[Admin Override] User ${userId} (role: ${channelMember.role}) deleting room ${roomId}`);
    }

    // Room 삭제 전에 attendees 동기화 + endedAt 설정
    const report = await this.roomReportRepository.findOne({
      where: { reportId: roomId },
    });

    if (report) {
      // Room의 attendees를 RoomReport에 병합 (중복 제거) + 회의 종료 시간 설정
      const mergedAttendees = room.attendees && room.attendees.length > 0
        ? [...new Set([...report.attendees, ...room.attendees])]
        : report.attendees;

      await this.roomReportRepository.update(
        { reportId: roomId },
        {
          attendees: mergedAttendees,
          endedAt: new Date()  // 회의 종료 시간 설정
        }
      );
      console.log(`[Room 삭제] RoomReport 업데이트: attendees=${mergedAttendees.join(', ')}, endedAt=${new Date().toISOString()}`);
    }

    // Room 삭제 (RoomReport는 FK 없이 독립적으로 유지됨, 파일 정보는 createReport에서 이미 저장됨)
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
   * 사용자가 접근 가능한 방 목록 조회 (페이지네이션 지원)
   * - participantUserIds가 빈 배열이면 전체 공개 (채널 멤버면 접근 가능)
   * - participantUserIds가 있으면 해당 유저만 접근 가능
   */
  async getAccessibleRooms(
    userId: string,
    channelId: string,
    page: number = 1,
    limit: number = 6
  ): Promise<{
    rooms: Room[];
    totalCount: number;
    totalPages: number;
    currentPage: number;
    hasNext: boolean;
    hasPrev: boolean;
  }> {
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

    // 전체 개수 조회
    const totalCount = await queryBuilder.getCount();

    // 페이지네이션 적용
    const skip = (page - 1) * limit;
    const rooms = await queryBuilder
      .orderBy('room.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getMany();

    const totalPages = Math.ceil(totalCount / limit);

    return {
      rooms,
      totalCount,
      totalPages,
      currentPage: page,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
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
        "(room.roomTopic ILIKE :keyword)",
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
    masterNickName: string;
    scheduledAt?: Date;
  }): Promise<{ success: boolean; message: string }> {
    const { channelId, roomId, roomTopic, masterNickName, scheduledAt } = params;

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
