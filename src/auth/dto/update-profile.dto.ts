import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';

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
}
