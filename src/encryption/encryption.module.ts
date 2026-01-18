import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service';

/**
 * EncryptionModule
 *
 * @Global 데코레이터로 전역 모듈 설정
 * → SecretsModule을 import하지 않아도 됨 (SecretsModule이 이미 Global)
 */
@Global()
@Module({
  providers: [EncryptionService],
  exports: [EncryptionService],
})
export class EncryptionModule {}
