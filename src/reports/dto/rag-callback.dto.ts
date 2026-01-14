import {
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

/**
 * 개인별 회의록 정보
 */
export class PersonalizedReportDto {
  @IsString()
  participantId: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsString()
  url: string;

  @IsString()
  downloadUrl: string;
}

/**
 * RAG 서버에서 보내는 콜백 JSON
 * 회의 종료 후 회의록 생성 완료 시 호출됨
 */
export class RagReportCallbackDto {
  @IsString()
  event: string; // "report_complete"

  @IsString()
  room_id: string;

  @IsOptional()
  @IsString()
  meeting_title?: string;

  @IsOptional()
  @IsString()
  report_url?: string; // s3://...

  @IsOptional()
  @IsString()
  download_url?: string; // https://presigned-url

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  speakers?: string[];

  @IsOptional()
  @IsString()
  report_content?: string; // 종합 회의록 마크다운

  @IsOptional()
  @IsString()
  slack_webhook_url?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PersonalizedReportDto)
  personalized_reports?: PersonalizedReportDto[]; // 개인별 회의록

  @IsOptional()
  @IsString()
  completed_at?: string;
}
