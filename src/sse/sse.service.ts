import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Subject } from 'rxjs';
import { User } from '../auth/entities/user.entity';
import { Room } from '../room/entities/room.entity';

export interface NotificationEvent {
  type: string;
  data: any;
}

@Injectable()
export class SseService {
  // userId -> Subject 매핑 (SSE 연결 관리)
  private clients: Map<string, Subject<NotificationEvent>> = new Map();

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Room)
    private roomRepository: Repository<Room>,
  ) {}

  // SSE 연결 등록
  addClient(userId: string): Subject<NotificationEvent> {
    // 기존 연결이 있으면 완료 처리
    if (this.clients.has(userId)) {
      this.clients.get(userId)?.complete();
    }

    const subject = new Subject<NotificationEvent>();
    this.clients.set(userId, subject);
    console.log(`[SSE] Client connected: ${userId} (total: ${this.clients.size})`);
    return subject;
  }

  // SSE 연결 해제
  removeClient(userId: string): void {
    const subject = this.clients.get(userId);
    if (subject) {
      subject.complete();
      this.clients.delete(userId);
      console.log(`[SSE] Client disconnected: ${userId} (total: ${this.clients.size})`);
    }
  }

  // 특정 유저에게 알림 전송
  sendToUser(userId: string, event: NotificationEvent): boolean {
    const subject = this.clients.get(userId);
    if (subject) {
      subject.next(event);
      return true;
    }
    return false;
  }

  // 회의록 완료 알림 처리
  async handleReportComplete(payload: {
    roomId: string;
    meetingTitle: string;
    reportUrl: string;
    downloadUrl: string;
    speakers: string[];
    completedAt: string;
  }): Promise<{ notified: string[]; failed: string[] }> {
    const { roomId, speakers } = payload;

    // 1. Room에서 attendees(닉네임 배열) 조회
    const room = await this.roomRepository.findOne({
      where: { roomId: roomId },
      select: ['attendees'],
    });

    if (!room || !room.attendees || room.attendees.length === 0) {
      console.log(`[SSE] No attendees found for room: ${roomId}`);
      // speakers로 fallback
      return this.notifyByNicknames(speakers, payload);
    }

    return this.notifyByNicknames(room.attendees, payload);
  }

  // 닉네임 목록으로 알림 전송
  private async notifyByNicknames(
    nicknames: string[],
    payload: any,
  ): Promise<{ notified: string[]; failed: string[] }> {
    const notified: string[] = [];
    const failed: string[] = [];

    if (!nicknames || nicknames.length === 0) {
      return { notified, failed };
    }

    // 닉네임으로 User 조회
    const users = await this.userRepository.find({
      where: { nickName: In(nicknames) },
      select: ['userId', 'nickName'],
    });

    const event: NotificationEvent = {
      type: 'report_complete',
      data: {
        roomId: payload.roomId,
        meetingTitle: payload.meetingTitle,
        downloadUrl: payload.downloadUrl,
        completedAt: payload.completedAt,
      },
    };

    for (const user of users) {
      const sent = this.sendToUser(user.userId, event);
      if (sent) {
        notified.push(user.nickName);
      } else {
        failed.push(user.nickName);
      }
    }

    console.log(`[SSE] Report complete notification - notified: ${notified.length}, failed: ${failed.length}`);
    return { notified, failed };
  }
}
