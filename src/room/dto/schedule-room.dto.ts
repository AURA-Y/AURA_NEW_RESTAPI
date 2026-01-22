import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsUUID,
  IsArray,
  IsDateString,
  IsNumber,
  IsEnum,
  Min,
  Max,
  MaxLength,
  ArrayMaxSize,
  Matches,
} from 'class-validator';

export type RecurrenceRule = 'NONE' | 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';

export class ScheduleRoomDto {
  @IsString()
  @IsNotEmpty({ message: '방 제목을 입력해주세요' })
  @MaxLength(255)
  roomTopic: string;

  @IsDateString()
  @IsNotEmpty({ message: '예약 시간을 입력해주세요' })
  scheduledAt: string;  // ISO 8601 format

  @IsNumber()
  @Min(10, { message: '최소 10분 이상이어야 합니다' })
  @Max(480, { message: '최대 8시간(480분)까지 설정 가능합니다' })
  duration: number;  // minutes

  @IsUUID()
  @IsOptional()  // 컨트롤러에서 req.user.id로 설정
  masterId?: string;

  @IsUUID()
  @IsNotEmpty({ message: '채널 ID 미입력' })
  channelId: string;

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  participantUserIds?: string[];  // 빈 배열 = 전체 공개

  // 예정 참여자 (userId + nickName) - 불참자 확인용, Google Calendar 초대용
  @IsArray()
  @IsOptional()
  expectedAttendees?: Array<{
    userId: string;
    nickName: string;
  }>;

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

  // 반복 예약 필드
  @IsEnum(['NONE', 'DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'], {
    message: '유효하지 않은 반복 규칙입니다',
  })
  @IsOptional()
  recurrenceRule?: RecurrenceRule;

  @IsDateString()
  @IsOptional()
  recurrenceEndDate?: string;  // 반복 종료일 (ISO 8601 format)
}
