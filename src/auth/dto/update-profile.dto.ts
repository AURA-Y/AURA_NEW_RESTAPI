import { IsString, MinLength, MaxLength, IsNotEmpty, IsOptional, ValidateIf } from 'class-validator';

export class UpdateProfileDto {
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(50)
  nickName?: string;

  @IsString()
  @IsOptional()
  currentPassword?: string;

  @IsString()
  @IsOptional()
  @MinLength(6)
  @MaxLength(100)
  newPassword?: string;
}
