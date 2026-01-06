import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Room } from "./entities/room.entity";

export interface CreateRoomDto {
  roomId: string;
  topic: string;
  description?: string;
  master: string;
  reportId?: string;
  attendees?: string[];
  maxParticipants?: number;
  token?: string;
  livekitUrl?: string;
  upload_File_list?: any[];
}

@Injectable()
export class RoomService {
  constructor(
    @InjectRepository(Room)
    private roomRepository: Repository<Room>
  ) {}

  async createRoom(data: CreateRoomDto): Promise<Room> {
    const room = this.roomRepository.create({
      roomId: data.roomId,
      topic: data.topic,
      description: data.description,
      master: data.master,
      reportId: data.reportId,
      attendees: data.attendees || [],
      maxParticipants: data.maxParticipants || 20,
      token: data.token,
      livekitUrl: data.livekitUrl,
      upload_File_list: data.upload_File_list || [],
    });
    return this.roomRepository.save(room);
  }

  async getAllRooms(): Promise<Room[]> {
    return this.roomRepository.find({
      order: { createdAt: "DESC" },
      relations: ["masterUser"],
    });
  }

  async getRoomById(roomId: string): Promise<Room> {
    const room = await this.roomRepository.findOne({
      where: { roomId },
      relations: ["masterUser"],
    });

    if (!room) {
      throw new NotFoundException(`Room not found: ${roomId}`);
    }

    // attendees는 이제 nickname으로 저장되므로 변환 불필요
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

  async deleteRoom(roomId: string, userId: string): Promise<void> {
    const room = await this.getRoomById(roomId);

    if (room.master !== userId) {
      throw new ForbiddenException("Only the master can delete this room");
    }

    await this.roomRepository.delete({ roomId });
  }

  async forceDeleteRoom(roomId: string): Promise<void> {
    const room = await this.roomRepository.findOne({ where: { roomId } });
    if (room) {
      await this.roomRepository.delete({ roomId });
      console.log(`[System] Room ${roomId} force deleted.`);
    }
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

    const isMaster = room.master === userId;

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
}
