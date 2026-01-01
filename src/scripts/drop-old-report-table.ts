import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'admin',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'aura_db',
  synchronize: false,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function dropOldTable() {
  try {
    await AppDataSource.initialize();

    // Drop the old 'report' table if it exists
    await AppDataSource.query('DROP TABLE IF EXISTS report CASCADE');
    console.log('✅ Old "report" table dropped successfully');

    await AppDataSource.destroy();
  } catch (error) {
    console.error('❌ Failed to drop table:', error);
    process.exit(1);
  }
}

dropOldTable();
