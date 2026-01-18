import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    const isSslEnabled =
      connectionString && connectionString.includes('sslmode=require');

    const poolConfig: any = {
      connectionString,
    };

    // AWS RDS 등에서 Self-Signed Cert 사용 시 검증 무시 설정
    if (isSslEnabled) {
      poolConfig.ssl = {
        rejectUnauthorized: false,
      };
    }

    const pool = new Pool(poolConfig);
    const adapter = new PrismaPg(pool);

    super({ adapter });

    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }
}
