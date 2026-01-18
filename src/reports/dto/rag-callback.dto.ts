import {
  IsArray,
  IsOptional,
  IsString,
} from "class-validator";

/**
 * RAG 서버에서 보내는 콜백 JSON
 * 회의록 생성 완료 시 호출됨 (회의 중 또는 종료 후)
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
  @IsString()
  completed_at?: string; // 회의록 생성 완료 시간 (ISO 8601)

  @IsOptional()
  @IsString()
  ended_at?: string; // 회의 종료 시간 (ISO 8601) - 종료 후 생성 시에만 전달
}
