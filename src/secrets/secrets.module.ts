import { Global, Module } from '@nestjs/common';
import { SecretsService } from './secrets.service';

/**
 * SecretsModule
 *
 * @Global 데코레이터로 전역 모듈 설정
 * → AppModule에서 한 번 import하면 모든 모듈에서 사용 가능
 */
@Global()
@Module({
  providers: [SecretsService],
  exports: [SecretsService],
})
export class SecretsModule {}
