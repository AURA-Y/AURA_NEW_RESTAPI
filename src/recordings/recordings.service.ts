import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * 비디오 챕터 (구간 표시)
 */
export interface VideoChapter {
  title: string;
  startTime: number; // 초 단위
  endTime?: number;
}

/**
 * 녹화 메타데이터 (S3에 JSON으로 저장)
 */
export interface RecordingMetadata {
  roomId: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  duration?: number;
  recordingStartTime?: number; // 녹화 시작 시간 (밀리초 타임스탬프)
  chapters?: VideoChapter[];
  createdAt: string;
  updatedAt: string;
}

export interface RecordingInfo {
  fileName: string;
  fileUrl: string;
  size: number;
  createdAt: string;
  // 확장 필드 (메타데이터에서 가져옴)
  duration?: number;
  recordingStartTime?: number; // 녹화 시작 시간 (밀리초 타임스탬프)
  chapters?: VideoChapter[];
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
   * 녹화 메타데이터 조회 (S3에서 .meta.json 파일)
   * @param roomId 회의실 ID
   * @param fileName 녹화 파일명
   */
  private async getRecordingMetadata(
    roomId: string,
    fileName: string
  ): Promise<RecordingMetadata | null> {
    const metaKey = `${this.uploadPrefix}${roomId}/recordings/${fileName}.meta.json`;

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: metaKey,
      });

      const response = await this.s3Client.send(command);
      const bodyString = await response.Body?.transformToString();

      if (!bodyString) return null;

      return JSON.parse(bodyString) as RecordingMetadata;
    } catch (error) {
      // NoSuchKey 에러는 메타데이터가 없는 경우 (정상)
      if (error.name !== "NoSuchKey") {
        this.logger.debug(`[메타데이터 조회] ${fileName}: ${error.message}`);
      }
      return null;
    }
  }

  /**
   * S3에서 특정 회의실의 녹화 파일 목록 조회
   * @param roomId 회의실 ID
   * @returns 녹화 파일 목록 (Pre-signed URL 및 챕터 정보 포함)
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

      // Pre-signed URL과 메타데이터를 병렬로 조회
      const recordings: RecordingInfo[] = await Promise.all(
        filteredContents.map(async (item) => {
          const key = item.Key || "";
          const fileName = key.split("/").pop() || "";

          // Pre-signed URL과 메타데이터를 병렬로 조회
          const [fileUrl, metadata] = await Promise.all([
            this.getPresignedUrl(key),
            this.getRecordingMetadata(roomId, fileName),
          ]);

          return {
            fileName,
            fileUrl,
            size: item.Size || 0,
            createdAt: item.LastModified?.toISOString() || "",
            // 메타데이터에서 추가 정보 가져오기
            duration: metadata?.duration,
            recordingStartTime: metadata?.recordingStartTime,
            chapters: metadata?.chapters,
          };
        })
      );

      // 최신순 정렬
      recordings.sort((a, b) => {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      this.logger.log(`[녹화 목록] ${recordings.length}개 파일 발견 (Pre-signed URL 및 메타데이터 조회 완료)`);

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

