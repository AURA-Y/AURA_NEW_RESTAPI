import path from 'node:path';
import { defineConfig } from 'prisma/config';
import { config } from 'dotenv';

// .env 파일 로드
config({ path: path.resolve(__dirname, '.env') });

export default defineConfig({
  schema: path.resolve(__dirname, 'prisma/schema.prisma'),

  // 데이터베이스 URL (모든 CLI 명령에서 사용)
  datasource: {
    url: process.env.DATABASE_URL!,
  },
});
