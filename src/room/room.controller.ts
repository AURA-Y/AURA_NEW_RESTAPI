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
import { JwtOrServiceKeyGuard } from "../auth/guards/jwt-or-service-key.guard";
import { SseService } from "../sse/sse.service";

@Controller("rooms")
@UseGuards(JwtAuthGuard)
export class RoomController {
  constructor(
    private readonly roomService: RoomService,
    private readonly sseService: SseService,
  ) { }

  @Post()
  async createRoom(@Body() createRoomDto: CreateRoomDto, @Request() req) {
    const room = await this.roomService.createRoom({
      ...createRoomDto,
      masterId: req.user.id,
    });

    // 회의 생성 알림 (participantUserIds에 포함된 유저들에게, 생성자 제외)
    if (createRoomDto.participantUserIds && createRoomDto.participantUserIds.length > 0) {
      this.sseService.handleMeetingCreated({
        roomId: room.roomId,
        roomTopic: room.roomTopic,
        channelId: room.channelId,
        masterId: req.user.id,
        masterNickName: req.user.nickName,
        participantUserIds: createRoomDto.participantUserIds,
      }).catch(err => console.error('[Room] SSE 알림 전송 실패:', err.message));
    }

    // Slack 초대 알림 전송 (웹훅 설정된 채널만)
    if (room.channelId) {
      this.roomService.sendSlackMeetingInvite({
        channelId: room.channelId,
        roomId: room.roomId,
        roomTopic: room.roomTopic,
        masterNickName: req.user.nickName,
      }).catch(err => console.error('[Room] Slack 알림 전송 실패:', err.message));
    }

    return room;
  }

  @Get()
  async getAllRooms() {
    return this.roomService.getAllRooms();
  }

  /**
   * 사용자가 접근 가능한 방 목록 조회 (페이지네이션 지원)
   * - 전체 공개 방 (participantUserIds가 빈 배열)
   * - 사용자 ID가 포함된 방
   * @query page - 페이지 번호 (기본값: 1)
   * @query limit - 페이지당 항목 수 (기본값: 6)
   */
  @Get("accessible/:channelId")
  async getAccessibleRooms(
    @Param("channelId") channelId: string,
    @Request() req,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 6;
    return this.roomService.getAccessibleRooms(req.user.id, channelId, pageNum, limitNum);
  }

  // 정적 경로들 먼저 (topic, channel, team)
  // JWT 또는 서비스 키 인증 허용 (LiveKit 서버 내부 호출용)
  @Get("topic/:topic")
  @UseGuards(JwtOrServiceKeyGuard)
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
