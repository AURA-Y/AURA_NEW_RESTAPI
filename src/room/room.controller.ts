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
import { RoomService } from "./room.service";
import { CreateRoomDto } from "./dto/create-room.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@Controller("rooms")
@UseGuards(JwtAuthGuard)
export class RoomController {
  constructor(private readonly roomService: RoomService) { }

  @Post()
  async createRoom(@Body() createRoomDto: CreateRoomDto, @Request() req) {
    return this.roomService.createRoom({
      ...createRoomDto,
      masterId: req.user.id,
    });
  }

  @Get()
  async getAllRooms() {
    return this.roomService.getAllRooms();
  }

  /**
   * 사용자가 접근 가능한 방 목록 조회
   * - 전체 공개 방 (teamIds가 빈 배열)
   * - 사용자의 팀이 포함된 방
   */
  @Get("accessible/:channelId")
  async getAccessibleRooms(
    @Param("channelId") channelId: string,
    @Request() req,
  ) {
    return this.roomService.getAccessibleRooms(req.user.id, channelId);
  }

  @Get("topic/:topic")
  async getRoomByTopic(@Param("topic") topic: string) {
    return this.roomService.getRoomByTopic(topic);
  }

  @Get("channel/:channelId")
  async getRoomsByChannel(@Param("channelId") channelId: string) {
    return this.roomService.getRoomsByChannelId(channelId);
  }

  @Get("team/:teamId")
  async getRoomsByTeam(@Param("teamId") teamId: string) {
    return this.roomService.getRoomsByTeamId(teamId);
  }

  /**
   * 사용자가 특정 방에 접근 가능한지 확인
   */
  @Get(":roomId/access")
  async checkRoomAccess(@Param("roomId") roomId: string, @Request() req) {
    const hasAccess = await this.roomService.checkRoomAccess(roomId, req.user.id);
    return { hasAccess };
  }

  @Get(":roomId")
  async getRoomById(@Param("roomId") roomId: string) {
    return this.roomService.getRoomById(roomId);
  }

  @Delete(":roomId")
  async deleteRoom(@Param("roomId") roomId: string, @Request() req) {
    await this.roomService.deleteRoom(roomId, req.user.id);
    return { message: "Room deleted successfully" };
  }

  @Post(":roomId/join")
  async joinRoom(@Param("roomId") roomId: string, @Request() req) {
    return this.roomService.addAttendee(roomId, req.user.nickName);
  }

  @Get(":roomId/role")
  async checkUserRole(@Param("roomId") roomId: string, @Request() req) {
    return this.roomService.checkUserRole(roomId, req.user.id);
  }

  @Post(":roomId/leave")
  async leaveRoom(@Param("roomId") roomId: string, @Request() req) {
    await this.roomService.leaveRoom(roomId, req.user.nickName);
    return { message: "Left room successfully" };
  }
}
