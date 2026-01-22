import {
  Controller,
  Post,
  Delete,
  Get,
  Body,
  UseGuards,
  Request,
  Logger,
} from '@nestjs/common';
import { IsString, IsNotEmpty, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { NotificationsService, PushSubscription } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

class PushSubscriptionKeysDto {
  @IsString()
  @IsNotEmpty()
  p256dh: string;

  @IsString()
  @IsNotEmpty()
  auth: string;
}

class PushSubscriptionDto {
  @IsString()
  @IsNotEmpty()
  endpoint: string;

  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys: PushSubscriptionKeysDto;
}

class UnsubscribeDto {
  @IsString()
  @IsNotEmpty()
  endpoint: string;
}

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * Push 알림 구독 등록
   */
  @Post('push/subscribe')
  async subscribeToPush(
    @Body() subscriptionDto: PushSubscriptionDto,
    @Request() req,
  ) {
    const userId = req.user.id;
    this.logger.log(`[Push Subscribe] User: ${userId}`);

    const result = await this.notificationsService.savePushSubscription(
      userId,
      subscriptionDto as PushSubscription,
    );

    return result;
  }

  /**
   * Push 알림 구독 취소
   */
  @Delete('push/unsubscribe')
  async unsubscribeFromPush(
    @Body() unsubscribeDto: UnsubscribeDto,
    @Request() req,
  ) {
    const userId = req.user.id;
    this.logger.log(`[Push Unsubscribe] User: ${userId}`);

    const result = await this.notificationsService.deletePushSubscription(
      userId,
      unsubscribeDto.endpoint,
    );

    return result;
  }

  /**
   * 현재 사용자의 구독 상태 확인
   */
  @Get('push/status')
  async getPushStatus(@Request() req) {
    const userId = req.user.id;
    const subscriptionCount = this.notificationsService.getSubscriptionCount(userId);

    return {
      userId,
      subscriptionCount,
      isSubscribed: subscriptionCount > 0,
    };
  }

  /**
   * Push 알림 테스트 (개발용)
   */
  @Post('push/test')
  async testPush(@Request() req) {
    const userId = req.user.id;
    this.logger.log(`[Push Test] User: ${userId}`);

    const result = await this.notificationsService.sendPushToUser(userId, {
      title: 'AURA 테스트 알림',
      body: '🎉 Push 알림이 정상적으로 작동합니다!',
      icon: '/icons/icon-192x192.png',
      url: '/',
      type: 'test',
      tag: 'test-notification',
    });

    return {
      message: 'Test notification sent',
      ...result,
    };
  }

  /**
   * 관리자용: 전체 통계
   */
  @Get('push/stats')
  async getPushStats() {
    return this.notificationsService.getStats();
  }
}
