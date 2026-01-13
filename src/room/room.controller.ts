import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
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

  // 정적 경로들 먼저 (topic, channel, team)
  @Get("topic/:topic")
  async getRoomByTopic(@Param("topic") topic: string) {
    return this.roomService.getRoomByTopic(topic);
  }

  @Get("channel/:channelId/search")
  async searchRooms(
    @Param("channelId") channelId: string,
    @Query("keyword") keyword?: string,
    @Query("tags") tags?: string | string[],
  ) {
    // tags는 단일 문자열 또는 배열로 올 수 있음
    const tagArray = tags
      ? (Array.isArray(tags) ? tags : [tags])
      : [];
    return this.roomService.searchRooms(channelId, keyword, tagArray);
  }

  @Get("channel/:channelId/tags")
  async getChannelTags(@Param("channelId") channelId: string) {
    const tags = await this.roomService.getTagsByChannel(channelId);
    return { tags };
  }

  @Get("channel/:channelId")
  async getRoomsByChannel(@Param("channelId") channelId: string) {
    return this.roomService.getRoomsByChannelId(channelId);
  }

  @Get("team/:teamId")
  async getRoomsByTeam(@Param("teamId") teamId: string) {
    return this.roomService.getRoomsByTeamId(teamId);
  }

  // 동적 :roomId 경로들 (정적 경로 이후에 배치)
  @Get(":roomId/role")
  async checkUserRole(@Param("roomId") roomId: string, @Request() req) {
    return this.roomService.checkUserRole(roomId, req.user.id);
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

  @Post(":roomId/leave")
  async leaveRoom(@Param("roomId") roomId: string, @Request() req) {
    await this.roomService.leaveRoom(roomId, req.user.nickName);
    return { message: "Left room successfully" };
  }
}
