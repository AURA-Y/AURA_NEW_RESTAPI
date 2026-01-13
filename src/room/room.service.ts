import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Room } from "./entities/room.entity";
import { RoomReport } from "./entities/room-report.entity";
import { File } from "./entities/file.entity";
import { CreateRoomDto } from "./dto/create-room.dto";  // ✅ class import

@Injectable()
export class RoomService {
  constructor(
    @InjectRepository(Room)
    private roomRepository: Repository<Room>,
    @InjectRepository(RoomReport)
    private roomReportRepository: Repository<RoomReport>,
    @InjectRepository(File)
    private fileRepository: Repository<File>,
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
      teamId: data.teamId || null,
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
      relations: ["master", "channel", "team"],
    });
  }

  async getRoomById(roomId: string): Promise<Room> {
    const room = await this.roomRepository.findOne({
      where: { roomId },
      relations: ["master", "channel", "team", "files"],
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
      relations: ["master", "team"],
    });
  }

  /**
   * 팀 ID로 해당 팀의 모든 방 조회
   */
  async getRoomsByTeamId(teamId: string): Promise<Room[]> {
    return this.roomRepository.find({
      where: { teamId },
      order: { createdAt: "DESC" },
      relations: ["master"],
    });
  }
}
