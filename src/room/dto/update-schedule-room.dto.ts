import {
  IsOptional,
  IsString,
  IsDateString,
  IsNumber,
  Min,
  Max,
  MaxLength,
} from 'class-validator';

/**
 * 예약된 회의 수정 DTO
 * - 모든 필드 optional (수정하고자 하는 필드만 전송)
 */
export class UpdateScheduleRoomDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  roomTopic?: string;

  @IsDateString()
  @IsOptional()
  scheduledAt?: string;  // ISO 8601 format

  @IsNumber()
  @IsOptional()
  @Min(10, { message: '최소 10분 이상이어야 합니다' })
  @Max(480, { message: '최대 8시간(480분)까지 설정 가능합니다' })
  duration?: number;  // minutes
}
