import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Room } from './entities/room.entity';

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
    private roomRepository: Repository<Room>,
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
      order: { createdAt: 'DESC' },
      relations: ['masterUser'],
    });
  }

  async getRoomById(roomId: string): Promise<Room> {
    const room = await this.roomRepository.findOne({
      where: { roomId },
      relations: ['masterUser'],
    });

    if (!room) {
      throw new NotFoundException(`Room not found: ${roomId}`);
    }

    return room;
  }

  async deleteRoom(roomId: string, userId: string): Promise<void> {
    const room = await this.getRoomById(roomId);

    if (room.master !== userId) {
      throw new ForbiddenException(
        'Only the master can delete this room',
      );
    }

    await this.roomRepository.delete({ roomId });
  }

  async addAttendee(roomId: string, userId: string): Promise<Room> {
    const room = await this.getRoomById(roomId);

    if (!room.attendees.includes(userId)) {
      room.attendees.push(userId);
      return this.roomRepository.save(room);
    }

    return room;
  }

  async removeAttendee(roomId: string, userId: string): Promise<Room> {
    const room = await this.getRoomById(roomId);

    room.attendees = room.attendees.filter((id) => id !== userId);
    return this.roomRepository.save(room);
  }

  async checkUserRole(roomId: string, userId: string): Promise<{ isMaster: boolean; role: 'master' | 'attendee' }> {
    const room = await this.getRoomById(roomId);

    const isMaster = room.master === userId;

    return {
      isMaster,
      role: isMaster ? 'master' : 'attendee',
    };
  }
}
