import { Injectable, Logger } from '@nestjs/common';

/**
 * 회의 알림 Job 정보
 */
export interface RoomNotificationJobs {
  reminder30minJobId?: string;  // 30분 전 리마인더
  reminder5minJobId?: string;   // 5분 전 리마인더
  startJobId?: string;          // 회의 시작 알림
}

/**
 * 회의 예약 스케줄러 서비스
 *
 * Phase 1: 기본 인터페이스 및 메모리 기반 스케줄링
 * Phase 3: 리마인더 알림 스케줄링 추가 (30분, 5분 전)
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  // Phase 1: 메모리 기반 스케줄링 (서버 재시작 시 손실됨)
  private scheduledJobs: Map<string, NodeJS.Timeout> = new Map();

  // roomId -> 알림 Job ID 매핑 (취소 시 사용)
  private roomNotificationJobs: Map<string, RoomNotificationJobs> = new Map();

  /**
   * 회의 시작 Job 스케줄링
   *
   * @param roomId - 회의 ID
   * @param executeAt - 실행 시간
   * @param callback - 실행할 콜백 함수
   * @returns jobId
   */
  async scheduleRoomStart(
    roomId: string,
    executeAt: Date,
    callback: () => Promise<void>,
  ): Promise<string> {
    const delay = executeAt.getTime() - Date.now();
    const jobId = `start-${roomId}-${Date.now()}`;

    if (delay <= 0) {
      this.logger.warn(`[Scheduler] 이미 지난 시간입니다. 즉시 실행합니다. roomId: ${roomId}`);
      await callback();
      return jobId;
    }

    this.logger.log(`[Scheduler] Job 스케줄링: ${jobId}, delay: ${delay}ms (${Math.round(delay / 60000)}분)`);

    const timeout = setTimeout(async () => {
      this.logger.log(`[Scheduler] Job 실행: ${jobId}`);
      try {
        await callback();
        this.scheduledJobs.delete(jobId);
      } catch (error) {
        this.logger.error(`[Scheduler] Job 실행 실패: ${jobId}`, error);
      }
    }, delay);

    this.scheduledJobs.set(jobId, timeout);
    return jobId;
  }

  /**
   * 회의 알림 스케줄링 (30분 전, 5분 전, 시작 시점)
   *
   * @param roomId - 회의 ID
   * @param scheduledAt - 회의 시작 시간
   * @param callbacks - 각 시점별 콜백 함수
   * @returns 스케줄된 Job ID 목록
   */
  async scheduleRoomNotifications(
    roomId: string,
    scheduledAt: Date,
    callbacks: {
      onReminder30min?: () => Promise<void>;
      onReminder5min?: () => Promise<void>;
      onStart?: () => Promise<void>;
    },
  ): Promise<RoomNotificationJobs> {
    const jobs: RoomNotificationJobs = {};
    const now = Date.now();
    const startTime = scheduledAt.getTime();

    // 30분 전 리마인더
    if (callbacks.onReminder30min) {
      const reminder30minTime = startTime - 30 * 60 * 1000;
      if (reminder30minTime > now) {
        const delay = reminder30minTime - now;
        const jobId = `reminder30-${roomId}-${Date.now()}`;

        const timeout = setTimeout(async () => {
          this.logger.log(`[Scheduler] 30분 전 리마인더 실행: ${roomId}`);
          try {
            await callbacks.onReminder30min!();
            this.scheduledJobs.delete(jobId);
          } catch (error) {
            this.logger.error(`[Scheduler] 30분 전 리마인더 실패: ${roomId}`, error);
          }
        }, delay);

        this.scheduledJobs.set(jobId, timeout);
        jobs.reminder30minJobId = jobId;
        this.logger.log(`[Scheduler] 30분 전 리마인더 예약: ${jobId}, delay: ${Math.round(delay / 60000)}분`);
      } else {
        this.logger.log(`[Scheduler] 30분 전 리마인더 스킵 (이미 지남): ${roomId}`);
      }
    }

    // 5분 전 리마인더
    if (callbacks.onReminder5min) {
      const reminder5minTime = startTime - 5 * 60 * 1000;
      if (reminder5minTime > now) {
        const delay = reminder5minTime - now;
        const jobId = `reminder5-${roomId}-${Date.now()}`;

        const timeout = setTimeout(async () => {
          this.logger.log(`[Scheduler] 5분 전 리마인더 실행: ${roomId}`);
          try {
            await callbacks.onReminder5min!();
            this.scheduledJobs.delete(jobId);
          } catch (error) {
            this.logger.error(`[Scheduler] 5분 전 리마인더 실패: ${roomId}`, error);
          }
        }, delay);

        this.scheduledJobs.set(jobId, timeout);
        jobs.reminder5minJobId = jobId;
        this.logger.log(`[Scheduler] 5분 전 리마인더 예약: ${jobId}, delay: ${Math.round(delay / 60000)}분`);
      } else {
        this.logger.log(`[Scheduler] 5분 전 리마인더 스킵 (이미 지남): ${roomId}`);
      }
    }

    // 회의 시작 알림
    if (callbacks.onStart) {
      if (startTime > now) {
        const delay = startTime - now;
        const jobId = `start-${roomId}-${Date.now()}`;

        const timeout = setTimeout(async () => {
          this.logger.log(`[Scheduler] 회의 시작 알림 실행: ${roomId}`);
          try {
            await callbacks.onStart!();
            this.scheduledJobs.delete(jobId);
          } catch (error) {
            this.logger.error(`[Scheduler] 회의 시작 알림 실패: ${roomId}`, error);
          }
        }, delay);

        this.scheduledJobs.set(jobId, timeout);
        jobs.startJobId = jobId;
        this.logger.log(`[Scheduler] 회의 시작 알림 예약: ${jobId}, delay: ${Math.round(delay / 60000)}분`);
      } else {
        this.logger.log(`[Scheduler] 회의 시작 알림 스킵 (이미 지남): ${roomId}`);
      }
    }

    // roomId별 Job 매핑 저장 (취소용)
    this.roomNotificationJobs.set(roomId, jobs);

    return jobs;
  }

  /**
   * 특정 회의의 모든 알림 Job 취소
   */
  async cancelRoomNotifications(roomId: string): Promise<{
    cancelled: string[];
    notFound: string[];
  }> {
    const cancelled: string[] = [];
    const notFound: string[] = [];

    const jobs = this.roomNotificationJobs.get(roomId);
    if (!jobs) {
      this.logger.warn(`[Scheduler] 회의 알림 Job을 찾을 수 없음: ${roomId}`);
      return { cancelled, notFound };
    }

    const jobIds = [
      jobs.reminder30minJobId,
      jobs.reminder5minJobId,
      jobs.startJobId,
    ].filter(Boolean) as string[];

    for (const jobId of jobIds) {
      const result = await this.cancelJob(jobId);
      if (result) {
        cancelled.push(jobId);
      } else {
        notFound.push(jobId);
      }
    }

    this.roomNotificationJobs.delete(roomId);
    this.logger.log(`[Scheduler] 회의 알림 취소 완료: ${roomId}, cancelled: ${cancelled.length}`);

    return { cancelled, notFound };
  }

  /**
   * 스케줄된 Job 취소
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const timeout = this.scheduledJobs.get(jobId);
    if (timeout) {
      clearTimeout(timeout);
      this.scheduledJobs.delete(jobId);
      this.logger.log(`[Scheduler] Job 취소됨: ${jobId}`);
      return true;
    }
    this.logger.warn(`[Scheduler] Job을 찾을 수 없음: ${jobId}`);
    return false;
  }

  /**
   * 활성 Job 개수 조회
   */
  getActiveJobCount(): number {
    return this.scheduledJobs.size;
  }

  /**
   * 모든 활성 Job ID 목록 조회
   */
  getActiveJobIds(): string[] {
    return Array.from(this.scheduledJobs.keys());
  }

  /**
   * 특정 회의의 알림 Job 정보 조회
   */
  getRoomNotificationJobs(roomId: string): RoomNotificationJobs | undefined {
    return this.roomNotificationJobs.get(roomId);
  }
}
