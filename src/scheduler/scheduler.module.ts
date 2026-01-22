import { Module, Global } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';

/**
 * 회의 예약 스케줄러 모듈
 *
 * Phase 1: 메모리 기반 setTimeout 스케줄링
 * Phase 2: BullMQ + Redis 기반 분산 스케줄링
 *
 * @Global() - 다른 모듈에서 import 없이 사용 가능
 */
@Global()
@Module({
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
