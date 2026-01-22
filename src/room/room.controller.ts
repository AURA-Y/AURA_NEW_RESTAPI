import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  Logger,
} from "@nestjs/common";
import { RoomService } from "./room.service";
import { CreateRoomDto } from "./dto/create-room.dto";
import { ScheduleRoomDto } from "./dto/schedule-room.dto";
import { UpdateScheduleRoomDto } from "./dto/update-schedule-room.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { JwtOrServiceKeyGuard } from "../auth/guards/jwt-or-service-key.guard";
import { SseService } from "../sse/sse.service";
import { CalendarService } from "../calendar/calendar.service";
import { SchedulerService, RoomNotificationJobs } from "../scheduler/scheduler.service";

@Controller("rooms")
@UseGuards(JwtAuthGuard)
export class RoomController {
  private readonly logger = new Logger(RoomController.name);

  constructor(
    private readonly roomService: RoomService,
    private readonly sseService: SseService,
    private readonly calendarService: CalendarService,
    private readonly schedulerService: SchedulerService,
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

  /**
   * 회의 예약 생성
   * 시작 시간이 현재 + 5분 이후인 경우 사용
   */
  @Post("schedule")
  async scheduleRoom(@Body() scheduleRoomDto: ScheduleRoomDto, @Request() req) {
    // 1. 예약 회의 DB 저장 (status: SCHEDULED)
    const room = await this.roomService.createScheduledRoom({
      ...scheduleRoomDto,
      masterId: req.user.id,
    });

    const scheduledAt = new Date(scheduleRoomDto.scheduledAt);
    const delay = scheduledAt.getTime() - Date.now();

    this.logger.log(`[회의 예약] roomId: ${room.roomId}, scheduledAt: ${scheduledAt.toISOString()}, delay: ${delay}ms`);

    // 2. Google Calendar 이벤트 생성 (Phase 2)
    let calendarEventId: string | undefined;
    let calendarResults: { userId: string; success: boolean; eventId?: string; error?: string }[] = [];

    try {
      // 회의 링크 URL 생성
      const meetingUrl = `https://aura.ai.kr/room/${room.roomId}`;

      // 날짜와 시간 분리 (ISO 8601 형식에서 추출)
      const dateStr = scheduledAt.toISOString().split('T')[0]; // YYYY-MM-DD
      const timeStr = scheduledAt.toTimeString().slice(0, 5);  // HH:mm

      // 참석자 이메일 목록 조회 (expectedAttendees에서 추출)
      const attendeeEmails = scheduleRoomDto.expectedAttendees?.map(a => a.userId) || [];

      // 캘린더 이벤트 설명에 회의 링크 포함
      const eventDescription = `AURA 회의 예약\n\n` +
        `회의 주제: ${room.roomTopic}\n` +
        `주최자: ${req.user.nickName}\n\n` +
        `회의 참여 링크: ${meetingUrl}\n\n` +
        `예정 참여자: ${scheduleRoomDto.expectedAttendees?.map(a => a.nickName).join(', ') || '전체'}`;

      // Room 참여자들의 개인 캘린더에 일정 추가
      calendarResults = await this.calendarService.addEventToRoomParticipants(
        room.roomId,
        {
          title: `[AURA] ${room.roomTopic}`,
          date: dateStr,
          time: timeStr,
          description: eventDescription,
          durationMinutes: scheduleRoomDto.duration || 60,
          attendees: attendeeEmails,
        }
      );

      // 첫 번째 성공한 이벤트 ID 저장 (대표 이벤트 ID)
      const firstSuccess = calendarResults.find(r => r.success && r.eventId);
      if (firstSuccess) {
        calendarEventId = firstSuccess.eventId;
        await this.roomService.updateSchedulingInfo(room.roomId, { calendarEventId });
      }

      const successCount = calendarResults.filter(r => r.success).length;
      const failCount = calendarResults.filter(r => !r.success).length;
      this.logger.log(`[Google Calendar] 이벤트 생성: ${successCount}명 성공, ${failCount}명 실패`);
    } catch (error) {
      this.logger.warn(`[Google Calendar] 이벤트 생성 실패 (계속 진행): ${error.message}`);
    }

    // 3. 회의 예약 알림 (participantUserIds에 포함된 유저들에게)
    if (scheduleRoomDto.participantUserIds && scheduleRoomDto.participantUserIds.length > 0) {
      this.sseService.handleMeetingScheduled?.({
        roomId: room.roomId,
        roomTopic: room.roomTopic,
        channelId: room.channelId,
        masterId: req.user.id,
        masterNickName: req.user.nickName,
        participantUserIds: scheduleRoomDto.participantUserIds,
        scheduledAt: scheduleRoomDto.scheduledAt,
      }).catch(err => console.error('[Room] SSE 예약 알림 전송 실패:', err.message));
    }

    // 4. Slack 예약 알림 전송
    if (room.channelId) {
      this.roomService.sendSlackMeetingInvite({
        channelId: room.channelId,
        roomId: room.roomId,
        roomTopic: room.roomTopic,
        masterNickName: req.user.nickName,
        scheduledAt: new Date(scheduleRoomDto.scheduledAt),
      }).catch(err => console.error('[Room] Slack 예약 알림 전송 실패:', err.message));
    }

    // 5. 알림 스케줄링 (Phase 3: 30분 전, 5분 전, 시작 시점)
    let notificationJobs: RoomNotificationJobs = {};
    try {
      const notificationPayload = {
        roomId: room.roomId,
        roomTopic: room.roomTopic,
        channelId: room.channelId,
        masterId: req.user.id,
        masterNickName: req.user.nickName,
        participantUserIds: scheduleRoomDto.participantUserIds || [],
        scheduledAt: scheduleRoomDto.scheduledAt,
      };

      notificationJobs = await this.schedulerService.scheduleRoomNotifications(
        room.roomId,
        scheduledAt,
        {
          // 30분 전 리마인더
          onReminder30min: async () => {
            await this.sseService.handleMeetingReminder({
              ...notificationPayload,
              minutesBefore: 30,
            });
            this.logger.log(`[알림] 30분 전 리마인더 전송: ${room.roomId}`);
          },
          // 5분 전 리마인더
          onReminder5min: async () => {
            await this.sseService.handleMeetingReminder({
              ...notificationPayload,
              minutesBefore: 5,
            });
            this.logger.log(`[알림] 5분 전 리마인더 전송: ${room.roomId}`);
          },
          // 회의 시작 알림
          onStart: async () => {
            // 회의 상태를 ACTIVE로 변경
            await this.roomService.updateRoomStatus(room.roomId, 'ACTIVE');
            // 시작 알림 전송
            await this.sseService.handleMeetingStarted({
              roomId: room.roomId,
              roomTopic: room.roomTopic,
              channelId: room.channelId,
              masterId: req.user.id,
              masterNickName: req.user.nickName,
              participantUserIds: scheduleRoomDto.participantUserIds || [],
            });
            this.logger.log(`[알림] 회의 시작 알림 전송: ${room.roomId}`);

            // 반복 회의인 경우 다음 회의 자동 생성
            if (scheduleRoomDto.recurrenceRule && scheduleRoomDto.recurrenceRule !== 'NONE') {
              try {
                const currentRoom = await this.roomService.getRoomById(room.roomId);
                const nextRoom = await this.roomService.createNextRecurringRoom(currentRoom);

                if (nextRoom) {
                  // 다음 회의 알림 스케줄링
                  const nextScheduledAt = new Date(nextRoom.scheduledAt);
                  await this.schedulerService.scheduleRoomNotifications(
                    nextRoom.roomId,
                    nextScheduledAt,
                    {
                      onReminder30min: async () => {
                        await this.sseService.handleMeetingReminder({
                          roomId: nextRoom.roomId,
                          roomTopic: nextRoom.roomTopic,
                          channelId: nextRoom.channelId,
                          masterId: req.user.id,
                          masterNickName: req.user.nickName,
                          participantUserIds: nextRoom.participantUserIds || [],
                          scheduledAt: nextRoom.scheduledAt.toISOString(),
                          minutesBefore: 30,
                        });
                      },
                      onReminder5min: async () => {
                        await this.sseService.handleMeetingReminder({
                          roomId: nextRoom.roomId,
                          roomTopic: nextRoom.roomTopic,
                          channelId: nextRoom.channelId,
                          masterId: req.user.id,
                          masterNickName: req.user.nickName,
                          participantUserIds: nextRoom.participantUserIds || [],
                          scheduledAt: nextRoom.scheduledAt.toISOString(),
                          minutesBefore: 5,
                        });
                      },
                      onStart: async () => {
                        // 재귀적으로 다음 회의 생성됨
                        await this.roomService.updateRoomStatus(nextRoom.roomId, 'ACTIVE');
                        await this.sseService.handleMeetingStarted({
                          roomId: nextRoom.roomId,
                          roomTopic: nextRoom.roomTopic,
                          channelId: nextRoom.channelId,
                          masterId: req.user.id,
                          masterNickName: req.user.nickName,
                          participantUserIds: nextRoom.participantUserIds || [],
                        });
                        // 다음 반복 회의 생성 (재귀)
                        const futureRoom = await this.roomService.createNextRecurringRoom(nextRoom);
                        if (futureRoom) {
                          this.logger.log(`[반복 회의] 다음 회의 예약됨: ${futureRoom.roomId}`);
                        }
                      },
                    }
                  );
                  this.logger.log(`[반복 회의] 다음 회의 알림 스케줄링 완료: ${nextRoom.roomId}`);
                }
              } catch (error) {
                this.logger.error(`[반복 회의] 다음 회의 생성 실패: ${error.message}`);
              }
            }
          },
        }
      );

      this.logger.log(`[알림 스케줄링] roomId: ${room.roomId}, jobs: ${JSON.stringify(notificationJobs)}`);
    } catch (error) {
      this.logger.warn(`[알림 스케줄링] 실패 (계속 진행): ${error.message}`);
    }

    return {
      roomId: room.roomId,
      roomTopic: room.roomTopic,
      scheduledAt: room.scheduledAt,
      duration: room.duration,
      status: room.status,
      roomShareLink: room.roomShareLink,
      calendarEventId,
      calendarResults: calendarResults.length > 0 ? {
        success: calendarResults.filter(r => r.success).length,
        failed: calendarResults.filter(r => !r.success).length,
      } : undefined,
      notificationJobs: Object.keys(notificationJobs).length > 0 ? notificationJobs : undefined,
      // 반복 예약 정보
      recurrenceRule: room.recurrenceRule,
      recurrenceEndDate: room.recurrenceEndDate,
    };
  }

  /**
   * 예약된 회의 목록 조회
   */
  @Get("scheduled")
  async getScheduledRooms(
    @Request() req,
    @Query("channelId") channelId?: string,
  ) {
    return this.roomService.getScheduledRooms(req.user.id, channelId);
  }

  /**
   * 예약 취소
   */
  @Post(":roomId/cancel")
  async cancelScheduledRoom(@Param("roomId") roomId: string, @Request() req) {
    // 먼저 방 정보 조회 (calendarEventId 확인용)
    const roomInfo = await this.roomService.getRoomById(roomId);
    const calendarEventId = roomInfo.calendarEventId;

    // 예약 취소 (status → CANCELLED)
    const room = await this.roomService.cancelScheduledRoom(roomId, req.user.id);

    // 알림 Job 취소 (Phase 3)
    let notificationsCancelled = 0;
    try {
      const cancelResult = await this.schedulerService.cancelRoomNotifications(roomId);
      notificationsCancelled = cancelResult.cancelled.length;
      this.logger.log(`[알림 취소] roomId: ${roomId}, cancelled: ${notificationsCancelled}개`);
    } catch (error) {
      this.logger.warn(`[알림 취소] 실패 (계속 진행): ${error.message}`);
    }

    // Google Calendar 이벤트 삭제 (Phase 2)
    let calendarDeleted = false;
    if (calendarEventId) {
      try {
        // 주최자의 캘린더에서 이벤트 삭제 (참석자들에게도 자동 알림)
        await this.calendarService.deleteUserEvent(
          req.user.id,
          calendarEventId,
        );
        calendarDeleted = true;
        this.logger.log(`[Google Calendar] 이벤트 삭제 완료: ${calendarEventId}`);
      } catch (error) {
        this.logger.warn(`[Google Calendar] 이벤트 삭제 실패 (계속 진행): ${error.message}`);
      }
    }

    // 예약 취소 SSE 알림 (참여자들에게)
    if (roomInfo.participantUserIds && roomInfo.participantUserIds.length > 0) {
      this.sseService.handleMeetingCancelled({
        roomId: room.roomId,
        roomTopic: room.roomTopic,
        channelId: room.channelId,
        masterId: req.user.id,
        masterNickName: req.user.nickName,
        participantUserIds: roomInfo.participantUserIds,
      }).catch(err => console.error('[Room] SSE 취소 알림 전송 실패:', err.message));
    }

    return {
      roomId: room.roomId,
      status: room.status,
      message: "예약이 취소되었습니다",
      calendarDeleted,
      notificationsCancelled,
    };
  }

  /**
   * 예약된 회의 수정
   * 시작 시간, 주제, 소요 시간 수정 가능
   */
  @Patch(":roomId/schedule")
  async updateScheduledRoom(
    @Param("roomId") roomId: string,
    @Body() updateDto: UpdateScheduleRoomDto,
    @Request() req,
  ) {
    // 먼저 기존 방 정보 조회
    const existingRoom = await this.roomService.getRoomById(roomId);
    const oldScheduledAt = existingRoom.scheduledAt;

    // 예약 정보 수정
    const room = await this.roomService.updateScheduledRoom(roomId, req.user.id, updateDto);

    // 시간이 변경된 경우 알림 스케줄 재설정
    if (updateDto.scheduledAt && oldScheduledAt) {
      const newScheduledAt = new Date(updateDto.scheduledAt);

      // 기존 알림 취소
      try {
        await this.schedulerService.cancelRoomNotifications(roomId);
        this.logger.log(`[알림 재스케줄] 기존 알림 취소: ${roomId}`);
      } catch (error) {
        this.logger.warn(`[알림 재스케줄] 기존 알림 취소 실패: ${error.message}`);
      }

      // 새 알림 스케줄링
      try {
        const participantUserIds = room.participantUserIds || [];
        const notificationPayload = {
          roomId: room.roomId,
          roomTopic: room.roomTopic,
          channelId: room.channelId,
          masterId: req.user.id,
          masterNickName: req.user.nickName,
          participantUserIds,
          scheduledAt: updateDto.scheduledAt,
        };

        await this.schedulerService.scheduleRoomNotifications(
          room.roomId,
          newScheduledAt,
          {
            onReminder30min: async () => {
              await this.sseService.handleMeetingReminder({
                ...notificationPayload,
                minutesBefore: 30,
              });
              this.logger.log(`[알림] 30분 전 리마인더 전송: ${room.roomId}`);
            },
            onReminder5min: async () => {
              await this.sseService.handleMeetingReminder({
                ...notificationPayload,
                minutesBefore: 5,
              });
              this.logger.log(`[알림] 5분 전 리마인더 전송: ${room.roomId}`);
            },
            onStart: async () => {
              await this.roomService.updateRoomStatus(room.roomId, 'ACTIVE');
              await this.sseService.handleMeetingStarted({
                roomId: room.roomId,
                roomTopic: room.roomTopic,
                channelId: room.channelId,
                masterId: req.user.id,
                masterNickName: req.user.nickName,
                participantUserIds,
              });
              this.logger.log(`[알림] 회의 시작 알림 전송: ${room.roomId}`);
            },
          }
        );

        this.logger.log(`[알림 재스케줄] 새 알림 스케줄 완료: ${roomId}`);
      } catch (error) {
        this.logger.warn(`[알림 재스케줄] 새 알림 스케줄 실패: ${error.message}`);
      }
    }

    return {
      roomId: room.roomId,
      roomTopic: room.roomTopic,
      scheduledAt: room.scheduledAt,
      duration: room.duration,
      status: room.status,
      message: "예약이 수정되었습니다",
    };
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

  /**
   * 예약된 회의 조기 입장 시도
   * - 5분 전부터 입장 가능
   * - 입장 허용 시 회의 상태를 ACTIVE로 변경하고 스케줄러 Job 취소
   */
  @Post(":roomId/early-entry")
  async attemptEarlyEntry(@Param("roomId") roomId: string, @Request() req) {
    const result = await this.roomService.handleEarlyEntry(roomId, req.user.id);

    // 입장이 허용되고 상태가 ACTIVE로 변경된 경우 스케줄러 Job 취소
    if (result.canEnter && result.room.status === "ACTIVE") {
      try {
        const cancelResult = await this.schedulerService.cancelRoomNotifications(roomId);
        this.logger.log(`[조기 입장] 스케줄러 Job 취소: ${roomId}, cancelled: ${cancelResult.cancelled.length}`);
      } catch (error) {
        this.logger.warn(`[조기 입장] 스케줄러 Job 취소 실패 (무시): ${error.message}`);
      }

      // SSE로 회의 시작 알림 전송
      if (result.room.participantUserIds && result.room.participantUserIds.length > 0) {
        this.sseService.handleMeetingStarted({
          roomId: result.room.roomId,
          roomTopic: result.room.roomTopic,
          channelId: result.room.channelId,
          masterId: req.user.id,
          masterNickName: req.user.nickName,
          participantUserIds: result.room.participantUserIds,
        }).catch(err => this.logger.warn(`[조기 입장] SSE 알림 실패: ${err.message}`));
      }
    }

    return {
      canEnter: result.canEnter,
      roomId: result.room.roomId,
      roomTopic: result.room.roomTopic,
      status: result.room.status,
      minutesUntilStart: result.minutesUntilStart,
      message: result.message,
    };
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
