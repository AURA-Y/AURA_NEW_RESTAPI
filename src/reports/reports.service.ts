import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, In } from "typeorm";
import { RoomReport } from "../room/entities/room-report.entity";
import { User } from "../auth/entities/user.entity";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
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
        accessKeyId: this.configService.get<string>("AWS_ACCESS_KEY_ID_S3"),
        secretAccessKey: this.configService.get<string>(
          "AWS_SECRET_ACCESS_KEY_S3"
        ),
      },
    });
  }

  // 여러 리포트 조회 (reportId 배열로)
  async findByIds(reportIds: string[]): Promise<RoomReport[]> {
    if (!reportIds || reportIds.length === 0) {
      return [];
    }

    return this.reportsRepository.find({
      where: { reportId: In(reportIds) },
      order: { createdAt: "DESC" },
    });
  }

  // 리포트 생성 (메타만)
  async create(reportData: Partial<RoomReport>): Promise<RoomReport> {
    const report = this.reportsRepository.create(reportData);
    return this.reportsRepository.save(report);
  }

  // 파일을 S3에 업로드하고 메타데이터 반환
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

  // 보고서 생성: DB 메타 저장 + S3 JSON 기록
  async createReport(payload: {
    topic: string;
    summary?: string;
    attendees: string[];
    uploadFileList: FileInfo[];
    createdAt?: string;
  }): Promise<ReportDetails> {
    const reportId = randomUUID();
    const createdAt = payload.createdAt || new Date().toISOString();
    const summary =
      payload.summary ||
      "회의 요약(목데이터): 회의 종료 시점에 자동 생성된 예시 텍스트입니다.";

    // DB 메타 저장
    const meta = this.reportsRepository.create({
      reportId,
      createdAt: new Date(createdAt),
      topic: payload.topic,
      attendees: payload.attendees,
    });
    await this.reportsRepository.save(meta);

    // S3 JSON 저장
    const details: ReportDetails = {
      reportId,
      createdAt,
      topic: payload.topic,
      summary,
      attendees: payload.attendees,
      uploadFileList: payload.uploadFileList || [],
    };
    await this.saveReportDetailsToS3(details);

    return details;
  }

  async saveReportDetailsToS3(details: ReportDetails) {
    const key = `${this.reportsPrefix}${details.reportId}.json`;
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: JSON.stringify(details, null, 2),
        ContentType: "application/json",
      })
    );
  }

  // 회의 종료 시 요약/참석자 등 업데이트
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

  // 보고서를 현재 사용자에 연결
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

  // S3에서 리포트 상세 정보 가져오기
  async getReportDetailsFromS3(reportId: string): Promise<any> {
    const s3Key = `reports/${reportId}.json`;

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
      });

      const response = await this.s3Client.send(command);
      const bodyContents = await response.Body.transformToString();
      return JSON.parse(bodyContents);
    } catch (error) {
      throw new NotFoundException(
        `Report details not found in S3 for ID ${reportId}`
      );
    }
  }

  // S3에서 파일 다운로드
  async downloadFileFromS3(fileUrl: string): Promise<{
    stream: any;
    fileName: string;
    contentType: string;
  }> {
    try {
      const url = new URL(fileUrl);
      // S3 key는 인코딩된 상태로 저장되므로 디코딩하지 않음
      const pathParts = url.pathname
        .split("/")
        .filter((p) => p);

      // 버킷명이 경로에 포함된 경우 제거
      const keyParts =
        pathParts[0] === this.bucketName
          ? pathParts.slice(1)
          : pathParts;

      const s3Key = keyParts.join("/");
      // 파일명은 디코딩해서 사용자에게 표시
      const fileName = decodeURIComponent(keyParts[keyParts.length - 1] || "download");

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
}
