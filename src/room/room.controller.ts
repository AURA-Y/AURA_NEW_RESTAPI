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
export class RoomController {
  constructor(private readonly roomService: RoomService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async createRoom(@Body() createRoomDto: CreateRoomDto, @Request() req) {
    return this.roomService.createRoom({
      ...createRoomDto,
      master: req.user.id,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  async getAllRooms() {
    return this.roomService.getAllRooms();
  }

  @UseGuards(JwtAuthGuard)
  @Get(":roomId")
  async getRoomById(@Param("roomId") roomId: string) {
    return this.roomService.getRoomById(roomId);
  }

  // 공개: topic으로 roomId 조회 (JWT 필요 없음)
  @Get("topic/:topic")
  async getRoomByTopic(@Param("topic") topic: string) {
    return this.roomService.getRoomByTopic(topic);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(":roomId")
  async deleteRoom(@Param("roomId") roomId: string, @Request() req) {
    await this.roomService.deleteRoom(roomId, req.user.id);
    return { message: "Room deleted successfully" };
  }

  @UseGuards(JwtAuthGuard)
  @Post(":roomId/join")
  async joinRoom(@Param("roomId") roomId: string, @Request() req) {
    // userId 대신 nickname만 사용
    return this.roomService.addAttendee(roomId, req.user.username);
  }

  @UseGuards(JwtAuthGuard)
  @Get(":roomId/role")
  async checkUserRole(@Param("roomId") roomId: string, @Request() req) {
    return this.roomService.checkUserRole(roomId, req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(":roomId/leave")
  async leaveRoom(@Param("roomId") roomId: string, @Request() req) {
    await this.roomService.leaveRoom(roomId, req.user.username);
    return { message: "Left room successfully" };
  }
}
