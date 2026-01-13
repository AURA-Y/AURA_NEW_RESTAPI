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
  @IsOptional()  // 컨트롤러에서 req.user.id로 설정
  masterId?: string;

  @IsUUID()
  @IsNotEmpty({ message: '채널 ID 미입력' })
  channelId: string;

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  participantUserIds?: string[];  // 빈 배열 = 전체 공개, 값이 있으면 해당 유저만 접근 가능

  @IsArray()
  @IsOptional()
  attendees?: string[];

  @IsString()
  @IsOptional()
  token?: string;
}