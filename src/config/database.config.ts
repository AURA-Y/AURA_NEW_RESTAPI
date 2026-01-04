import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity';
import { Room } from '../room/entities/room.entity';
import { RoomReport } from '../room/entities/room-report.entity';

export const databaseConfig: TypeOrmModuleOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'aura',
  entities: [User, Room, RoomReport],
  synchronize: process.env.NODE_ENV !== 'production', // auto-sync in dev, disable in production
  logging: process.env.NODE_ENV !== 'production',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
};
