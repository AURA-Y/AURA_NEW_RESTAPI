import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, In } from "typeorm";
import { RoomReport } from "../room/entities/room-report.entity";
import { Room } from "../room/entities/room.entity";
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
  ListObjectsV2Command,
  DeleteObjectsCommand,
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
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @InjectRepository(RoomReport)
    private reportsRepository: Repository<RoomReport>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Room)
    private roomRepository: Repository<Room>,
    private configService: ConfigService
  ) {
    this.bucketName =
      this.configService.get<string>("AURA_S3_BUCKET") ||
      this.configService.get<string>("AWS_BUCKET") ||
      "aura-raw-data-bucket";
    this.uploadPrefix =
      this.configService.get<string>("AURA_S3_PREFIX") || "rooms/";

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

  /**
   * S3 경로 생성 헬퍼 메서드들 (roomId 기반)
   */
  private getReportJsonKeys(roomId: string): string[] {
    const newKey = `${this.uploadPrefix}${roomId}/report.json`;
    return [newKey];
  }

  private getReportMarkdownKey(roomId: string): string {
    return `${this.uploadPrefix}${roomId}/report.md`;
  }

  private getReportFolderPrefix(roomId: string): string {
    return `${this.uploadPrefix}${roomId}/`;
  }

  private async getAccessibleReportIds(
    userId: string,
    nickName: string
  ): Promise<string[]> {
    const rooms = await this.roomRepository
      .createQueryBuilder("room")
      .select("room.roomId", "roomId")
      .where("(room.master = :userId OR :nickName = ANY(room.attendees))", { userId, nickName })
      .getRawMany();

    return rooms.map((room) => room.roomId);
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

  async findAllByUserId(userId: string): Promise<RoomReport[]> {
    const user = await this.userRepository.findOne({
      where: { userId },
      select: { userId: true, nickName: true },
    });
    if (!user) {
      return [];
    }

    const reportIds = await this.getAccessibleReportIds(
      user.userId,
      user.nickName
    );
    if (reportIds.length === 0) {
      return [];
    }

    return this.findByIds(reportIds);
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
    }>,
    reportId?: string
  ): Promise<FileInfo[]> {
    if (!files || files.length === 0) return [];

    const region = this.configService.get<string>(
      "AWS_REGION",
      "ap-northeast-2"
    );
    const results: FileInfo[] = [];
    const targetFolder = reportId || randomUUID();

    for (const file of files) {
      const fileId = randomUUID();
      const safeName = encodeURIComponent(file.originalname);
      // rooms/{roomId}/uploads/{fileId}-{filename} 구조
      const key = `${this.uploadPrefix}${targetFolder}/uploads/${fileId}-${safeName}`;

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
    reportId?: string
  ) {
    const fileId = randomUUID();
    const safeName = encodeURIComponent(fileName);
    // reportId를 폴더명으로 사용, 없으면 새로 생성
    const targetFolder = reportId || randomUUID();
    const key = `${this.uploadPrefix}${targetFolder}/uploads/${fileId}-${safeName}`;

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

    const region = this.configService.get<string>(
      "AWS_REGION",
      "ap-northeast-2"
    );
    const fileUrl = `https://${this.bucketName}.s3.${region}.amazonaws.com/${key}`;

    return { uploadId, key, fileId, fileUrl };
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

    const region = this.configService.get<string>(
      "AWS_REGION",
      "ap-northeast-2"
    );
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
    userId: string;
    topic: string;
    summary?: string;
    attendees: string[];
    uploadFileList: FileInfo[];
    createdAt?: string;
  }): Promise<ReportDetails> {
    const reportId = payload.reportId || randomUUID();
    const createdAt = payload.createdAt || new Date().toISOString();
    const summary =
      payload.summary || "회의 요약: 회의 종료 시점에 자동 생성됩니다.";

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
      topic: payload.topic,
      summary,
      attendees: payload.attendees,
      uploadFileList: payload.uploadFileList || [],
    };
    await this.saveReportDetailsToS3(details);

    return details;
  }

  async saveReportDetailsToS3(details: ReportDetails) {
    const region = this.configService.get<string>(
      "AWS_REGION",
      "ap-northeast-2"
    );
    const markdownUrl = `https://${
      this.bucketName
    }.s3.${region}.amazonaws.com/${this.getReportMarkdownKey(
      details.reportId
    )}`;

    // 1. report.json 저장 (summary에 마크다운 파일 URL 저장, 실제 파일은 생성하지 않음)
    const jsonPayload = {
      ...details,
      summary: markdownUrl, // 마크다운 파일 경로 저장 (파일은 나중에 생성될 수 있음)
    };
    const jsonKey = `${this.uploadPrefix}${details.reportId}/report.json`;
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: jsonKey,
        Body: JSON.stringify(jsonPayload, null, 2),
        ContentType: "application/json",
      })
    );
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

  async updateReportSummary(
    reportId: string,
    summary: string,
    roomId?: string
  ): Promise<ReportDetails> {
    const current = await this.getReportDetailsFromS3(reportId);

    // roomId가 제공되면 room에서 attendees 가져오기 (이미 nickname으로 저장됨)
    let attendees: string[] = current.attendees || [];

    if (roomId) {
      try {
        const room = await this.roomRepository.findOne({ where: { roomId } });

        if (room && room.attendees && room.attendees.length > 0) {
          // room.attendees는 이미 nickname으로 저장되어 있음
          attendees = room.attendees;
        }
      } catch (error) {
        this.logger.warn(`Failed to get attendees from room: ${error.message}`);
        // 실패 시 기존 attendees 유지
      }
    }

    const updated: ReportDetails = {
      ...current,
      summary,
      attendees,
    };

    // S3 JSON 업데이트
    await this.saveReportDetailsToS3(updated);

    // PostgreSQL room_report 테이블도 업데이트
    await this.reportsRepository.update({ reportId }, { attendees });

    return updated;
  }

  async attachReportToUser(userId: string, reportId: string) {
    const user = await this.userRepository.findOne({
      where: { userId },
      select: { userId: true, nickName: true },
    });
    if (!user) {
      throw new NotFoundException(`User not found: ${userId}`);
    }

    // reportId는 실제로 roomId - room 테이블에서 확인
    let room = await this.roomRepository.findOne({
      where: { roomId: reportId },
    });

    // room이 없으면 자동 생성 (LiveKit에서 먼저 생성된 경우)
    if (!room) {
      this.logger.log(`Room not found in DB, creating: ${reportId}`);
      // Note: Auto-created rooms need a default channelId - this should be improved
      // to require channelId from the caller or use a system default channel
      room = this.roomRepository.create({
        roomId: reportId,
        roomTopic: `Meeting ${reportId.substring(0, 8)}`,
        roomDescription: 'Auto-created room',
        roomShareLink: `${reportId}-${Date.now()}`,
        masterId: userId,
        channelId: userId, // Temporary: using userId as channelId placeholder
        attendees: [user.nickName],
      });
      await this.roomRepository.save(room);
      this.logger.log(`Room created: ${reportId} by ${user.nickName}`);
    } else {
      // 기존 room이 있으면 권한 확인
      const isMaster = room.masterId === userId;
      const isAttendee = room.attendees.includes(user.nickName);

      if (!isMaster && !isAttendee) {
        throw new ForbiddenException("Not allowed to access this report");
      }

      // attendees에 없으면 추가
      if (!isAttendee && !isMaster) {
        room.attendees.push(user.nickName);
        await this.roomRepository.save(room);
        this.logger.log(`Added ${user.nickName} to room ${reportId}`);
      }
    }

    // report가 없으면 자동 생성
    let report = await this.reportsRepository.findOne({
      where: { reportId },
    });

    if (!report) {
      report = this.reportsRepository.create({
        reportId,
        topic: room.roomTopic,
        roomId: room.roomId,
        channelId: room.channelId,
        teamId: room.teamId,
        attendees: room.attendees,
      });
      await this.reportsRepository.save(report);
      this.logger.log(`Report created: ${reportId}`);
    }

    const reportIds = await this.getAccessibleReportIds(
      user.userId,
      user.nickName
    );

    return reportIds;
  }

  async getReportDetailsFromS3(roomId: string): Promise<any> {
    const tryKeys = this.getReportJsonKeys(roomId);

    for (const key of tryKeys) {
      try {
        const command = new GetObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        });

        const response = await this.s3Client.send(command);
        const bodyContents = await response.Body.transformToString();
        const parsed = JSON.parse(bodyContents);

        // summary가 report.md URL이면 내용 읽어오기 시도
        if (parsed.summary && parsed.summary.endsWith("report.md")) {
          try {
            const mdKey = this.getReportMarkdownKey(roomId);
            const mdCommand = new GetObjectCommand({
              Bucket: this.bucketName,
              Key: mdKey,
            });
            const mdResponse = await this.s3Client.send(mdCommand);
            // summary 필드를 마크다운 내용으로 교체
            parsed.summary = await mdResponse.Body.transformToString();
          } catch (mdErr) {
            this.logger.warn(
              `Markdown file not found for ${roomId}: ${mdErr.message}`
            );
            // 파일이 없으면 안내 메시지
            parsed.summary =
              "(회의록 md파일 생성 - 추후 예정) 파일이 없습니다.";
          }
        }

        return parsed;
      } catch (error) {
        this.logger.warn(`Report JSON not found at key=${key}, try next`);
      }
    }

    throw new NotFoundException(
      `Report details not found in S3 for ID ${roomId}`
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
      const rawFileName = decodeURIComponent(
        normalizedParts[normalizedParts.length - 1] || "download"
      );
      // UUID(36자) + 하이픈(1자) 제거
      const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;
      const fileName = rawFileName.replace(uuidPattern, "");

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
      this.logger.error(
        `Failed to download from S3. url=${fileUrl}`,
        error as Error
      );
      throw new NotFoundException(`File not found in S3: ${fileUrl}`);
    }
  }

  /**
   * S3에서 특정 prefix(폴더)의 모든 객체를 삭제
   */
  private async deleteS3FolderByPrefix(prefix: string): Promise<number> {
    try {
      // 1. prefix에 해당하는 모든 객체 조회
      const listCommand = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
      });

      const listResponse = await this.s3Client.send(listCommand);

      if (!listResponse.Contents || listResponse.Contents.length === 0) {
        return 0;
      }

      // 2. 모든 객체를 일괄 삭제 (최대 1000개)
      const objectsToDelete = listResponse.Contents.map((obj) => ({
        Key: obj.Key!,
      }));

      const deleteCommand = new DeleteObjectsCommand({
        Bucket: this.bucketName,
        Delete: {
          Objects: objectsToDelete,
          Quiet: true,
        },
      });

      await this.s3Client.send(deleteCommand);
      return objectsToDelete.length;
    } catch (error) {
      this.logger.error(`Failed to delete S3 folder at ${prefix}: ${error}`);
      return 0;
    }
  }

  /**
   * S3에서 roomId에 해당하는 모든 폴더 삭제
   */
  private async deleteS3Folder(roomId: string): Promise<void> {
    const prefix = this.getReportFolderPrefix(roomId); // rooms/roomId/
    const deleted = await this.deleteS3FolderByPrefix(prefix);

    if (deleted > 0) {
      this.logger.log(`Deleted ${deleted} objects for roomId: ${roomId}`);
    } else {
      this.logger.warn(`No objects found for roomId: ${roomId}`);
    }
  }

  async deleteReport(roomId: string, userId: string) {
    const user = await this.userRepository.findOne({
      where: { userId },
      select: { userId: true, nickName: true },
    });
    if (!user) {
      throw new NotFoundException(`User not found: ${userId}`);
    }

    const reportIds = await this.getAccessibleReportIds(
      user.userId,
      user.nickName
    );
    if (!reportIds.includes(roomId)) {
      throw new ForbiddenException("Not allowed to delete this report");
    }

    // S3 ??? ??? ??? (roomId/ ???????? ??? + report.json + report.md)
    try {
      await this.deleteS3Folder(roomId);
    } catch (error) {
      this.logger.warn(`Failed to delete S3 folder for ${roomId}: ${error}`);
    }

    // DB ??? ???
    await this.reportsRepository.delete({ reportId: roomId });

    return { deleted: true };
  }
}
