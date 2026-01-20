/**
 * 파싱된 액션 아이템
 */
export interface ActionItem {
  /** 담당자 닉네임 */
  assignee: string;

  /** 할 일 내용 */
  task: string;

  /** 마감일 (null = 미정) */
  dueDate: string | null;
}

/**
 * 파싱 결과
 */
export interface ParsedActionItems {
  items: ActionItem[];
  success: boolean;
  rawMarkdown: string;
  error?: string;
}

/**
 * GitHub 매핑 정보가 포함된 액션 아이템
 */
export interface ActionItemWithGitHub extends ActionItem {
  /** 매핑된 User ID */
  userId: string | null;

  /** 매핑된 GitHub username */
  githubUsername: string | null;

  /** Issue 생성 결과 (생성 후) */
  issueUrl?: string;
  issueNumber?: number;
}

/**
 * S3에서 조회한 리포트 데이터
 */
export interface ReportData {
  reportId: string;
  roomId: string;
  channelId: string;
  topic: string;
  summary: string;
  attendees: string[];
  startedAt: string;
  createdAt: string;
}
