import { Controller, Delete, Param, Get } from "@nestjs/common";
import { RoomService } from "./room.service";

@Controller("system/rooms")
export class SystemRoomController {
  constructor(private readonly roomService: RoomService) {}

  @Get("topic/:topic")
  async getRoomByTopic(@Param("topic") topic: string) {
    console.log(`[System] Received topic lookup for: ${topic}`);
    return this.roomService.getRoomByTopic(topic);
  }

  @Delete(":roomId")
  async forceDeleteRoom(@Param("roomId") roomId: string) {
    console.log(`[System] Received force delete request for room: ${roomId}`);
    await this.roomService.forceDeleteRoom(roomId);
    return { message: "Room force deleted successfully" };
  }
}
