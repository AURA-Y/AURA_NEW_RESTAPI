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

  // 예정 참여자 (userId + nickName) - 불참자 확인용
  @IsArray()
  @IsOptional()
  expectedAttendees?: Array<{
    userId: string;
    nickName: string;
  }>;

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

  @IsArray()
  @IsOptional()
  uploadFileList?: Array<{
    fileId: string;
    fileName: string;
    fileUrl: string;
    fileSize: number;
    createdAt: string;
  }>;

  @IsArray()
  @IsOptional()
  referencedFiles?: Array<{
    fileId: string;
    fileName: string;
    fileUrl: string;
    fileSize: number;
    createdAt: string;
    sourceRoomId?: string;
  }>;
}