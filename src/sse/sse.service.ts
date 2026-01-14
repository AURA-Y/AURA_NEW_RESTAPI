import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Subject } from 'rxjs';
import { User } from '../auth/entities/user.entity';
import { Room } from '../room/entities/room.entity';
import { RoomReport } from '../room/entities/room-report.entity';
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

  // 회의 생성 알림 처리 (participantUserIds에 포함된 유저들에게 알림)
  async handleMeetingCreated(payload: {
    roomId: string;
    roomTopic: string;
    channelId: string;
    channelName?: string;
    masterId: string;
    masterNickName?: string;
    participantUserIds: string[];
  }): Promise<{ notified: string[]; failed: string[] }> {
    const { roomId, roomTopic, channelId, channelName, masterId, masterNickName, participantUserIds } = payload;

    console.log(`[SSE] ========== handleMeetingCreated 시작 ==========`);
    console.log(`[SSE] roomId: ${roomId}`);
    console.log(`[SSE] roomTopic: ${roomTopic}`);
    console.log(`[SSE] masterId: ${masterId}`);
    console.log(`[SSE] participantUserIds: ${participantUserIds?.length || 0}명`);

    const notified: string[] = [];
    const failed: string[] = [];

    // participantUserIds가 비어있으면 (전체 공개) 알림 스킵
    if (!participantUserIds || participantUserIds.length === 0) {
      console.log(`[SSE] 전체 공개 회의 - 개별 알림 스킵`);
      return { notified, failed };
    }

    const event: NotificationEvent = {
      type: 'meeting_created',
      data: {
        roomId,
        meetingTopic: roomTopic,  // 프론트엔드 필드명에 맞춤
        channelId,
        channelName,
        createdBy: masterNickName,  // 프론트엔드 필드명에 맞춤
        createdAt: new Date().toISOString(),
      },
    };

    // participantUserIds에 포함된 유저들에게 알림 (생성자 제외)
    for (const userId of participantUserIds) {
      // 생성자 본인은 제외
      if (userId === masterId) {
        continue;
      }

      const sent = this.sendToUser(userId, event);
      if (sent) {
        notified.push(userId);
      } else {
        failed.push(userId);
      }
    }

    console.log(`[SSE] Meeting created notification - notified: ${notified.length}, failed: ${failed.length}`);
    console.log(`[SSE] ========== handleMeetingCreated 종료 ==========`);

    return { notified, failed };
  }

  // 회의록 생성 알림 처리 (participantUserIds에 포함된 유저들에게 알림)
  async handleReportCreated(payload: {
    roomId: string;
    reportId: string;
    topic: string;
    channelId: string;
    creatorId: string;
    creatorNickName?: string;
  }): Promise<{ notified: string[]; failed: string[] }> {
    const { roomId, reportId, topic, channelId, creatorId, creatorNickName } = payload;

    console.log(`[SSE] ========== handleReportCreated 시작 ==========`);
    console.log(`[SSE] roomId: ${roomId}, reportId: ${reportId}`);
    console.log(`[SSE] topic: ${topic}`);
    console.log(`[SSE] creatorId: ${creatorId}`);

    const notified: string[] = [];
    const failed: string[] = [];

    // Room에서 participantUserIds 가져오기
    const room = await this.roomRepository.findOne({
      where: { roomId },
      select: ['participantUserIds'],
    });

    const participantUserIds = room?.participantUserIds || [];

    // participantUserIds가 비어있으면 (전체 공개) 알림 스킵
    if (!participantUserIds || participantUserIds.length === 0) {
      console.log(`[SSE] 전체 공개 회의록 - 개별 알림 스킵`);
      return { notified, failed };
    }

    const event: NotificationEvent = {
      type: 'report_complete',  // 기존 프론트엔드 타입 재사용
      data: {
        roomId,
        reportId,
        meetingTitle: topic,
        completedAt: new Date().toISOString(),
      },
    };

    // participantUserIds에 포함된 유저들에게 알림 (생성자 제외)
    for (const userId of participantUserIds) {
      // 생성자 본인은 제외
      if (userId === creatorId) {
        continue;
      }

      const sent = this.sendToUser(userId, event);
      if (sent) {
        notified.push(userId);
      } else {
        failed.push(userId);
      }
    }

    console.log(`[SSE] Report created notification - notified: ${notified.length}, failed: ${failed.length}`);
    console.log(`[SSE] ========== handleReportCreated 종료 ==========`);

    return { notified, failed };
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

    // 1. attendees, participantUserIds, masterId 조회
    let attendees: string[] = [];
    let participantUserIds: string[] = [];
    let masterId: string | null = null;

    // Room 테이블에서 조회 (삭제되지 않은 경우)
    const room = await this.roomRepository.findOne({
      where: { roomId: roomId },
      select: ['attendees', 'participantUserIds', 'masterId'],
    });

    if (room?.attendees?.length > 0) {
      attendees = room.attendees;
    }
    if (room?.participantUserIds?.length > 0) {
      participantUserIds = room.participantUserIds;
    }
    if (room?.masterId) {
      masterId = room.masterId;
    }

    // Room이 없거나 데이터가 비어있으면 RoomReport에서 조회
    if (attendees.length === 0 || participantUserIds.length === 0) {
      const report = await this.roomReportRepository.findOne({
        where: { reportId: roomId },
        select: ['attendees', 'participantUserIds'],
      });

      if (attendees.length === 0 && report?.attendees?.length > 0) {
        attendees = report.attendees;
      }
      if (participantUserIds.length === 0 && report?.participantUserIds?.length > 0) {
        participantUserIds = report.participantUserIds;
      }
    }

    // attendees가 없으면 speakers로 fallback
    if (attendees.length === 0 && speakers?.length > 0) {
      attendees = speakers;
    }

    // masterId가 participantUserIds에 없으면 추가 (생성자도 알림 받도록)
    if (masterId && !participantUserIds.includes(masterId)) {
      participantUserIds = [masterId, ...participantUserIds];
    }

    console.log(`[SSE] ========== handleReportComplete 시작 ==========`);
    console.log(`[SSE] roomId: ${roomId}`);
    console.log(`[SSE] masterId: ${masterId}`);
    console.log(`[SSE] Room 조회 결과 - attendees:`, room?.attendees || 'Room 없음');
    console.log(`[SSE] Room 조회 결과 - participantUserIds:`, room?.participantUserIds || 'Room 없음');
    console.log(`[SSE] 최종 attendees:`, attendees);
    console.log(`[SSE] 최종 participantUserIds (masterId 포함):`, participantUserIds);
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

    // 3. SSE 알림 전송 - attendees(닉네임) + participantUserIds(유저ID) 모두에게
    return this.notifyReportComplete(attendees, participantUserIds, payload);
  }

  // 회의록 완료 알림 전송 (attendees 닉네임 + participantUserIds 모두에게)
  private async notifyReportComplete(
    nicknames: string[],
    userIds: string[],
    payload: any,
  ): Promise<{ notified: string[]; failed: string[] }> {
    const notified: string[] = [];
    const failed: string[] = [];
    const notifiedUserIds = new Set<string>(); // 중복 방지

    const event: NotificationEvent = {
      type: 'report_complete',
      data: {
        roomId: payload.roomId,
        meetingTitle: payload.meetingTitle,
        downloadUrl: payload.downloadUrl,
        completedAt: payload.completedAt,
      },
    };

    // 1. participantUserIds로 직접 알림 (권한 있는 유저들)
    if (userIds && userIds.length > 0) {
      for (const userId of userIds) {
        const sent = this.sendToUser(userId, event);
        if (sent) {
          notifiedUserIds.add(userId);
          notified.push(userId);
        }
      }
      console.log(`[SSE] participantUserIds 알림 전송: ${notifiedUserIds.size}명`);
    }

    // 2. nicknames로 User 조회 후 알림 (실제 참석자들)
    if (nicknames && nicknames.length > 0) {
      const users = await this.userRepository.find({
        where: { nickName: In(nicknames) },
        select: ['userId', 'nickName'],
      });

      for (const user of users) {
        // 이미 알림 보낸 유저는 스킵
        if (notifiedUserIds.has(user.userId)) {
          continue;
        }

        const sent = this.sendToUser(user.userId, event);
        if (sent) {
          notifiedUserIds.add(user.userId);
          notified.push(user.nickName);
        } else {
          failed.push(user.nickName);
        }
      }
      console.log(`[SSE] attendees(닉네임) 알림 전송 추가: ${users.length}명 조회, 중복 제외 후 전송`);
    }

    console.log(`[SSE] Report complete notification - 총 notified: ${notifiedUserIds.size}, failed: ${failed.length}`);
    return { notified, failed };
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

  // Room 종료 시 Room, RoomReport, S3 삭제
  async cleanupRoom(roomId: string): Promise<{
    roomDeleted: boolean;
    reportDeleted: boolean;
    s3Deleted: boolean;
  }> {
    let roomDeleted = false;
    let reportDeleted = false;
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

      // 2. RoomReport 삭제 (DB)
      const reportResult = await this.roomReportRepository.delete({ roomId });
      reportDeleted = (reportResult.affected || 0) > 0;
      console.log(`[Cleanup] Report deleted: ${reportDeleted} for room: ${roomId}`);

      // 3. Room 삭제 (DB)
      const roomResult = await this.roomRepository.delete({ roomId });
      roomDeleted = (roomResult.affected || 0) > 0;
      console.log(`[Cleanup] Room deleted: ${roomDeleted} for room: ${roomId}`);

    } catch (error) {
      console.error(`[Cleanup] Error cleaning up room ${roomId}:`, error.message);
    }

    return { roomDeleted, reportDeleted, s3Deleted };
  }
}
