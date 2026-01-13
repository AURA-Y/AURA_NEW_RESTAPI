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
import { ChannelMember } from "../channel/entities/channel-member.entity";
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
  roomId: string;
  channelId: string;
  topic: string;
  description?: string;
  attendees: string[];
  createdAt: string;
  shareScope: "CHANNEL" | "PRIVATE";
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
    @InjectRepository(ChannelMember)
    private channelMemberRepository: Repository<ChannelMember>,
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
    // RoomReport에서 직접 조회 (attendees에 포함된 경우)
    const reports = await this.reportsRepository
      .createQueryBuilder("report")
      .select("report.reportId", "reportId")
      .where(":nickName = ANY(report.attendees)", { nickName })
      .getRawMany();

    return reports.map((report) => report.reportId);
  }

  async findByIds(reportIds: string[]): Promise<RoomReport[]> {
    if (!reportIds || reportIds.length === 0) {
      return [];
    }

    // reportId로 검색
    return this.reportsRepository.find({
      where: { reportId: In(reportIds) },
      order: { createdAt: "DESC" },
    });
  }

  /**
   * 단일 리포트 조회 (DB)
   * @param reportId - 리포트 ID
   * @returns RoomReport 엔티티 또는 null
   */
  async findById(reportId: string): Promise<RoomReport | null> {
    return this.reportsRepository.findOne({
      where: { reportId },
    });
  }

  /**
   * 사용자가 특정 회의록에 접근 가능한지 확인
   */
  async checkReportAccess(reportId: string, userId: string): Promise<boolean> {
    const report = await this.reportsRepository.findOne({
      where: { reportId },
      select: ['reportId', 'channelId', 'participantUserIds']
    });

    if (!report) return false;

    // 채널 멤버십 확인
    const membership = await this.channelMemberRepository.findOne({
      where: { userId, channelId: report.channelId }
    });

    if (!membership) return false;

    // 전체 공개인 경우 (participantUserIds가 빈 배열)
    if (!report.participantUserIds || report.participantUserIds.length === 0) {
      return true;
    }

    // 유저 제한인 경우 - 사용자 ID가 포함되어 있는지 확인
    return report.participantUserIds.includes(userId);
  }

  /**
   * 접근 권한을 확인한 후 리포트 조회
   */
  async findByIdWithAccessCheck(reportId: string, userId: string): Promise<RoomReport> {
    const report = await this.findById(reportId);
    if (!report) {
      throw new NotFoundException(`Report not found: ${reportId}`);
    }

    const hasAccess = await this.checkReportAccess(reportId, userId);
    if (!hasAccess) {
      throw new ForbiddenException('이 회의록에 접근할 권한이 없습니다');
    }

    return report;
  }

  /**
   * 접근 권한을 확인한 후 S3에서 리포트 상세 조회
   */
  async getReportDetailsFromS3WithAccessCheck(reportId: string, userId: string): Promise<ReportDetails & { summary?: string }> {
    const hasAccess = await this.checkReportAccess(reportId, userId);
    if (!hasAccess) {
      throw new ForbiddenException('이 회의록에 접근할 권한이 없습니다');
    }

    return this.getReportDetailsFromS3(reportId);
  }

  /**
   * 사용자가 접근 가능한 회의록 목록 조회
   * - participantUserIds가 빈 배열이면 전체 공개 (채널 멤버면 접근 가능)
   * - participantUserIds가 있으면 해당 유저만 접근 가능
   */
  async getAccessibleReports(userId: string, channelId: string): Promise<RoomReport[]> {
    // 1. 사용자의 채널 멤버십 조회
    const membership = await this.channelMemberRepository.findOne({
      where: { userId, channelId }
    });

    if (!membership) {
      throw new ForbiddenException('채널 멤버가 아닙니다');
    }

    // 2. 접근 가능한 회의록 조회
    // participantUserIds가 빈 배열이거나, 사용자 ID가 포함된 경우
    const queryBuilder = this.reportsRepository
      .createQueryBuilder('report')
      .where('report.channelId = :channelId', { channelId })
      .andWhere(
        '(report.participantUserIds = :emptyArray OR :userId = ANY(report.participantUserIds))',
        {
          emptyArray: '{}',
          userId
        }
      );

    return queryBuilder
      .orderBy('report.createdAt', 'DESC')
      .getMany();
  }

  async findAllByUserId(userId: string): Promise<RoomReport[]> {
    const user = await this.userRepository.findOne({
      where: { userId },
      select: { userId: true, nickName: true },
    });
    if (!user) {
      return [];
    }

    // 1. 사용자가 참여한 모든 채널의 멤버십 조회
    const memberships = await this.channelMemberRepository.find({
      where: { userId },
      select: ['channelId', 'teamId']
    });

    if (memberships.length === 0) {
      return [];
    }

    // 2. 각 채널에서 접근 가능한 회의록 조회
    const allAccessibleReports: RoomReport[] = [];

    for (const membership of memberships) {
      const queryBuilder = this.reportsRepository
        .createQueryBuilder('report')
        .where('report.channelId = :channelId', { channelId: membership.channelId })
        .andWhere(':nickName = ANY(report.attendees)', { nickName: user.nickName })
        // participantUserIds 필터링: 빈 배열이거나 사용자 ID가 포함된 경우
        .andWhere(
          '(report.participantUserIds = :emptyArray OR :userId = ANY(report.participantUserIds))',
          {
            emptyArray: '{}',
            userId
          }
        );

      const reports = await queryBuilder.getMany();
      allAccessibleReports.push(...reports);
    }

    // 중복 제거 및 정렬
    const uniqueReports = Array.from(
      new Map(allAccessibleReports.map(r => [r.reportId, r])).values()
    );

    return uniqueReports.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
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
    roomId: string;
    reportId?: string;
    userId: string;
    topic: string;
    description?: string;
    attendees: string[];
    uploadFileList: FileInfo[];
    createdAt?: string;
    channelId: string;
  }): Promise<ReportDetails> {
    // reportId는 roomId와 동일하게 사용 (엔티티 설계 원칙)
    const reportId = payload.reportId || payload.roomId;
    const createdAt = payload.createdAt || new Date().toISOString();

    // Room에서 participantUserIds 가져오기 (회의록도 동일한 접근 제어 적용)
    let participantUserIds: string[] = [];
    const room = await this.roomRepository.findOne({
      where: { roomId: payload.roomId },
      select: ['roomId', 'participantUserIds']
    });
    if (room && room.participantUserIds) {
      participantUserIds = room.participantUserIds;
    }

    const meta = this.reportsRepository.create({
      reportId,
      roomId: payload.roomId,
      channelId: payload.channelId,
      topic: payload.topic,
      description: payload.description || null,
      attendees: payload.attendees,
      participantUserIds,  // Room에서 복사한 participantUserIds
      createdAt: new Date(createdAt),
    });
    await this.reportsRepository.save(meta);

    const details: ReportDetails = {
      reportId,
      roomId: payload.roomId,
      channelId: payload.channelId,
      topic: payload.topic,
      description: payload.description,
      attendees: payload.attendees,
      createdAt,
      shareScope: "CHANNEL",
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
    const markdownUrl = `https://${this.bucketName
      }.s3.${region}.amazonaws.com/${this.getReportMarkdownKey(
        details.reportId
      )}`;

    // 1. report.json 저장 (summaryUrl에 마크다운 파일 URL 저장)
    const jsonPayload = {
      ...details,
      summaryUrl: markdownUrl, // 마크다운 파일 경로 저장 (파일은 나중에 생성될 수 있음)
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
  ): Promise<{ success: boolean; summaryUrl: string }> {
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

    // report.md 파일에 summary 저장
    const mdKey = this.getReportMarkdownKey(reportId);
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: mdKey,
        Body: summary,
        ContentType: "text/markdown; charset=utf-8",
      })
    );

    // attendees가 변경되었으면 report.json과 DB 업데이트
    if (attendees.length > 0) {
      const updated: ReportDetails = {
        ...current,
        attendees,
      };
      await this.saveReportDetailsToS3(updated);
      await this.reportsRepository.update({ reportId }, { attendees });
    }

    const region = this.configService.get<string>("AWS_REGION", "ap-northeast-2");
    const summaryUrl = `https://${this.bucketName}.s3.${region}.amazonaws.com/${mdKey}`;

    return { success: true, summaryUrl };
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

    // room이 없으면 오류
    if (!room) {
      throw new NotFoundException(`Room not found: ${reportId}`);
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
      throw new NotFoundException(`Report not found: ${reportId}`);
    }

    const reportIds = await this.getAccessibleReportIds(
      user.userId,
      user.nickName
    );

    return reportIds;
  }

  async getReportDetailsFromS3(roomId: string): Promise<ReportDetails & { summary?: string }> {
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

        // summaryUrl이 있으면 마크다운 파일 내용 읽어오기 시도
        if (parsed.summaryUrl && parsed.summaryUrl.endsWith("report.md")) {
          try {
            const mdKey = this.getReportMarkdownKey(roomId);
            const mdCommand = new GetObjectCommand({
              Bucket: this.bucketName,
              Key: mdKey,
            });
            const mdResponse = await this.s3Client.send(mdCommand);
            // summary 필드에 마크다운 내용 추가
            parsed.summary = await mdResponse.Body.transformToString();
          } catch (mdErr) {
            this.logger.warn(
              `Markdown file not found for ${roomId}: ${mdErr.message}`
            );
            // 파일이 없으면 summary는 undefined로 유지
            parsed.summary = undefined;
          }
        }

        // shareScope 기본값 설정
        if (!parsed.shareScope) {
          parsed.shareScope = "CHANNEL";
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
  async deleteS3Folder(roomId: string): Promise<void> {
    const prefix = this.getReportFolderPrefix(roomId); // rooms/roomId/
    const deleted = await this.deleteS3FolderByPrefix(prefix);

    if (deleted > 0) {
      this.logger.log(`Deleted ${deleted} objects for roomId: ${roomId}`);
    } else {
      this.logger.warn(`No objects found for roomId: ${roomId}`);
    }
  }

  async deleteReport(reportId: string, userId: string) {
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
    if (!reportIds.includes(reportId)) {
      throw new ForbiddenException("Not allowed to delete this report");
    }

    // S3 폴더 삭제 (reportId 기준)
    try {
      await this.deleteS3Folder(reportId);
    } catch (error) {
      this.logger.warn(`Failed to delete S3 folder for ${reportId}: ${error}`);
    }

    // DB 레코드 삭제 (reportId로 삭제)
    await this.reportsRepository.delete({ reportId });

    return { deleted: true };
  }
}
