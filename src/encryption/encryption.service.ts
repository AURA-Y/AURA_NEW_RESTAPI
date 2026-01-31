import { Injectable } from '@nestjs/common';
import { SecretsService } from '../secrets/secrets.service';
import * as crypto from 'crypto';

/**
 * EncryptionService
 *
 * 역할: GitHub App Private Key를 AES-256-GCM으로 암호화/복호화
 *
 * ============================================================
 * 알고리즘 선택 이유
 * ============================================================
 *
 * 보안 요구사항:
 * - 비밀성(Confidentiality): Private Key가 DB에 평문 저장되면 안 됨
 * - 무결성(Integrity): 저장된 암호문이 변조되지 않았음을 검증해야 함
 * - 인증(Authentication): 정당한 키로 암호화된 데이터인지 확인해야 함
 *
 * AES-256-GCM 선택 이유:
 * - Authenticated Encryption: 단일 알고리즘으로 비밀성 + 무결성 + 인증 모두 제공
 * - CBC + HMAC 조합 대비 장점:
 *   - 단일 패스로 암호화와 인증을 동시에 처리 (성능 우수)
 *   - Encrypt-then-MAC 순서 오류로 인한 취약점 방지
 *   - Padding Oracle Attack에 안전 (패딩 불필요)
 * - CTR 모드 기반으로 병렬 처리 가능
 * - authTag로 복호화 시 데이터 변조 여부 즉시 검증
 *
 * ============================================================
 * 암호화 알고리즘: AES-256-GCM
 * ============================================================
 * - AES: 대칭키 블록 암호화 (같은 키로 암호화/복호화)
 * - 256: 256비트 키 사용 (32바이트) - 현재 가장 강력한 AES 키 길이
 * - GCM: Galois/Counter Mode (인증된 암호화, 무결성 검증 포함)
 *
 * 저장 형식: "iv:authTag:encryptedData"
 * - iv: 초기화 벡터 (12바이트, hex 24자) - 매 암호화마다 랜덤 생성
 * - authTag: 인증 태그 (16바이트, hex 32자) - 무결성 검증용
 * - encryptedData: 암호화된 데이터 (가변 길이)
 *
 * ============================================================
 * AAD (Additional Authenticated Data) 지원
 * ============================================================
 * - GCM 모드의 핵심 기능: 암호화하지 않지만 인증에는 포함되는 데이터
 * - 용도: 암호문의 컨텍스트(예: channelId, purpose)를 바인딩
 * - 효과: A 사용자의 암호문을 B 사용자 데이터로 교체하는 공격 방지
 * - 복호화 시 동일한 AAD를 제공하지 않으면 인증 실패
 */
@Injectable()
export class EncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly ivLength = 12; // GCM 권장 IV 길이
  private readonly authTagLength = 16; // GCM 인증 태그 길이

  constructor(private secretsService: SecretsService) {}

  /**
   * 암호화 키 가져오기 (32바이트 Buffer)
   *
   * ENCRYPTION_KEY는 64자리 hex 문자열
   * → Buffer.from(hex, 'hex')로 32바이트 Buffer 변환
   */
  private getKey(): Buffer {
    const hexKey = this.secretsService.getEncryptionKey();

    if (hexKey.length !== 64) {
      throw new Error(
        `ENCRYPTION_KEY must be 64 hex characters (32 bytes), got ${hexKey.length}`,
      );
    }

    return Buffer.from(hexKey, 'hex');
  }

  /**
   * 평문을 암호화
   *
   * @param plaintext - 암호화할 문자열 (예: "12345678")
   * @param aad - Additional Authenticated Data (선택적)
   *              암호화하지 않지만 인증에 포함되는 컨텍스트 데이터
   *              예: channelId, purpose 등 → 다른 컨텍스트로 암호문 재사용 방지
   * @returns 암호화된 문자열 (형식: "iv:authTag:encryptedData")
   *
   * Flow:
   * 1. 랜덤 IV 생성 (12바이트)
   * 2. AES-256-GCM Cipher 생성
   * 3. AAD 설정 (있는 경우) - 암호화 전에 반드시 설정해야 함
   * 4. 평문 암호화
   * 5. 인증 태그 추출
   * 6. "iv:authTag:encryptedData" 형식으로 조합
   *
   * 예시:
   * encrypt("12345678", "channel-123")
   * → "a1b2c3d4e5f6a1b2c3d4e5f6:1234567890abcdef1234567890abcdef:9f8e7d6c"
   */
  encrypt(plaintext: string, aad?: string): string {
    const key = this.getKey();

    // 1. 랜덤 IV 생성 (매 암호화마다 새로 생성 → 같은 평문도 다른 암호문)
    const iv = crypto.randomBytes(this.ivLength);

    // 2. Cipher 생성
    const cipher = crypto.createCipheriv(this.algorithm, key, iv);

    // 3. AAD 설정 (GCM의 핵심 기능)
    //    - 암호화되지 않지만 authTag 계산에 포함됨
    //    - 복호화 시 동일한 AAD 필요 → 컨텍스트 바인딩
    if (aad) {
      cipher.setAAD(Buffer.from(aad, 'utf8'));
    }

    // 4. 암호화
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // 5. 인증 태그 추출 (무결성 + AAD 검증용)
    const authTag = cipher.getAuthTag();

    // 6. 조합하여 반환
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * 암호문을 복호화
   *
   * @param encrypted - 암호화된 문자열 (형식: "iv:authTag:encryptedData")
   * @param aad - Additional Authenticated Data (선택적)
   *              암호화 시 사용한 것과 동일한 AAD 필요
   *              불일치 시 인증 실패 → 복호화 거부
   * @returns 복호화된 평문
   *
   * Flow:
   * 1. ":" 기준으로 분리 → iv, authTag, encryptedData
   * 2. hex → Buffer 변환
   * 3. AES-256-GCM Decipher 생성
   * 4. AAD 설정 (있는 경우) - 인증 태그 설정 전에 반드시 설정해야 함
   * 5. 인증 태그 설정 (무결성 검증)
   * 6. 복호화 - authTag 검증 실패 시 예외 발생
   *
   * 예시:
   * decrypt("a1b2c3d4e5f6a1b2c3d4e5f6:1234...:9f8e7d6c", "channel-123")
   * → "12345678"
   *
   * 보안:
   * - AAD 불일치 시: "Unsupported state or unable to authenticate data" 예외
   * - 다른 컨텍스트의 암호문 재사용 시도를 탐지/차단
   */
  decrypt(encrypted: string, aad?: string): string {
    const key = this.getKey();

    // 1. 파싱
    const parts = encrypted.split(':');
    if (parts.length !== 3) {
      throw new Error(
        'Invalid encrypted format. Expected "iv:authTag:encryptedData"',
      );
    }

    const [ivHex, authTagHex, encryptedData] = parts;

    // 2. Buffer 변환
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    // 길이 검증 (타이밍 공격 방지를 위해 상수 시간 비교는 authTag에서 수행)
    if (iv.length !== this.ivLength) {
      throw new Error(`Invalid IV length: expected ${this.ivLength}, got ${iv.length}`);
    }
    if (authTag.length !== this.authTagLength) {
      throw new Error(`Invalid authTag length: expected ${this.authTagLength}, got ${authTag.length}`);
    }

    // 3. Decipher 생성
    const decipher = crypto.createDecipheriv(this.algorithm, key, iv);

    // 4. AAD 설정 (암호화 시 사용한 것과 동일해야 함)
    //    - authTag 설정 전에 반드시 호출해야 함
    //    - 불일치 시 final()에서 인증 실패 예외 발생
    if (aad) {
      decipher.setAAD(Buffer.from(aad, 'utf8'));
    }

    // 5. 인증 태그 설정 (무결성 검증)
    decipher.setAuthTag(authTag);

    // 6. 복호화 (final에서 authTag 검증 수행)
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8'); // 인증 실패 시 여기서 예외 발생

    return decrypted;
  }

  /**
   * 암호화된 값인지 확인
   *
   * @param value - 확인할 문자열
   * @returns 암호화된 형식이면 true
   */
  isEncrypted(value: string): boolean {
    if (!value) return false;

    const parts = value.split(':');
    if (parts.length !== 3) return false;

    const [ivHex, authTagHex] = parts;

    // IV: 24 hex chars (12 bytes)
    // AuthTag: 32 hex chars (16 bytes)
    return ivHex.length === 24 && authTagHex.length === 32;
  }
}
