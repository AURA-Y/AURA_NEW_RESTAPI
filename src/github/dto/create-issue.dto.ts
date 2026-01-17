import {
  IsString,
  IsArray,
  IsOptional,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * GitHub Issue 생성 요청 DTO
 *
 * POST /restapi/reports/:reportId/github-issue
 */
export class CreateGitHubIssueDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  @IsOptional()
  title?: string; // 없으면 회의 주제 사용

  @IsString()
  @IsOptional()
  body?: string; // 없으면 자동 생성

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  labels?: string[]; // 없으면 Channel/Room 설정 사용
}

/**
 * GitHub Issue 생성 응답 DTO
 */
export class CreateGitHubIssueResponseDto {
  success: boolean;
  issueNumber: number;
  issueUrl: string;
  repository: string;
}
