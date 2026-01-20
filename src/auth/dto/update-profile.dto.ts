import {
  IsString,
  IsOptional,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString({ message: '닉네임은 문자열이어야 합니다.' })
  @MinLength(2, { message: '닉네임은 최소 2자 이상이어야 합니다.' })
  @MaxLength(50, { message: '닉네임은 최대 50자 이하여야 합니다.' })
  nickName?: string;

  @IsOptional()
  @IsString({ message: '현재 비밀번호는 문자열이어야 합니다.' })
  currentPassword?: string;

  @IsOptional()
  @IsString({ message: '새 비밀번호는 문자열이어야 합니다.' })
  @MinLength(6, { message: '새 비밀번호는 최소 6자 이상이어야 합니다.' })
  @MaxLength(100, { message: '새 비밀번호는 최대 100자 이하여야 합니다.' })
  newPassword?: string;

  @IsOptional()
  @IsString({ message: '프로필 이미지 URL은 문자열이어야 합니다.' })
  profileImage?: string;

  @IsOptional()
  @IsString({ message: 'GitHub username은 문자열이어야 합니다.' })
  @MaxLength(39, { message: 'GitHub username은 최대 39자 이하여야 합니다.' })
  @Matches(/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/, {
    message:
      'GitHub username은 영문, 숫자, 하이픈만 사용 가능하며 하이픈으로 시작하거나 끝날 수 없습니다.',
  })
  githubUsername?: string;
}
