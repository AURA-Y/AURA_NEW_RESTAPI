import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsUUID,
  IsArray,
  MaxLength,
  ArrayMaxSize,
  Matches,
} from 'class-validator';

export class CreateRoomDto {
  @IsString()
  @IsNotEmpty({ message: '방 ID를 입력해주세요' })
  @MaxLength(255)
  roomId: string;

  @IsString()
  @IsNotEmpty({ message: '방 제목을 입력해주세요' })
  @MaxLength(255)
  roomTopic: string;

  @IsString()
  @IsOptional()
  roomDescription?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  roomPassword?: string;

  @IsUUID()
  @IsNotEmpty({ message: '방장 ID를 입력해주세요' })
  masterId: string;

  @IsUUID()
  @IsNotEmpty({ message: '채널 ID 미입력' })
  channelId: string;

  @IsUUID()
  @IsOptional()
  teamId?: string;

  @IsArray()
  @IsOptional()
  attendees?: string[];

  @IsString()
  @IsOptional()
  token?: string;

  @IsArray()
  @IsOptional()
  @ArrayMaxSize(10, { message: '태그는 최대 10개까지 가능합니다' })
  @IsString({ each: true })
  @MaxLength(20, { each: true, message: '각 태그는 20자 이내여야 합니다' })
  @Matches(/^[a-zA-Z0-9가-힣_-]+$/, { each: true, message: '태그는 특수문자 없이 입력해주세요' })
  tags?: string[];
}