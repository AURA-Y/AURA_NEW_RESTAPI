import { DataSource } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import * as dotenv from 'dotenv';

dotenv.config();

const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'admin',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'aura_db',
  entities: [User],
  synchronize: false,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

const USER_ID = '2d9bb943-6f77-4b94-ab06-e54ed48ca1f5';
const REPORT_ID = '6062716e-1e3a-4a8b-892c-514b546f47d4';

async function updateUser() {
  try {
    await AppDataSource.initialize();
    const userRepo = AppDataSource.getRepository(User);

    const user = await userRepo.findOne({ where: { userId: USER_ID } });

    if (!user) {
      console.error(`❌ User not found: ${USER_ID}`);
      await AppDataSource.destroy();
      return;
    }

    console.log(`Found user: ${user.nickName} (${user.email})`);
    console.log(`Current roomReportIdxList: ${user.roomReportIdxList}`);

    // 기존 리스트에서 중복 제거 후 새 리포트 추가
    const existingReports = user.roomReportIdxList || [];
    const reportSet = new Set([...existingReports, REPORT_ID]);
    user.roomReportIdxList = Array.from(reportSet);

    await userRepo.save(user);

    console.log(`✅ Updated roomReportIdxList: ${user.roomReportIdxList}`);

    await AppDataSource.destroy();
  } catch (error) {
    console.error('❌ Update failed:', error);
    process.exit(1);
  }
}

updateUser();
