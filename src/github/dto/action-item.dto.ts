import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

/**
 * 액션 아이템 Issue 생성 요청 DTO
 */
export class CreateActionItemIssuesDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludeAssignees?: string[];

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

/**
 * 액션 아이템 Issue 생성 결과
 */
export class ActionItemIssueResultDto {
  assignee: string;
  task: string;
  githubUsername: string | null;
  issueNumber: number | null;
  issueUrl: string | null;
  state: 'CREATED' | 'FAILED' | 'SKIPPED';
  error?: string;
}

/**
 * 액션 아이템 Issue 일괄 생성 응답 DTO
 */
export class CreateActionItemIssuesResponseDto {
  roomId: string;
  reportId: string;
  meetingTitle: string;
  totalItems: number;
  created: number;
  failed: number;
  skipped: number;
  results: ActionItemIssueResultDto[];
}

/**
 * 액션 아이템 미리보기 DTO
 */
export class ActionItemPreviewDto {
  assignee: string;
  task: string;
  dueDate: string | null;
  userId: string | null;
  githubUsername: string | null;
  canCreateIssue: boolean;
}
