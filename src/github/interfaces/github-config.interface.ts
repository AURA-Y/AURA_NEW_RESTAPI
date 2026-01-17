/**
 * GitHub Issue 생성에 필요한 설정 인터페이스
 *
 * resolveConfig() 메서드의 반환 타입
 */
export interface GitHubConfig {
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
