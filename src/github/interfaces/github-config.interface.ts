/**
 * GitHub Issue 생성에 필요한 설정 인터페이스
 *
 * resolveConfig() 메서드의 반환 타입
 *
 * Channel별 독립 GitHub App 지원:
 * - appId + privateKey가 있으면: Channel 자체 App 사용
 * - 없으면: 서버 기본 App 사용 (하위 호환)
 */
export interface GitHubConfig {
  /** GitHub App ID (Channel별 App 사용 시) */
  appId?: string;

  /** 복호화된 Private Key (Channel별 App 사용 시) */
  privateKey?: string;

  /** 복호화된 Installation ID */
  installationId: number;

  /** Repository Owner (Organization 또는 User) */
  owner: string;

  /** Repository 이름 */
  repo: string;

  /** Issue에 붙일 라벨들 */
  labels: string[];
}

/**
 * Issue 생성 결과 인터페이스
 */
export interface GitHubIssueResult {
  /** Issue 번호 */
  issueNumber: number;

  /** Issue URL */
  issueUrl: string;

  /** Repository full name (owner/repo) */
  repository: string;
}

/**
 * 연결 테스트 결과 인터페이스
 */
export interface GitHubConnectionTestResult {
  /** 성공 여부 */
  success: boolean;

  /** 결과 메시지 */
  message: string;

  /** 추가 정보 (성공 시) */
  details?: {
    repositoryName: string;
    repositoryUrl: string;
    permissions: string[];
  };
}
