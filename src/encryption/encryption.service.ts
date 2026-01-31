import { Injectable } from '@nestjs/common';
import { SecretsService } from '../secrets/secrets.service';
import * as crypto from 'crypto';

/**
 * EncryptionService
 *
 * GitHub App Private Key를 안전하게 저장하기 위한 암호화 서비스
 *
 * ============================================================
 * 보안 요구사항 분석
 * ============================================================
 * - 비밀성(Confidentiality): Private Key가 DB에 평문 저장되면 안 됨
 * - 무결성(Integrity): 저장된 암호문이 변조되지 않았음을 검증해야 함
 * - 인증(Authentication): 정당한 키로 암호화된 데이터인지 확인해야 함
 *
 * ============================================================
 * 알고리즘 선택: AES-256-GCM
 * ============================================================
 *
 * 왜 AES-256-GCM인가?
 *
 * 1. Authenticated Encryption (AEAD)
 *    - 암호화 + 무결성 검증을 단일 알고리즘으로 제공
 *    - 별도의 MAC(HMAC 등)을 조합할 필요 없음
 *
 * 2. CBC + HMAC 조합 대비 장점
 *    - Encrypt-then-MAC 순서 실수로 인한 취약점 방지
 *    - Padding Oracle Attack에 안전 (스트림 암호 기반, 패딩 불필요)
 *    - 단일 패스로 암호화와 인증 동시 처리 (성능 우수)
 *
 * 3. GCM 모드 특성
 *    - CTR(Counter) 모드 기반 → 병렬 처리 가능
 *    - Galois 필드 연산으로 인증 태그 생성
 *    - IV 재사용 시 보안 붕괴 → 매 암호화마다 랜덤 IV 생성
 *
 * ============================================================
 * AAD (Additional Authenticated Data)
 * ============================================================
 * - 암호화하지 않지만 인증에는 포함되는 데이터
 * - 용도: 암호문의 컨텍스트(channelId, purpose 등)를 바인딩
 * - 효과: A의 암호문을 B의 데이터로 교체하는 공격 방지
 * - 복호화 시 동일한 AAD를 제공하지 않으면 인증 실패
 *
 * ============================================================
 * 저장 형식
 * ============================================================
 * "iv:authTag:ciphertext"
 * - iv: 초기화 벡터 (12바이트 = 24 hex chars)
 * - authTag: 인증 태그 (16바이트 = 32 hex chars)
 * - ciphertext: 암호화된 데이터 (가변 길이)
 */
@Injectable()
export class EncryptionService {
  // AES-256-GCM 상수
  private readonly ALGORITHM = 'aes-256-gcm';
  private readonly IV_LENGTH = 12; // GCM 권장 IV 길이 (NIST SP 800-38D)
  private readonly AUTH_TAG_LENGTH = 16; // 128비트 인증 태그

  constructor(private readonly secretsService: SecretsService) {}

  /**
   * 암호화 키 로드
   * 환경변수에서 64자리 hex 문자열을 읽어 32바이트 Buffer로 변환
   */
  private loadKey(): Buffer {
    const hexKey = this.secretsService.getEncryptionKey();

    if (hexKey.length !== 64) {
      throw new Error(
        `ENCRYPTION_KEY는 64자리 hex 문자열이어야 합니다 (현재: ${hexKey.length}자)`,
      );
    }

    return Buffer.from(hexKey, 'hex');
  }

  /**
   * 평문 암호화
   *
   * @param plaintext 암호화할 문자열
   * @param aad 컨텍스트 바인딩용 추가 인증 데이터 (선택)
   * @returns "iv:authTag:ciphertext" 형식의 암호문
   */
  encrypt(plaintext: string, aad?: string): string {
    const key = this.loadKey();

    // 1. 랜덤 IV 생성 (매번 새로 생성해야 보안 유지)
    const iv = crypto.randomBytes(this.IV_LENGTH);

    // 2. Cipher 초기화
    const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);

    // 3. AAD 설정 (암호화 전에 반드시 설정)
    if (aad) {
      cipher.setAAD(Buffer.from(aad, 'utf8'));
    }

    // 4. 암호화 수행
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    // 5. 인증 태그 추출
    const authTag = cipher.getAuthTag();

    // 6. 결과 조합: iv:authTag:ciphertext
    return [
      iv.toString('hex'),
      authTag.toString('hex'),
      encrypted.toString('hex'),
    ].join(':');
  }

  /**
   * 암호문 복호화
   *
   * @param ciphertext "iv:authTag:encrypted" 형식의 암호문
   * @param aad 암호화 시 사용한 것과 동일한 AAD (선택)
   * @returns 복호화된 평문
   * @throws 인증 실패 시 예외 발생
   */
  decrypt(ciphertext: string, aad?: string): string {
    const key = this.loadKey();

    // 1. 암호문 파싱
    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
      throw new Error('잘못된 암호문 형식입니다. "iv:authTag:ciphertext" 형식이어야 합니다.');
    }

    const [ivHex, authTagHex, encryptedHex] = parts;

    // 2. hex → Buffer 변환
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');

    // 3. 길이 검증
    if (iv.length !== this.IV_LENGTH) {
      throw new Error(`IV 길이 오류: ${this.IV_LENGTH}바이트여야 합니다.`);
    }
    if (authTag.length !== this.AUTH_TAG_LENGTH) {
      throw new Error(`authTag 길이 오류: ${this.AUTH_TAG_LENGTH}바이트여야 합니다.`);
    }

    // 4. Decipher 초기화
    const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv);

    // 5. AAD 설정 (authTag 설정 전에 반드시 호출)
    if (aad) {
      decipher.setAAD(Buffer.from(aad, 'utf8'));
    }

    // 6. 인증 태그 설정
    decipher.setAuthTag(authTag);

    // 7. 복호화 수행 (인증 실패 시 final()에서 예외 발생)
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }

  /**
   * 암호화된 형식인지 확인
   *
   * @param value 검사할 문자열
   * @returns "iv:authTag:ciphertext" 형식이면 true
   */
  isEncrypted(value: string): boolean {
    if (!value) return false;

    const parts = value.split(':');
    if (parts.length !== 3) return false;

    const [ivHex, authTagHex] = parts;

    // IV: 12바이트 = 24 hex chars
    // authTag: 16바이트 = 32 hex chars
    return ivHex.length === 24 && authTagHex.length === 32;
  }
}
