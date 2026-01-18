import {
  IsArray,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsNotEmpty,
  IsUUID,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

class ReportFileDto {
  @IsString()
  fileId: string;

  @IsString()
  fileName: string;

  @IsString()
  fileUrl: string;

  @IsNumber()
  fileSize: number;

  @IsString()
  fileType: string;

  @IsOptional()
  @IsString()
  key?: string;
}

export class CreateReportDto {
  @IsString()
  @IsNotEmpty({ message: 'Room ID 미입력' })
  roomId: string;

  @IsUUID()
  @IsNotEmpty({ message: '채널 ID 미입력' })
  channelId: string;

  @IsOptional()
  @IsString()
  reportId?: string;

  @IsString()
  @IsNotEmpty({ message: '회의 주제 미입력' })
  topic: string;

  @IsArray()
  @IsString({ each: true })
  attendees: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsISO8601()
  createdAt?: string;

  @IsOptional()
  @IsISO8601()
  startedAt?: string; // 회의 시작 시간

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReportFileDto)
  uploadFileList: ReportFileDto[];
}
