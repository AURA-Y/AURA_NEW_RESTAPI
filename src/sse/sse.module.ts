import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SseController } from './sse.controller';
import { SseService } from './sse.service';
import { User } from '../auth/entities/user.entity';
import { Room } from '../room/entities/room.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, Room])],
  controllers: [SseController],
  providers: [SseService],
  exports: [SseService],
})
export class SseModule {}
