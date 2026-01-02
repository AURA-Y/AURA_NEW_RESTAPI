import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Res,
  StreamableFile,
} from "@nestjs/common";
import { Response } from "express";
import { ReportsService } from "./reports.service";
import { RoomReport } from "../room/entities/room-report.entity";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@Controller("reports")
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  // 여러 리포트 조회 (쿼리 파라미터로 ids 전달) - 구체적인 라우트 먼저
  @Get("list")
  @UseGuards(JwtAuthGuard)
  async findByIds(@Query("ids") ids: string): Promise<RoomReport[]> {
    const reportIds = ids.split(",");
    return this.reportsService.findByIds(reportIds);
  }

  // S3 파일 다운로드 프록시
  @Get("download")
  @UseGuards(JwtAuthGuard)
  async downloadFile(
    @Query("fileUrl") fileUrl: string,
    @Res({ passthrough: true }) res: Response
  ): Promise<StreamableFile> {
    const { stream, fileName, contentType } =
      await this.reportsService.downloadFileFromS3(fileUrl);

    res.set({
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(
        fileName
      )}"`,
    });

    return new StreamableFile(stream);
  }

  // S3에서 리포트 상세 정보 조회
  @Get(":id/details")
  @UseGuards(JwtAuthGuard)
  async getReportDetails(@Param("id") id: string): Promise<any> {
    return this.reportsService.getReportDetailsFromS3(id);
  }
}
