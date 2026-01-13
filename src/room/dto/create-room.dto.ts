import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsUUID,
  IsArray,
  MaxLength,
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

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  teamIds?: string[];  // 빈 배열 = 전체 공개

  @IsArray()
  @IsOptional()
  attendees?: string[];

  @IsString()
  @IsOptional()
  token?: string;
}