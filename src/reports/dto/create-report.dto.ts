import {
  IsArray,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsEnum,
  IsUUID,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { ReportScope } from "../../room/entities/room-report.entity";

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
  @IsOptional()
  @IsString()
  reportId?: string;

  @IsString()
  roomId: string;

  @IsString()
  topic: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsArray()
  @IsString({ each: true })
  attendees: string[];

  @IsOptional()
  @IsEnum(ReportScope)
  shareScope?: ReportScope;

  @IsOptional()
  @IsArray()
  @IsUUID("4", { each: true })
  specialAuth?: string[];

  @IsOptional()
  @IsISO8601()
  createdAt?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReportFileDto)
  uploadFileList: ReportFileDto[];
}
