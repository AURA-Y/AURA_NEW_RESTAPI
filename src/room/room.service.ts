import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, Brackets } from "typeorm";
import { Room } from "./entities/room.entity";
import { RoomReport } from "./entities/room-report.entity";
import { File } from "./entities/file.entity";
import { ChannelMember } from "../channel/entities/channel-member.entity";
import { CreateRoomDto } from "./dto/create-room.dto";

@Injectable()
export class RoomService {
  constructor(
    @InjectRepository(Room)
    private roomRepository: Repository<Room>,
    @InjectRepository(RoomReport)
    private roomReportRepository: Repository<RoomReport>,
    @InjectRepository(File)
    private fileRepository: Repository<File>,
    @InjectRepository(ChannelMember)
    private channelMemberRepository: Repository<ChannelMember>,
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
      teamIds: data.teamIds || [],  // 빈 배열 = 전체 공개
      roomPassword: data.roomPassword || null,
      roomShareLink: this.generateShareLink(data.roomId),
      attendees: data.attendees || [],
      token: data.token || null,
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
      relations: ["master", "channel", "files"],
    });

    if (!room) {
      throw new NotFoundException(`Room not found: ${roomId}`);
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

    // File 삭제
    await this.fileRepository.delete({ roomId });
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
   * 팀 ID로 해당 팀이 포함된 방 조회 (teamIds 배열에 포함된 경우)
   */
  async getRoomsByTeamId(teamId: string): Promise<Room[]> {
    return this.roomRepository
      .createQueryBuilder('room')
      .leftJoinAndSelect('room.master', 'master')
      .where(':teamId = ANY(room.teamIds)', { teamId })
      .orderBy('room.createdAt', 'DESC')
      .getMany();
  }

  /**
   * 사용자가 접근 가능한 방 목록 조회
   * - teamIds가 빈 배열이면 전체 공개 (채널 멤버면 접근 가능)
   * - teamIds가 있으면 해당 팀 멤버만 접근 가능
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
    const queryBuilder = this.roomRepository
      .createQueryBuilder('room')
      .leftJoinAndSelect('room.master', 'master')
      .leftJoinAndSelect('room.channel', 'channel')
      .where('room.channelId = :channelId', { channelId });

    // teamIds가 빈 배열이거나, 사용자의 팀이 포함된 경우
    if (membership.teamId) {
      queryBuilder.andWhere(
        '(room.teamIds = :emptyArray OR :userTeamId = ANY(room.teamIds))',
        {
          emptyArray: '{}',
          userTeamId: membership.teamId
        }
      );
    } else {
      // 팀에 소속되지 않은 사용자는 전체 공개 방만 접근 가능
      queryBuilder.andWhere('room.teamIds = :emptyArray', { emptyArray: '{}' });
    }

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
      select: ['roomId', 'channelId', 'teamIds']
    });

    if (!room) return false;

    // 채널 멤버십 확인
    const membership = await this.channelMemberRepository.findOne({
      where: { userId, channelId: room.channelId }
    });

    if (!membership) return false;

    // 전체 공개인 경우 (teamIds가 빈 배열)
    if (!room.teamIds || room.teamIds.length === 0) {
      return true;
    }

    // 팀 제한인 경우 - 사용자의 팀이 포함되어 있는지 확인
    if (!membership.teamId) return false;

    return room.teamIds.includes(membership.teamId);
  }
}
