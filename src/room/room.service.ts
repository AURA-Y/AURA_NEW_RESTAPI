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

    // File 삭제
    await this.fileRepository.delete({ roomId });
    // Room 삭제 (RoomReport는 FK 없이 독립적으로 유지됨)
    await this.roomRepository.delete({ roomId });
  }

  async addAttendee(roomId: string, nickname: string): Promise<Room> {
    const room = await this.getRoomById(roomId);

    // nickname으로 저장 (중복 체크)
    if (!room.attendees.includes(nickname)) {
      room.attendees.push(nickname);
      return this.roomRepository.save(room);
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

  async leaveRoom(roomId: string, nickname: string): Promise<void> {
    const room = await this.getRoomById(roomId);

    // nickname 제거
    room.attendees = room.attendees.filter((attendee) => attendee !== nickname);
    await this.roomRepository.save(room);

    // 방에 남은 인원이 없으면 방 삭제
    if (room.attendees.length === 0) {
      await this.fileRepository.delete({ roomId });
      await this.roomRepository.delete({ roomId });
      console.log(`Room ${roomId} deleted because it is empty.`);
    }
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
