import {
  IsString,
  IsArray,
  IsOptional,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';

/**
 * GitHub Issue 생성 요청 DTO
 *
 * POST /restapi/github/rooms/:roomId/issues
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

  @IsString()
  @IsOptional()
  @Matches(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/, {
    message: 'repoOverride must be in "owner/repo" format',
  })
  repoOverride?: string; // "owner/repo" 형식으로 다른 Repository에 Issue 생성
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
