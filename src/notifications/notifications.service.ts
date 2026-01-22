import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Push 구독 정보 (API 요청/응답용)
 */
export interface PushSubscriptionInput {
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

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {
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
   * Push 구독 등록 (DB에 저장)
   */
  async savePushSubscription(
    userId: string,
    subscription: PushSubscriptionInput,
  ): Promise<{ success: boolean; message: string }> {
    try {
      await this.prisma.pushSubscription.upsert({
        where: { endpoint: subscription.endpoint },
        create: {
          userId,
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
        },
        update: {
          userId,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
        },
      });

      this.logger.log(`[Push] Saved subscription for user: ${userId}`);
      return { success: true, message: 'Subscription saved' };
    } catch (error) {
      this.logger.error(`[Push] Failed to save subscription: ${error.message}`);
      return { success: false, message: error.message };
    }
  }

  /**
   * Push 구독 삭제 (DB에서 삭제)
   */
  async deletePushSubscription(
    userId: string,
    endpoint: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const deleted = await this.prisma.pushSubscription.deleteMany({
        where: {
          userId,
          endpoint,
        },
      });

      if (deleted.count > 0) {
        this.logger.log(`[Push] Removed subscription for user: ${userId}`);
        return { success: true, message: 'Subscription removed' };
      }

      return { success: false, message: 'Subscription not found' };
    } catch (error) {
      this.logger.error(`[Push] Failed to delete subscription: ${error.message}`);
      return { success: false, message: error.message };
    }
  }

  /**
   * 특정 사용자의 모든 구독 조회
   */
  async getUserSubscriptions(userId: string): Promise<PushSubscriptionInput[]> {
    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId },
    });

    return subscriptions.map((sub) => ({
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.p256dh,
        auth: sub.auth,
      },
    }));
  }

  /**
   * 특정 사용자에게 Push 알림 전송
   */
  async sendPushToUser(userId: string, payload: PushPayload): Promise<{
    sent: number;
    failed: number;
  }> {
    const userSubscriptions = await this.getUserSubscriptions(userId);

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

    // 만료된 구독 DB에서 제거
    if (failedEndpoints.length > 0) {
      await this.prisma.pushSubscription.deleteMany({
        where: {
          userId,
          endpoint: { in: failedEndpoints },
        },
      });
      this.logger.log(`[Push] Removed ${failedEndpoints.length} expired subscriptions from DB`);
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
  async getSubscriptionCount(userId: string): Promise<number> {
    return this.prisma.pushSubscription.count({
      where: { userId },
    });
  }

  /**
   * 전체 통계
   */
  async getStats(): Promise<{ totalUsers: number; totalSubscriptions: number }> {
    const totalSubscriptions = await this.prisma.pushSubscription.count();

    const uniqueUsers = await this.prisma.pushSubscription.groupBy({
      by: ['userId'],
    });

    return {
      totalUsers: uniqueUsers.length,
      totalSubscriptions,
    };
  }
}
