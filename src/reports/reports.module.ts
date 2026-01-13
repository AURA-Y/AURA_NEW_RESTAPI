import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ReportsService } from "./reports.service";
import { ReportsController } from "./reports.controller";
import { RoomReport } from "../room/entities/room-report.entity";
import { Room } from "../room/entities/room.entity";
import { User } from "../auth/entities/user.entity";
import { ChannelMember } from "../channel/entities/channel-member.entity";

@Module({
  imports: [TypeOrmModule.forFeature([RoomReport, Room, User, ChannelMember])],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
