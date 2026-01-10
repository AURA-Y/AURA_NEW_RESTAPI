import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Room } from "./entities/room.entity";

export interface CreateRoomDto {
  roomId: string;          // livekit-backend에서 생성된 roomId (room-timestamp-random)
  topic: string;           // 방 제목
  description?: string;
  masterId: string;        // 방장 userId
  channelId?: string;      // 채널 ID (선택 - 자동 생성 시 null 가능)
  teamId?: string;         // 팀 ID (선택)
  roomPassword?: string;
  attendees?: string[];
  token?: string;
}

@Injectable()
export class RoomService {
  constructor(
    @InjectRepository(Room)
    private roomRepository: Repository<Room>
  ) {}

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
      topic: data.topic,
      description: data.description || null,
      masterId: data.masterId,
      channelId: data.channelId || null,
      teamId: data.teamId || null,
      roomPassword: data.roomPassword || null,
      shareLink: this.generateShareLink(data.roomId),
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

  async getRoomByTopic(topic: string): Promise<{ roomId: string }> {
    const room = await this.roomRepository.findOne({
      where: { topic },
      select: ["roomId"],
    });

    if (!room) {
      throw new NotFoundException(`Room with topic "${topic}" not found`);
    }

    return { roomId: room.roomId };
  }

  async getRoomByShareLink(shareLink: string): Promise<Room> {
    const room = await this.roomRepository.findOne({
      where: { shareLink },
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
