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
import { RagReportCallbackDto } from "./dto/rag-callback.dto";
import { SseService } from "../sse/sse.service";
import * as multer from "multer";
import { Logger } from "@nestjs/common";

@Controller("reports")
export class ReportsController {
  private readonly logger = new Logger(ReportsController.name);

  constructor(
    private readonly reportsService: ReportsService,
    private readonly sseService: SseService,
  ) {}

  /**
   * RAG 서버 콜백 엔드포인트
   * 회의록 생성 완료 시 RAG 서버에서 호출 (회의 중 또는 종료 후)
   * - 종합 회의록 (report_content) S3 저장
   * - SSE 알림 전송
   */
  @Post("callback")
  async handleRagCallback(@Body() body: RagReportCallbackDto) {
    this.logger.log(`\n========== [RAG Callback 수신] ==========`);
    this.logger.log(`Event: ${body.event}`);
    this.logger.log(`Room ID: ${body.room_id}`);
    this.logger.log(`Meeting Title: ${body.meeting_title}`);
    this.logger.log(`Speakers: ${body.speakers?.join(", ") || "없음"}`);
    this.logger.log(`Report Content 길이: ${body.report_content?.length || 0}자`);

    // report_complete 이벤트가 아니면 무시
    if (body.event !== "report_complete") {
      this.logger.warn(`Unknown event type: ${body.event}`);
      return { success: false, message: `Unknown event: ${body.event}` };
    }

    const roomId = body.room_id;

    try {
      // 1. 종합 회의록 저장 (report_content가 있는 경우)
      if (body.report_content) {
        this.logger.log(`[종합 회의록] S3에 저장 중...`);
        await this.reportsService.updateReportSummary(
          roomId,
          body.report_content,
          roomId
        );
        this.logger.log(`[종합 회의록] S3 저장 완료`);
      }

      // 2. 회의 종료 시간 업데이트 (ended_at이 전달된 경우만)
      if (body.ended_at) {
        this.logger.log(`[회의 종료 시간] ${body.ended_at}`);
        await this.reportsService.setMeetingEndTime(roomId, body.ended_at);
      }

      // 3. SSE 알림 전송
      this.logger.log(`[SSE] 알림 전송 중...`);
      const notifyResult = await this.sseService.handleReportComplete({
        roomId,
        meetingTitle: body.meeting_title || "회의",
        reportUrl: body.report_url || "",
        downloadUrl: body.download_url || "",
        speakers: body.speakers || [],
        completedAt: body.completed_at || new Date().toISOString(),
      });

      this.logger.log(`[SSE] 알림 완료 - 성공: ${notifyResult.notified.length}, 실패: ${notifyResult.failed.length}`);
      this.logger.log(`========== [RAG Callback 완료] ==========\n`);

      return {
        success: true,
        roomId,
        reportSaved: !!body.report_content,
        notified: notifyResult.notified.length,
      };
    } catch (error) {
      this.logger.error(`[RAG Callback 오류] ${error.message}`);
      return {
        success: false,
        roomId,
        message: error.message,
      };
    }
  }

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

  // 파일 다운로드/미리보기용 Presigned URL 발급
  @Post("file/presign")
  @UseGuards(JwtAuthGuard)
  async getFilePresignedUrl(@Body() body: { fileUrl: string }) {
    const presignedUrl = await this.reportsService.getPresignedDownloadUrl(
      body.fileUrl
    );
    return { presignedUrl };
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
    const userNickName = (req as any).user?.nickName;
    if (!userId) {
      throw new Error("userId is required from token");
    }
    const details = await this.reportsService.createReport({ ...body, userId });

    // 회의록 생성 시점에는 알림 없음
    // 요약 완료 시점(RAG 웹훅 handleReportComplete)에서 알림 전송

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
    // SSE 알림 기반으로 전환 - S3 status 조회 제거
    return this.reportsService.findAllByUserId(userId);
  }

  // 여러 리포트 조회 (쿼리 파라미터로 ids 전달) - 구체적인 라우트 먼저
  @Get("list")
  @UseGuards(JwtAuthGuard)
  async findByIds(@Query("ids") ids: string): Promise<RoomReport[]> {
    const reportIds = ids.split(",");
    return this.reportsService.findByIds(reportIds);
  }

  /**
   * 사용자가 접근 가능한 회의록 목록 조회
   * - 전체 공개 회의록 (participantUserIds가 빈 배열)
   * - 사용자 ID가 포함된 회의록
   */
  @Get("accessible/:channelId")
  @UseGuards(JwtAuthGuard)
  async getAccessibleReports(
    @Param("channelId") channelId: string,
    @Req() req: Request
  ): Promise<RoomReport[]> {
    const userId = (req as any).user?.id;
    if (!userId) {
      throw new Error("userId is required from token");
    }
    return this.reportsService.getAccessibleReports(userId, channelId);
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

  // S3 파일 Presigned URL 발급 (PDF 미리보기용)
  @Post("file/presign")
  @UseGuards(JwtAuthGuard)
  async getPresignedUrl(@Body() body: { fileUrl: string }) {
    const presignedUrl = await this.reportsService.getPresignedDownloadUrl(body.fileUrl);
    return { presignedUrl };
  }

  // S3에서 리포트 상세 정보 조회 (접근 권한 확인)
  @Get(":id/details")
  @UseGuards(JwtAuthGuard)
  async getReportDetails(@Param("id") id: string, @Req() req: Request): Promise<any> {
    const userId = (req as any).user?.id;
    if (!userId) {
      throw new NotFoundException("User not found");
    }
    return this.reportsService.getReportDetailsFromS3WithAccessCheck(id, userId);
  }

  // 단일 리포트 조회 (DB) - 접근 권한 확인
  @Get(":id")
  @UseGuards(JwtAuthGuard)
  async getReportById(@Param("id") id: string, @Req() req: Request): Promise<RoomReport> {
    const userId = (req as any).user?.id;
    if (!userId) {
      throw new NotFoundException("User not found");
    }
    return this.reportsService.findByIdWithAccessCheck(id, userId);
  }
}
