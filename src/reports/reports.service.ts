import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, In } from "typeorm";
import { RoomReport } from "../room/entities/room-report.entity";
import { User } from "../auth/entities/user.entity";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";

export interface FileInfo {
  fileId: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  fileType: string;
}

export interface ReportDetails {
  reportId: string;
  createdAt: string;
  folderId?: string;
  topic: string;
  summary: string;
  attendees: string[];
  uploadFileList: FileInfo[];
}

@Injectable()
export class ReportsService {
  private s3Client: S3Client;
  private readonly bucketName: string;
  private readonly uploadPrefix: string;
  private readonly reportsPrefix = "reports/";
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @InjectRepository(RoomReport)
    private reportsRepository: Repository<RoomReport>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private configService: ConfigService
  ) {
    this.bucketName =
      this.configService.get<string>("AURA_S3_BUCKET") ||
      this.configService.get<string>("AWS_BUCKET") ||
      "aura-raw-data-bucket";
    this.uploadPrefix = this.configService.get<string>("AURA_S3_PREFIX") || "meetings/";

    this.s3Client = new S3Client({
      region: this.configService.get<string>("AWS_REGION", "ap-northeast-2"),
      credentials: {
        accessKeyId:
          this.configService.get<string>("AWS_ACCESS_KEY_ID_S3") ||
          this.configService.get<string>("AWS_ACCESS_KEY_ID"),
        secretAccessKey:
          this.configService.get<string>("AWS_SECRET_ACCESS_KEY_S3") ||
          this.configService.get<string>("AWS_SECRET_ACCESS_KEY"),
      },
    });
  }

  async findByIds(reportIds: string[]): Promise<RoomReport[]> {
    if (!reportIds || reportIds.length === 0) {
      return [];
    }

    return this.reportsRepository.find({
      where: { reportId: In(reportIds) },
      order: { createdAt: "DESC" },
    });
  }

  async create(reportData: Partial<RoomReport>): Promise<RoomReport> {
    const report = this.reportsRepository.create(reportData);
    return this.reportsRepository.save(report);
  }

  // 기존 프록시 업로드 (multipart/form-data)
  async uploadFilesToS3(
    files: Array<{
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    }>
  ): Promise<FileInfo[]> {
    if (!files || files.length === 0) return [];

    const region = this.configService.get<string>("AWS_REGION", "ap-northeast-2");
    const results: FileInfo[] = [];

    for (const file of files) {
      const fileId = randomUUID();
      const safeName = encodeURIComponent(file.originalname);
      const now = new Date();
      const key = `${this.uploadPrefix}${now.getFullYear()}/${String(
        now.getMonth() + 1
      ).padStart(2, "0")}/${fileId}-${safeName}`;

      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
        })
      );

      results.push({
        fileId,
        fileName: file.originalname,
        fileUrl: `https://${this.bucketName}.s3.${region}.amazonaws.com/${key}`,
        fileSize: file.size,
        fileType: file.mimetype || "application/octet-stream",
      });
    }

    return results;
  }

  // 멀티파트 업로드 시작 (presigned)
  async startMultipartUpload(
    fileName: string,
    fileType: string,
    userId: string,
    folderId?: string,
    reportId?: string
  ) {
    const fileId = randomUUID();
    const now = new Date();
    const safeName = encodeURIComponent(fileName);
    const baseFolder =
      folderId ||
      `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(
        now.getDate()
      ).padStart(2, "0")}/${userId}/${reportId || randomUUID()}`;
    const key = `${this.uploadPrefix}${baseFolder}/files/${fileId}-${safeName}`;

    const command = new CreateMultipartUploadCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: fileType,
    });

    const res = await this.s3Client.send(command);
    const uploadId = res.UploadId;
    if (!uploadId) {
      throw new Error("Failed to create multipart upload");
    }

    const region = this.configService.get<string>("AWS_REGION", "ap-northeast-2");
    const fileUrl = `https://${this.bucketName}.s3.${region}.amazonaws.com/${key}`;

    return { uploadId, key, fileId, fileUrl, folderId: baseFolder };
  }

  // 파트별 presigned URL 발급
  async getPresignedPartUploadUrl(params: {
    uploadId: string;
    key: string;
    partNumber: number;
    fileType: string;
  }) {
    const command = new UploadPartCommand({
      Bucket: this.bucketName,
      Key: params.key,
      UploadId: params.uploadId,
      PartNumber: params.partNumber,
    });

    const presignedUrl = await getSignedUrl(this.s3Client, command, {
      expiresIn: 300,
    });

    return { presignedUrl };
  }

  // 멀티파트 업로드 완료
  async completeMultipartUpload(params: {
    uploadId: string;
    key: string;
    parts: { partNumber: number; eTag: string }[];
  }) {
    const command = new CompleteMultipartUploadCommand({
      Bucket: this.bucketName,
      Key: params.key,
      UploadId: params.uploadId,
      MultipartUpload: {
        Parts: params.parts.map((p) => ({
          ETag: p.eTag,
          PartNumber: p.partNumber,
        })),
      },
    });

    await this.s3Client.send(command);

    const region = this.configService.get<string>("AWS_REGION", "ap-northeast-2");
    const fileUrl = `https://${this.bucketName}.s3.${region}.amazonaws.com/${params.key}`;

    return { fileUrl };
  }

  async abortMultipartUpload(params: { uploadId: string; key: string }) {
    const command = new AbortMultipartUploadCommand({
      Bucket: this.bucketName,
      Key: params.key,
      UploadId: params.uploadId,
    });
    await this.s3Client.send(command);
    return { aborted: true };
  }

  // 보고서 생성: DB 메타 + S3 JSON 기록
  async createReport(payload: {
    reportId?: string;
    folderId?: string;
    userId: string;
    topic: string;
    summary?: string;
    attendees: string[];
    uploadFileList: FileInfo[];
    createdAt?: string;
  }): Promise<ReportDetails> {
    const reportId = payload.reportId || randomUUID();
    const createdAt = payload.createdAt || new Date().toISOString();
    const createdDate = new Date(createdAt);
    const folderId =
      payload.folderId ||
      `${createdDate.getFullYear()}/${String(createdDate.getMonth() + 1).padStart(2, "0")}/${String(
        createdDate.getDate()
      ).padStart(2, "0")}/${payload.userId || "unknown"}/${reportId}`;
    const summary =
      payload.summary ||
      "회의 요약(목데이터): 회의 종료 시점에 자동 생성됩니다.";

    const meta = this.reportsRepository.create({
      reportId,
      createdAt: new Date(createdAt),
      topic: payload.topic,
      attendees: payload.attendees,
    });
    await this.reportsRepository.save(meta);

    const details: ReportDetails = {
      reportId,
      createdAt,
      folderId,
      topic: payload.topic,
      summary,
      attendees: payload.attendees,
      uploadFileList: payload.uploadFileList || [],
    };
    await this.saveReportDetailsToS3(details);

    return details;
  }

  async saveReportDetailsToS3(details: ReportDetails) {
    const newKey = `${this.uploadPrefix}${details.folderId || details.reportId}/report.json`;
    const legacyKey = `${this.reportsPrefix}${details.reportId}.json`;
    const payload = JSON.stringify(details, null, 2);
    for (const key of [newKey, legacyKey]) {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: payload,
          ContentType: "application/json",
        })
      );
    }
  }

  async finalizeReport(
    reportId: string,
    data: Partial<ReportDetails>
  ): Promise<ReportDetails> {
    const current = await this.getReportDetailsFromS3(reportId);
    const updated: ReportDetails = {
      ...current,
      ...data,
      reportId,
    };
    await this.saveReportDetailsToS3(updated);
    await this.reportsRepository.update(
      { reportId },
      {
        topic: updated.topic,
        attendees: updated.attendees,
        createdAt: new Date(updated.createdAt),
      }
    );
    return updated;
  }

  async attachReportToUser(userId: string, reportId: string) {
    const user = await this.userRepository.findOne({ where: { userId } });
    if (!user) {
      throw new NotFoundException(`User not found: ${userId}`);
    }
    const current = new Set(user.roomReportIdxList || []);
    current.add(reportId);
    user.roomReportIdxList = Array.from(current);
    await this.userRepository.save(user);
    return user.roomReportIdxList;
  }

  async getReportDetailsFromS3(reportId: string): Promise<any> {
    const tryKeys = [
      `${this.uploadPrefix}${reportId}/report.json`,
      `${this.reportsPrefix}${reportId}.json`,
    ];

    for (const key of tryKeys) {
      try {
        const command = new GetObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        });

        const response = await this.s3Client.send(command);
        const bodyContents = await response.Body.transformToString();
        const parsed = JSON.parse(bodyContents);
        if (!parsed.folderId && key.startsWith(this.uploadPrefix)) {
          parsed.folderId = key
            .replace(this.uploadPrefix, "")
            .replace(/\/report\.json$/, "");
        }
        return parsed;
      } catch (error) {
        this.logger.warn(`Report JSON not found at key=${key}, try next`);
      }
    }

    throw new NotFoundException(
      `Report details not found in S3 for ID ${reportId}`
    );
  }

  async downloadFileFromS3(fileUrl: string): Promise<{
    stream: any;
    fileName: string;
    contentType: string;
  }> {
    try {
      const url = new URL(fileUrl);
      const pathParts = url.pathname.split("/").filter((p) => p);
      const normalizedParts =
        pathParts[0] === this.bucketName ? pathParts.slice(1) : pathParts;

      const s3Key = normalizedParts.join("/");
      const fileName = decodeURIComponent(
        normalizedParts[normalizedParts.length - 1] || "download"
      );

      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
      });

      const response = await this.s3Client.send(command);
      const contentType = response.ContentType || "application/octet-stream";

      return {
        stream: response.Body,
        fileName,
        contentType,
      };
    } catch (error) {
      this.logger.error(`Failed to download from S3. url=${fileUrl}`, error as Error);
      throw new NotFoundException(`File not found in S3: ${fileUrl}`);
    }
  }

  async deleteReport(reportId: string, userId: string) {
    const user = await this.userRepository.findOne({ where: { userId } });
    if (!user) {
      throw new NotFoundException(`User not found: ${userId}`);
    }
    if (!user.roomReportIdxList?.includes(reportId)) {
      throw new ForbiddenException("Not allowed to delete this report");
    }

    // S3 JSON + 첨부 삭제
    let details: ReportDetails | null = null;
    try {
      details = await this.getReportDetailsFromS3(reportId);
    } catch (error) {
      this.logger.warn(`Report details JSON not found for ${reportId}, continue delete`);
    }

    if (details?.uploadFileList) {
      for (const file of details.uploadFileList) {
        try {
          const url = new URL(file.fileUrl);
          const pathParts = url.pathname.split("/").filter((p) => p);
          const normalized =
            pathParts[0] === this.bucketName ? pathParts.slice(1) : pathParts;
          const key = normalized.join("/");
          await this.s3Client.send(
            new DeleteObjectCommand({
              Bucket: this.bucketName,
              Key: key,
            })
          );
        } catch (err) {
          this.logger.warn(`Failed to delete attachment ${file.fileUrl}: ${err}`);
        }
      }
    }

    // JSON 삭제 (신규 + 레거시)
    const jsonKeys = [
      details?.folderId
        ? `${this.uploadPrefix}${details.folderId}/report.json`
        : `${this.uploadPrefix}${reportId}/report.json`,
      `${this.reportsPrefix}${reportId}.json`,
    ];
    for (const key of jsonKeys) {
      try {
        await this.s3Client.send(
          new DeleteObjectCommand({
            Bucket: this.bucketName,
            Key: key,
          })
        );
      } catch (err) {
        this.logger.warn(`Failed to delete report JSON for ${reportId} at ${key}: ${err}`);
      }
    }

    // DB 메타 삭제
    await this.reportsRepository.delete({ reportId });

    // 사용자 목록에서 제거
    user.roomReportIdxList = (user.roomReportIdxList || []).filter(
      (id) => id !== reportId
    );
    await this.userRepository.save(user);

    return { deleted: true };
  }
}
