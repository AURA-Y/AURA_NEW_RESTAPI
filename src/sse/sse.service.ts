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

    // 1. attendees 조회 (Room → RoomReport → speakers 순으로 fallback)
    let attendees: string[] = [];

    // Room 테이블에서 조회 (삭제되지 않은 경우)
    const room = await this.roomRepository.findOne({
      where: { roomId: roomId },
      select: ['attendees'],
    });

    if (room?.attendees?.length > 0) {
      attendees = room.attendees;
    } else {
      // Room이 없거나 attendees가 비어있으면 RoomReport에서 조회
      const report = await this.roomReportRepository.findOne({
        where: { reportId: roomId },
        select: ['attendees'],
      });

      if (report?.attendees?.length > 0) {
        attendees = report.attendees;
      } else if (speakers?.length > 0) {
        // 둘 다 없으면 speakers로 fallback
        attendees = speakers;
      }
    }

    console.log(`[SSE] ========== handleReportComplete 시작 ==========`);
    console.log(`[SSE] roomId: ${roomId}`);
    console.log(`[SSE] Room 조회 결과:`, room?.attendees || 'Room 없음');
    console.log(`[SSE] 최종 attendees:`, attendees);
    console.log(`[SSE] speakers from payload:`, speakers);

    // 2. DB에 attendees 업데이트 (attendees가 있을 때만)
    if (attendees.length > 0) {
      try {
        // Report 테이블에서 현재 값 조회
        const reportBefore = await this.roomReportRepository.findOne({
          where: { reportId: roomId },
          select: ['attendees'],
        });
        console.log(`[SSE] DB 업데이트 전 RoomReport.attendees:`, reportBefore?.attendees);

        // Report 테이블 업데이트
        await this.roomReportRepository.update(
          { reportId: roomId },
          { attendees }
        );
        console.log(`[SSE] DB 업데이트 완료 - attendees:`, attendees);

        // 업데이트 후 확인
        const reportAfter = await this.roomReportRepository.findOne({
          where: { reportId: roomId },
          select: ['attendees'],
        });
        console.log(`[SSE] DB 업데이트 후 RoomReport.attendees:`, reportAfter?.attendees);

        // S3 report.json 업데이트 (기존 데이터 유지하면서 attendees만 업데이트)
        try {
          const existingReport = await this.reportsService.getReportDetailsFromS3(roomId);
          console.log(`[SSE] S3 기존 attendees:`, existingReport?.attendees);

          await this.reportsService.saveReportDetailsToS3({
            ...existingReport,
            attendees: attendees,
          });
          console.log(`[SSE] S3 JSON 업데이트 완료 - attendees:`, attendees);
        } catch (s3Error) {
          console.warn(`[SSE] S3 report.json not found, skipping S3 update: ${roomId}`);
        }
      } catch (error) {
        console.error(`[SSE] Failed to update attendees for room ${roomId}:`, error.message);
      }
    } else {
      console.warn(`[SSE] No attendees found, skipping update for room: ${roomId}`);
    }
    console.log(`[SSE] ========== handleReportComplete 종료 ==========`);

    // 3. SSE 알림 전송
    if (!attendees || attendees.length === 0) {
      console.log(`[SSE] No attendees found for room: ${roomId}`);
      return { notified: [], failed: [] };
    }

    return this.notifyByNicknames(attendees, payload);
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
