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

  /**
   * 사용자가 접근 가능한 방 목록 조회
   * - 전체 공개 방 (participantUserIds가 빈 배열)
   * - 사용자 ID가 포함된 방
   */
  @Get("accessible/:channelId")
  async getAccessibleRooms(
    @Param("channelId") channelId: string,
    @Request() req,
  ) {
    return this.roomService.getAccessibleRooms(req.user.id, channelId);
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

  /**
   * 사용자가 특정 방에 접근 가능한지 확인
   */
  @Get(":roomId/access")
  async checkRoomAccess(@Param("roomId") roomId: string, @Request() req) {
    const hasAccess = await this.roomService.checkRoomAccess(roomId, req.user.id);
    return { hasAccess };
  }

  @Get(":roomId")
  async getRoomById(@Param("roomId") roomId: string, @Request() req) {
    return this.roomService.getRoomByIdWithAccessCheck(roomId, req.user.id);
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
    return this.roomService.addAttendeeWithAccessCheck(roomId, req.user.id, req.user.nickName);
  }

  @Post(":roomId/leave")
  async leaveRoom(@Param("roomId") roomId: string, @Request() req) {
    await this.roomService.leaveRoom(roomId, req.user.nickName);
    return { message: "Left room successfully" };
  }
}
