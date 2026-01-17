import { Injectable } from '@nestjs/common';
import { SecretsService } from '../secrets/secrets.service';
import * as crypto from 'crypto';

/**
 * EncryptionService
 *
 * 역할: Installation ID를 AES-256-GCM으로 암호화/복호화
 *
 * 암호화 알고리즘: AES-256-GCM
 * - AES: 대칭키 암호화 (같은 키로 암호화/복호화)
 * - 256: 256비트 키 사용 (32바이트)
 * - GCM: Galois/Counter Mode (인증된 암호화, 무결성 검증 포함)
 *
 * 저장 형식: "iv:authTag:encryptedData"
 * - iv: 초기화 벡터 (12바이트, hex 24자)
 * - authTag: 인증 태그 (16바이트, hex 32자)
 * - encryptedData: 암호화된 데이터 (가변 길이)
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
   * @returns 암호화된 문자열 (형식: "iv:authTag:encryptedData")
   *
   * Flow:
   * 1. 랜덤 IV 생성 (12바이트)
   * 2. AES-256-GCM Cipher 생성
   * 3. 평문 암호화
   * 4. 인증 태그 추출
   * 5. "iv:authTag:encryptedData" 형식으로 조합
   *
   * 예시:
   * encrypt("12345678")
   * → "a1b2c3d4e5f6a1b2c3d4e5f6:1234567890abcdef1234567890abcdef:9f8e7d6c"
   */
  encrypt(plaintext: string): string {
    const key = this.getKey();

    // 1. 랜덤 IV 생성 (매 암호화마다 새로 생성 → 같은 평문도 다른 암호문)
    const iv = crypto.randomBytes(this.ivLength);

    // 2. Cipher 생성
    const cipher = crypto.createCipheriv(this.algorithm, key, iv);

    // 3. 암호화
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // 4. 인증 태그 추출 (무결성 검증용)
    const authTag = cipher.getAuthTag();

    // 5. 조합하여 반환
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * 암호문을 복호화
   *
   * @param encrypted - 암호화된 문자열 (형식: "iv:authTag:encryptedData")
   * @returns 복호화된 평문
   *
   * Flow:
   * 1. ":" 기준으로 분리 → iv, authTag, encryptedData
   * 2. hex → Buffer 변환
   * 3. AES-256-GCM Decipher 생성
   * 4. 인증 태그 설정 (무결성 검증)
   * 5. 복호화
   *
   * 예시:
   * decrypt("a1b2c3d4e5f6a1b2c3d4e5f6:1234...:9f8e7d6c")
   * → "12345678"
   */
  decrypt(encrypted: string): string {
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

    // 길이 검증
    if (iv.length !== this.ivLength) {
      throw new Error(`Invalid IV length: expected ${this.ivLength}, got ${iv.length}`);
    }
    if (authTag.length !== this.authTagLength) {
      throw new Error(`Invalid authTag length: expected ${this.authTagLength}, got ${authTag.length}`);
    }

    // 3. Decipher 생성
    const decipher = crypto.createDecipheriv(this.algorithm, key, iv);

    // 4. 인증 태그 설정 (무결성 검증)
    decipher.setAuthTag(authTag);

    // 5. 복호화
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

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
