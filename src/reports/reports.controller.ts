import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UploadedFiles,
  Req,
  UseGuards,
  Res,
  StreamableFile,
  UseInterceptors,
  NotFoundException,
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
      limits: { fileSize: 10 * 1024 * 1024 },
    })
  )
  async uploadFiles(
    @UploadedFiles() files: any[],
    @Query("reportId") reportId?: string
  ) {
    const uploadFileList = await this.reportsService.uploadFilesToS3(
      files,
      reportId
    );
    return { uploadFileList };
  }

  // 멀티파트 업로드 시작 (presigned)
  @Post("multipart/start")
  @UseGuards(JwtAuthGuard)
  async startMultipart(
    @Body()
    body: {
      fileName: string;
      fileType: string;
      reportId?: string;
    },
    @Req() req: Request
  ) {
    const userId = (req as any).user?.id;
    if (!userId) {
      throw new Error("userId is required from token");
    }
    return this.reportsService.startMultipartUpload(
      body.fileName,
      body.fileType || "application/octet-stream",
      userId,
      body.reportId
    );
  }

  // 멀티파트 파트별 presigned URL 발급
  @Post("multipart/presign")
  @UseGuards(JwtAuthGuard)
  async presignMultipart(
    @Body()
    body: {
      uploadId: string;
      key: string;
      partNumber: number;
      fileType: string;
    }
  ) {
    return this.reportsService.getPresignedPartUploadUrl({
      uploadId: body.uploadId,
      key: body.key,
      partNumber: body.partNumber,
      fileType: body.fileType || "application/octet-stream",
    });
  }

  // 멀티파트 업로드 완료
  @Post("multipart/complete")
  @UseGuards(JwtAuthGuard)
  async completeMultipart(
    @Body()
    body: {
      uploadId: string;
      key: string;
      parts: { partNumber: number; eTag: string }[];
    }
  ) {
    return this.reportsService.completeMultipartUpload(body);
  }

  // 멀티파트 업로드 중단
  @Post("multipart/abort")
  @UseGuards(JwtAuthGuard)
  async abortMultipart(@Body() body: { uploadId: string; key: string }) {
    return this.reportsService.abortMultipartUpload(body);
  }

  // 보고서 요약 업데이트
  @Patch(":id/summary")
  @UseGuards(JwtAuthGuard)
  async updateReportSummary(
    @Param("id") id: string,
    @Body() body: { summary: string; roomId?: string }
  ) {
    return this.reportsService.updateReportSummary(
      id,
      body.summary,
      body.roomId
    );
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard)
  async deleteReport(@Param("id") id: string, @Req() req: Request) {
    const userId = (req as any).user?.id;
    if (!userId) {
      throw new Error("userId is required from token");
    }
    return this.reportsService.deleteReport(id, userId);
  }

  // 보고서 생성: DB 메타 + S3 JSON 기록
  @Post()
  @UseGuards(JwtAuthGuard)
  async createReport(@Body() body: CreateReportDto, @Req() req: Request) {
    const userId = (req as any).user?.id;
    if (!userId) {
      throw new Error("userId is required from token");
    }
    const details = await this.reportsService.createReport({ ...body, userId });
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

  // 회의 종료 등으로 회의록 확정
  @Post(":id/finalize")
  @UseGuards(JwtAuthGuard)
  async finalizeReport(
    @Param("id") id: string,
    @Body() body: Partial<CreateReportDto>
  ) {
    const updated = await this.reportsService.finalizeReport(id, body as any);
    return updated;
  }

  @Get("user-reports")
  @UseGuards(JwtAuthGuard)
  async getUserReports(@Req() req: Request) {
    const userId = (req as any).user?.id;
    if (!userId) {
      throw new Error("userId is required from token");
    }
    // status 필드를 포함하여 반환 (S3에서 가져옴)
    return this.reportsService.findAllByUserIdWithStatus(userId);
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

  // 단일 리포트 조회 (DB)
  @Get(":id")
  @UseGuards(JwtAuthGuard)
  async getReportById(@Param("id") id: string): Promise<RoomReport> {
    const report = await this.reportsService.findById(id);
    if (!report) {
      throw new NotFoundException(`Report not found: ${id}`);
    }
    return report;
  }
}
