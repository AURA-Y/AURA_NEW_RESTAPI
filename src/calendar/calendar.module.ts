import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { User } from '../auth/entities/user.entity';
import { Room } from '../room/entities/room.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, Room])],
  controllers: [CalendarController],
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}
