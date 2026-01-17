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
 * PUT /restapi/channels/:channelId/github
 */
export class UpdateChannelGitHubSettingsDto {
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
  repoOwner?: string;
  repoName?: string;
  labels?: string[];
  autoCreate?: boolean;
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
