import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  S3Client,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

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
   * S3에서 특정 회의실의 녹화 파일 목록 조회
   * @param roomId 회의실 ID
   * @returns 녹화 파일 목록
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
      const recordings: RecordingInfo[] = contents
        .filter((item) => {
          const key = item.Key || "";
          return key.endsWith(".webm") || key.endsWith(".mp4");
        })
        .map((item) => {
          const key = item.Key || "";
          const fileName = key.split("/").pop() || "";
          const fileUrl = `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${key}`;

          return {
            fileName,
            fileUrl,
            size: item.Size || 0,
            createdAt: item.LastModified?.toISOString() || "",
          };
        })
        .sort((a, b) => {
          // 최신순 정렬
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });

      this.logger.log(`[녹화 목록] ${recordings.length}개 파일 발견`);

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
