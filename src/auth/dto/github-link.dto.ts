import { IsString, IsNotEmpty, Matches, MaxLength } from 'class-validator';

/**
 * GitHub 계정 연동 요청 DTO
 *
 * GitHub username 규칙:
 * - 영문, 숫자, 하이픈(-) 만 허용
 * - 하이픈으로 시작/끝나지 않음
 * - 최대 39자
 */
export class LinkGitHubDto {
  @IsString()
  @IsNotEmpty({ message: 'GitHub username은 필수입니다.' })
  @MaxLength(39, { message: 'GitHub username은 최대 39자입니다.' })
  @Matches(/^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/, {
    message: 'GitHub username 형식이 올바르지 않습니다.',
  })
  githubUsername: string;
}

/**
 * GitHub 연동 상태 응답 DTO
 */
export class GitHubStatusResponseDto {
  isConnected: boolean;
  githubUsername: string | null;
  linkedAt: Date | null;

  constructor(user: { githubUsername?: string | null; githubLinkedAt?: Date | null }) {
    this.isConnected = !!user.githubUsername;
    this.githubUsername = user.githubUsername || null;
    this.linkedAt = user.githubLinkedAt || null;
  }
}
