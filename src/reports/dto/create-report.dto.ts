import {
  IsArray,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

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
}

export class CreateReportDto {
  @IsOptional()
  @IsString()
  reportId?: string;

  @IsOptional()
  @IsString()
  folderId?: string;

  @IsString()
  topic: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsArray()
  @IsString({ each: true })
  attendees: string[];

  @IsOptional()
  @IsISO8601()
  createdAt?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReportFileDto)
  uploadFileList: ReportFileDto[];
}
