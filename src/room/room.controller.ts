import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
} from "@nestjs/common";
import { RoomService, CreateRoomDto } from "./room.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@Controller("rooms")
@UseGuards(JwtAuthGuard)
export class RoomController {
  constructor(private readonly roomService: RoomService) {}

  @Post()
  async createRoom(@Body() createRoomDto: CreateRoomDto, @Request() req) {
    return this.roomService.createRoom({
      ...createRoomDto,
      master: req.user.id,
    });
  }

  @Get()
  async getAllRooms() {
    return this.roomService.getAllRooms();
  }

  @Get(":roomId")
  async getRoomById(@Param("roomId") roomId: string) {
    return this.roomService.getRoomById(roomId);
  }

  @Get("topic/:topic")
  async getRoomByTopic(@Param("topic") topic: string) {
    return this.roomService.getRoomByTopic(topic);
  }

  @Delete(":roomId")
  async deleteRoom(@Param("roomId") roomId: string, @Request() req) {
    await this.roomService.deleteRoom(roomId, req.user.id);
    return { message: "Room deleted successfully" };
  }

  @Post(":roomId/join")
  async joinRoom(@Param("roomId") roomId: string, @Request() req) {
    // userId 대신 nickname을 저장
    return this.roomService.addAttendee(roomId, req.user.username);
  }

  @Get(":roomId/role")
  async checkUserRole(@Param("roomId") roomId: string, @Request() req) {
    return this.roomService.checkUserRole(roomId, req.user.id);
  }
  @Post(":roomId/leave")
  async leaveRoom(@Param("roomId") roomId: string, @Request() req) {
    await this.roomService.leaveRoom(roomId, req.user.username);
    return { message: "Left room successfully" };
  }
}
