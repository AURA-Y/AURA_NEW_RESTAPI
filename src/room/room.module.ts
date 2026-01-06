import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { RoomController } from "./room.controller";
import { RoomService } from "./room.service";
import { Room } from "./entities/room.entity";

import { SystemRoomController } from "./system-room.controller";

@Module({
  imports: [TypeOrmModule.forFeature([Room])],
  controllers: [RoomController, SystemRoomController],
  providers: [RoomService],
  exports: [RoomService],
})
export class RoomModule {}
