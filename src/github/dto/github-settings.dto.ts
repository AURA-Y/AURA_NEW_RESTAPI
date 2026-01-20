import {
  IsString,
  IsBoolean,
  IsArray,
  IsOptional,
  Matches,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';

/**
 * Channel GitHub 설정 저장 DTO
 *
 * PUT /restapi/github/channels/:channelId
 *
 * Channel별 독립 GitHub App 지원:
 * - appId + privateKey: Channel 자체 GitHub App 사용
 * - appId/privateKey 없으면: 서버 기본 App 사용 (하위 호환)
 */
export class UpdateChannelGitHubSettingsDto {
  @IsString()
  @MaxLength(20)
  @IsOptional()
  appId?: string; // GitHub App ID (Channel별 독립 App 사용 시)

  @IsString()
  @IsOptional()
  privateKey?: string; // GitHub App Private Key (PEM 형식, 암호화하여 저장)

  @IsString()
  @MaxLength(20)
  installationId: string; // 숫자지만 문자열로 받음 (프론트에서 편의)

  @IsString()
  @MaxLength(100)
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'repoOwner must contain only alphanumeric, underscore, or hyphen',
  })
  repoOwner: string;

  @IsString()
  @MaxLength(100)
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message:
      'repoName must contain only alphanumeric, dot, underscore, or hyphen',
  })
  repoName: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  @IsOptional()
  labels?: string[];

  @IsBoolean()
  @IsOptional()
  autoCreate?: boolean;

  @IsString()
  @IsOptional()
  projectId?: string | null; // GitHub Projects v2 node ID (선택)

  @IsBoolean()
  @IsOptional()
  autoAddToProject?: boolean; // Issue 생성 시 자동으로 Project에 추가
}

/**
 * Room GitHub 오버라이드 설정 DTO
 *
 * PUT /restapi/rooms/:roomId/github
 */
export class UpdateRoomGitHubOverrideDto {
  @IsString()
  @IsOptional()
  @MaxLength(201)
  @Matches(/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/, {
    message: 'repoOverride must be in "owner/repo" format',
  })
  repoOverride?: string | null;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  @IsOptional()
  labelsOverride?: string[];
}

/**
 * Channel GitHub 설정 조회 응답 DTO
 */
export class ChannelGitHubSettingsResponseDto {
  isConnected: boolean;
  hasOwnApp?: boolean; // Channel 자체 GitHub App 사용 여부
  appId?: string; // GitHub App ID (보안상 privateKey는 반환하지 않음)
  repoOwner?: string;
  repoName?: string;
  labels?: string[];
  autoCreate?: boolean;
  projectId?: string | null; // GitHub Projects v2 node ID
  projectTitle?: string; // 프로젝트 제목 (조회용)
  projectUrl?: string; // 프로젝트 URL (조회용)
  autoAddToProject?: boolean; // Issue 생성 시 자동으로 Project에 추가
}

/**
 * GitHub Project 정보 DTO
 */
export class GitHubProjectDto {
  id: string; // GraphQL node ID
  number: number;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  public: boolean;
}

/**
 * Project 설정 업데이트 DTO
 */
export class UpdateProjectSettingsDto {
  @IsString()
  @IsOptional()
  projectId?: string; // 선택된 프로젝트 ID (null이면 해제)

  @IsBoolean()
  @IsOptional()
  autoAddToProject?: boolean;
}

/**
 * 새 프로젝트 생성 DTO
 */
export class CreateProjectDto {
  @IsString()
  @MaxLength(100)
  title: string;
}

/**
 * Room GitHub 오버라이드 조회 응답 DTO
 */
export class RoomGitHubOverrideResponseDto {
  hasOverride: boolean;
  repoOverride?: string;
  labelsOverride?: string[];

  // Channel 설정 (참고용)
  channelSettings?: {
    repoOwner: string;
    repoName: string;
    labels: string[];
  };
}
