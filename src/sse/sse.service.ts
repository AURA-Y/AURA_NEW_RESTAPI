import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Subject } from 'rxjs';
import { User } from '../auth/entities/user.entity';
import { Room } from '../room/entities/room.entity';
import { RoomReport } from '../room/entities/room-report.entity';
import { File } from '../room/entities/file.entity';
import { ReportsService } from '../reports/reports.service';

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
    @InjectRepository(RoomReport)
    private roomReportRepository: Repository<RoomReport>,
    @InjectRepository(File)
    private fileRepository: Repository<File>,
    private reportsService: ReportsService,
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

  // Room 종료 시 Room, RoomReport, File, S3 삭제
  async cleanupRoom(roomId: string): Promise<{
    roomDeleted: boolean;
    reportDeleted: boolean;
    filesDeleted: number;
    s3Deleted: boolean;
  }> {
    let roomDeleted = false;
    let reportDeleted = false;
    let filesDeleted = 0;
    let s3Deleted = false;

    try {
      // 1. S3 폴더 삭제 (rooms/roomId/ 전체)
      try {
        await this.reportsService.deleteS3Folder(roomId);
        s3Deleted = true;
        console.log(`[Cleanup] S3 folder deleted for room: ${roomId}`);
      } catch (error) {
        console.error(`[Cleanup] S3 deletion failed for room ${roomId}:`, error.message);
      }

      // 2. File 삭제 (DB)
      const fileResult = await this.fileRepository.delete({ roomId });
      filesDeleted = fileResult.affected || 0;
      console.log(`[Cleanup] Files deleted: ${filesDeleted} for room: ${roomId}`);

      // 3. RoomReport 삭제 (DB)
      const reportResult = await this.roomReportRepository.delete({ roomId });
      reportDeleted = (reportResult.affected || 0) > 0;
      console.log(`[Cleanup] Report deleted: ${reportDeleted} for room: ${roomId}`);

      // 4. Room 삭제 (DB)
      const roomResult = await this.roomRepository.delete({ roomId });
      roomDeleted = (roomResult.affected || 0) > 0;
      console.log(`[Cleanup] Room deleted: ${roomDeleted} for room: ${roomId}`);

    } catch (error) {
      console.error(`[Cleanup] Error cleaning up room ${roomId}:`, error.message);
    }

    return { roomDeleted, reportDeleted, filesDeleted, s3Deleted };
  }
}
