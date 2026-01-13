import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface RecordingInfo {
  fileName: string;
  fileUrl: string;
  size: number;
  createdAt: string;
}

@Injectable()
export class RecordingsService {
  private s3Client: S3Client;
  private readonly bucketName: string;
  private readonly uploadPrefix: string;
  private readonly region: string;
  private readonly logger = new Logger(RecordingsService.name);

  constructor(private configService: ConfigService) {
    this.bucketName =
      this.configService.get<string>("AURA_S3_BUCKET") ||
      this.configService.get<string>("AWS_BUCKET") ||
      "aura-raw-data-bucket";
    this.uploadPrefix =
      this.configService.get<string>("AURA_S3_PREFIX") || "rooms/";
    this.region = this.configService.get<string>("AWS_REGION", "ap-northeast-2");

    this.s3Client = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: this.configService.get<string>("AWS_ACCESS_KEY_ID_S3"),
        secretAccessKey: this.configService.get<string>(
          "AWS_SECRET_ACCESS_KEY_S3"
        ),
      },
    });
  }

  /**
   * S3 Pre-signed URL 생성
   * @param key S3 객체 키
   * @returns Pre-signed URL (1시간 유효)
   */
  private async getPresignedUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });
    
    // 1시간 유효한 URL 생성
    return getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
  }

  /**
   * S3에서 특정 회의실의 녹화 파일 목록 조회
   * @param roomId 회의실 ID
   * @returns 녹화 파일 목록 (Pre-signed URL 포함)
   */
  async listRecordings(roomId: string): Promise<{
    success: boolean;
    roomId: string;
    recordings: RecordingInfo[];
    total: number;
  }> {
    const prefix = `${this.uploadPrefix}${roomId}/recordings/`;
    this.logger.log(`[녹화 목록] roomId: ${roomId}, prefix: ${prefix}`);

    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
      });

      const response = await this.s3Client.send(command);
      const contents = response.Contents || [];

      // 녹화 파일만 필터링 (.webm, .mp4)
      const filteredContents = contents.filter((item) => {
        const key = item.Key || "";
        return key.endsWith(".webm") || key.endsWith(".mp4");
      });

      // Pre-signed URL을 병렬로 생성
      const recordings: RecordingInfo[] = await Promise.all(
        filteredContents.map(async (item) => {
          const key = item.Key || "";
          const fileName = key.split("/").pop() || "";
          const fileUrl = await this.getPresignedUrl(key);

          return {
            fileName,
            fileUrl,
            size: item.Size || 0,
            createdAt: item.LastModified?.toISOString() || "",
          };
        })
      );

      // 최신순 정렬
      recordings.sort((a, b) => {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      this.logger.log(`[녹화 목록] ${recordings.length}개 파일 발견 (Pre-signed URL 생성 완료)`);

      return {
        success: true,
        roomId,
        recordings,
        total: recordings.length,
      };
    } catch (error) {
      this.logger.error(`[녹화 목록 조회 실패] ${error.message}`);
      return {
        success: false,
        roomId,
        recordings: [],
        total: 0,
      };
    }
  }
}

