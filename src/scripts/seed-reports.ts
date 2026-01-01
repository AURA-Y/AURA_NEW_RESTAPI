import { DataSource } from 'typeorm';
import { RoomReport } from '../room/entities/room-report.entity';
import * as dotenv from 'dotenv';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

dotenv.config();

const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'aura',
  entities: [RoomReport],
  synchronize: false,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

// S3 클라이언트 설정
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-northeast-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const BUCKET_NAME = 'aura-raw-data-bucket';

// 메타데이터만 DB에 저장
const reportMetadata = {
  topic: '2024년 1분기 AI 프로젝트 기획 회의',
  attendees: ['신지웅', '홍길동', '김철수', '이영희'],
};

// S3에 저장할 상세 데이터
const reportDetails = {
  summary: 'AI 기반 음성 대화 플랫폼 AURA 개발 계획을 수립했습니다. 주요 논의사항으로는 실시간 음성 인식 및 번역 기능, 다자간 화상 회의 지원, 회의록 자동 생성 기능 등이 있었습니다.',
  uploadFileList: [
    {
      fileId: 'file-1767270836271-fhpdcb0wp',
      fileName: 'namanmoo.pptx',
      fileUrl: 'https://aura-raw-data-bucket.s3.ap-northeast-2.amazonaws.com/meetings/2024/01/namanmoo.pptx',
      fileSize: 3219972,
      fileType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    },
    {
      fileId: 'file-1767270836623-kd0613ezk',
      fileName: 'IMG_1499.jpg',
      fileUrl: 'https://aura-raw-data-bucket.s3.ap-northeast-2.amazonaws.com/meetings/2024/01/IMG_1499.jpg',
      fileSize: 3962702,
      fileType: 'image/jpeg',
    },
  ],
};

async function seed() {
  try {
    await AppDataSource.initialize();
    const reportRepo = AppDataSource.getRepository(RoomReport);

    // 1. PostgreSQL에 메타데이터 저장
    const report = reportRepo.create(reportMetadata);
    const saved = await reportRepo.save(report);
    console.log(`✅ Report metadata created in DB: ${saved.reportId} - ${saved.topic}`);

    // 2. S3에 상세 데이터 저장
    const s3Key = `reports/${saved.reportId}.json`;
    const detailsWithMeta = {
      reportId: saved.reportId,
      createdAt: saved.createdAt,
      topic: saved.topic,
      attendees: saved.attendees,
      ...reportDetails,
    };

    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: JSON.stringify(detailsWithMeta, null, 2),
        ContentType: 'application/json',
      })
    );
    console.log(`✅ Report details uploaded to S3: s3://${BUCKET_NAME}/${s3Key}`);

    console.log('\n📋 리포트 정보:');
    console.log(`   - Report ID: ${saved.reportId}`);
    console.log(`   - 생성일시: ${saved.createdAt}`);
    console.log(`   - 주제: ${saved.topic}`);
    console.log(`   - 참석자: ${saved.attendees.join(', ')}`);

    await AppDataSource.destroy();
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

seed();
