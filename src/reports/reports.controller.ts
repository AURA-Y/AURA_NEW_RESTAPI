import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UploadedFiles,
  Req,
  UseGuards,
  Res,
  StreamableFile,
  UseInterceptors,
} from "@nestjs/common";
import { Response, Request } from "express";
import { ReportsService } from "./reports.service";
import { RoomReport } from "../room/entities/room-report.entity";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { FilesInterceptor } from "@nestjs/platform-express";
import { CreateReportDto } from "./dto/create-report.dto";
import * as multer from "multer";

@Controller("reports")
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  // 파일 업로드 -> S3 저장 후 메타 반환
  @Post("upload-files")
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FilesInterceptor("files", 10, {
      storage: multer.memoryStorage(),
      limits: { fileSize: 100 * 1024 * 1024 },
    })
  )
  async uploadFiles(@UploadedFiles() files: any[]) {
    const uploadFileList = await this.reportsService.uploadFilesToS3(files);
    return { uploadFileList };
  }

  // 보고서 생성: DB 메타 + S3 JSON 기록
  @Post()
  @UseGuards(JwtAuthGuard)
  async createReport(@Body() body: CreateReportDto) {
    const details = await this.reportsService.createReport(body);
    return details;
  }

  // 보고서를 현재 사용자에 연결
  @Post(":id/assign")
  @UseGuards(JwtAuthGuard)
  async assignReportToUser(@Param("id") id: string, @Req() req: Request) {
    const targetUserId = (req as any).user?.id;
    if (!targetUserId) {
      throw new Error("userId is required from token");
    }
    const roomReportIdxList = await this.reportsService.attachReportToUser(
      targetUserId,
      id
    );
    return { roomReportIdxList };
  }

  // 회의 종료 등으로 회의록 확정 (목데이터/추후 LLM용)
  @Post(":id/finalize")
  @UseGuards(JwtAuthGuard)
  async finalizeReport(@Param("id") id: string, @Body() body: Partial<CreateReportDto>) {
    const updated = await this.reportsService.finalizeReport(id, body as any);
    return updated;
  }

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
