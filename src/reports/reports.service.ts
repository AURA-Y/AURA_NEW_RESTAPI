import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, In } from "typeorm";
import { RoomReport } from "../room/entities/room-report.entity";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class ReportsService {
  private s3Client: S3Client;
  private readonly bucketName = "aura-raw-data-bucket";

  constructor(
    @InjectRepository(RoomReport)
    private reportsRepository: Repository<RoomReport>,
    private configService: ConfigService
  ) {
    this.s3Client = new S3Client({
      region: this.configService.get<string>("AWS_REGION", "ap-northeast-2"),
      credentials: {
        accessKeyId: this.configService.get<string>("AWS_ACCESS_KEY_ID"),
        secretAccessKey: this.configService.get<string>(
          "AWS_SECRET_ACCESS_KEY"
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

  // 리포트 생성
  async create(reportData: Partial<RoomReport>): Promise<RoomReport> {
    const report = this.reportsRepository.create(reportData);
    return this.reportsRepository.save(report);
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
      // S3 URL 파싱: https://bucket-name.s3.region.amazonaws.com/path/to/file
      const url = new URL(fileUrl);
      const pathParts = url.pathname.split("/").filter((p) => p);
      const s3Key = pathParts.join("/"); // 전체 경로를 key로 사용
      const fileName = pathParts[pathParts.length - 1]; // 파일명 추출

      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
      });

      const response = await this.s3Client.send(command);

      // Content-Type 결정
      const contentType = response.ContentType || "application/octet-stream";

      return {
        stream: response.Body,
        fileName,
        contentType,
      };
    } catch (error) {
      throw new NotFoundException(`File not found in S3: ${fileUrl}`);
    }
  }
}
