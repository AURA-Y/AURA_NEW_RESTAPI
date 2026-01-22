import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';

/**
 * Push 구독 정보
 */
export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/**
 * Push 알림 페이로드
 */
export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
  roomId?: string;
  type?: string;
  tag?: string;
  requireInteraction?: boolean;
  actions?: Array<{
    action: string;
    title: string;
    icon?: string;
  }>;
}

/**
 * 사용자별 Push 구독 저장소 (메모리 기반)
 * 실제 운영에서는 Redis 또는 DB에 저장해야 함
 */
interface UserPushSubscriptions {
  [userId: string]: PushSubscription[];
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  // 메모리 기반 구독 저장소 (서버 재시작 시 손실됨)
  // TODO: Redis 또는 PostgreSQL로 마이그레이션
  private subscriptions: UserPushSubscriptions = {};

  constructor() {
    // VAPID 키 설정
    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
    const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@aura.ai.kr';

    if (vapidPublicKey && vapidPrivateKey) {
      webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
      this.logger.log('[Push] VAPID configured successfully');
    } else {
      this.logger.warn('[Push] VAPID keys not configured - push notifications disabled');
    }
  }

  /**
   * Push 구독 등록
   */
  async savePushSubscription(
    userId: string,
    subscription: PushSubscription,
  ): Promise<{ success: boolean; message: string }> {
    if (!this.subscriptions[userId]) {
      this.subscriptions[userId] = [];
    }

    // 중복 구독 확인
    const existingIndex = this.subscriptions[userId].findIndex(
      (sub) => sub.endpoint === subscription.endpoint,
    );

    if (existingIndex >= 0) {
      // 기존 구독 업데이트
      this.subscriptions[userId][existingIndex] = subscription;
      this.logger.log(`[Push] Updated subscription for user: ${userId}`);
    } else {
      // 새 구독 추가
      this.subscriptions[userId].push(subscription);
      this.logger.log(`[Push] Added new subscription for user: ${userId}`);
    }

    return { success: true, message: 'Subscription saved' };
  }

  /**
   * Push 구독 삭제
   */
  async deletePushSubscription(
    userId: string,
    endpoint: string,
  ): Promise<{ success: boolean; message: string }> {
    if (!this.subscriptions[userId]) {
      return { success: false, message: 'No subscriptions found' };
    }

    const initialLength = this.subscriptions[userId].length;
    this.subscriptions[userId] = this.subscriptions[userId].filter(
      (sub) => sub.endpoint !== endpoint,
    );

    if (this.subscriptions[userId].length < initialLength) {
      this.logger.log(`[Push] Removed subscription for user: ${userId}`);
      return { success: true, message: 'Subscription removed' };
    }

    return { success: false, message: 'Subscription not found' };
  }

  /**
   * 특정 사용자에게 Push 알림 전송
   */
  async sendPushToUser(userId: string, payload: PushPayload): Promise<{
    sent: number;
    failed: number;
  }> {
    const userSubscriptions = this.subscriptions[userId] || [];

    if (userSubscriptions.length === 0) {
      this.logger.debug(`[Push] No subscriptions for user: ${userId}`);
      return { sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;
    const failedEndpoints: string[] = [];

    for (const subscription of userSubscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: subscription.keys,
          },
          JSON.stringify(payload),
        );
        sent++;
      } catch (error: any) {
        failed++;
        const statusCode = error.statusCode || 'unknown';
        this.logger.error(
          `[Push] Failed to send to ${userId}: ${error.message} (status: ${statusCode})`,
        );

        // 410 Gone, 404 Not Found, 401 Unauthorized면 구독 제거
        if ([410, 404, 401, 403].includes(error.statusCode)) {
          failedEndpoints.push(subscription.endpoint);
          this.logger.warn(`[Push] Removing invalid subscription for ${userId} (status: ${statusCode})`);
        }
      }
    }

    // 만료된 구독 제거
    if (failedEndpoints.length > 0) {
      this.subscriptions[userId] = this.subscriptions[userId].filter(
        (sub) => !failedEndpoints.includes(sub.endpoint),
      );
      this.logger.log(`[Push] Removed ${failedEndpoints.length} expired subscriptions`);
    }

    return { sent, failed };
  }

  /**
   * 여러 사용자에게 Push 알림 전송
   */
  async sendPushToUsers(userIds: string[], payload: PushPayload): Promise<{
    totalSent: number;
    totalFailed: number;
  }> {
    let totalSent = 0;
    let totalFailed = 0;

    for (const userId of userIds) {
      const result = await this.sendPushToUser(userId, payload);
      totalSent += result.sent;
      totalFailed += result.failed;
    }

    this.logger.log(`[Push] Sent to ${userIds.length} users: ${totalSent} sent, ${totalFailed} failed`);
    return { totalSent, totalFailed };
  }

  /**
   * 회의 리마인더 Push 알림
   */
  async sendMeetingReminderPush(params: {
    userIds: string[];
    roomId: string;
    roomTopic: string;
    minutesBefore: number;
    scheduledAt: string;
  }): Promise<{ totalSent: number; totalFailed: number }> {
    const payload: PushPayload = {
      title: `회의 ${params.minutesBefore}분 전`,
      body: `"${params.roomTopic}" 회의가 ${params.minutesBefore}분 후 시작됩니다`,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/badge-72x72.png',
      url: `/room/${params.roomId}`,
      roomId: params.roomId,
      type: 'meeting_reminder',
      tag: `reminder-${params.roomId}`,
      requireInteraction: params.minutesBefore <= 5,
      actions: [
        { action: 'join', title: '입장하기' },
        { action: 'dismiss', title: '닫기' },
      ],
    };

    return this.sendPushToUsers(params.userIds, payload);
  }

  /**
   * 회의 시작 Push 알림
   */
  async sendMeetingStartedPush(params: {
    userIds: string[];
    roomId: string;
    roomTopic: string;
  }): Promise<{ totalSent: number; totalFailed: number }> {
    const payload: PushPayload = {
      title: '회의가 시작되었습니다',
      body: `"${params.roomTopic}" 회의에 참여하세요`,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/badge-72x72.png',
      url: `/room/${params.roomId}`,
      roomId: params.roomId,
      type: 'meeting_started',
      tag: `start-${params.roomId}`,
      requireInteraction: true,
      actions: [
        { action: 'join', title: '지금 입장' },
        { action: 'dismiss', title: '나중에' },
      ],
    };

    return this.sendPushToUsers(params.userIds, payload);
  }

  /**
   * 회의 취소 Push 알림
   */
  async sendMeetingCancelledPush(params: {
    userIds: string[];
    roomId: string;
    roomTopic: string;
    cancelledBy: string;
  }): Promise<{ totalSent: number; totalFailed: number }> {
    const payload: PushPayload = {
      title: '회의가 취소되었습니다',
      body: `"${params.roomTopic}" 회의가 ${params.cancelledBy}님에 의해 취소되었습니다`,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/badge-72x72.png',
      url: '/scheduled',
      roomId: params.roomId,
      type: 'meeting_cancelled',
      tag: `cancelled-${params.roomId}`,
    };

    return this.sendPushToUsers(params.userIds, payload);
  }

  /**
   * 사용자의 구독 개수 확인
   */
  getSubscriptionCount(userId: string): number {
    return (this.subscriptions[userId] || []).length;
  }

  /**
   * 전체 통계
   */
  getStats(): { totalUsers: number; totalSubscriptions: number } {
    const userIds = Object.keys(this.subscriptions);
    const totalSubscriptions = userIds.reduce(
      (sum, userId) => sum + this.subscriptions[userId].length,
      0,
    );

    return {
      totalUsers: userIds.length,
      totalSubscriptions,
    };
  }
}
