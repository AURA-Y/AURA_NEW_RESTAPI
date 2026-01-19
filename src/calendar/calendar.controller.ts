import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  Res,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { Response } from 'express';
import { CalendarService } from './calendar.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConfigService } from '@nestjs/config';

interface AddEventDto {
  title: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:mm
  description?: string;
  durationMinutes?: number;
  recurrence?: 'daily' | 'weekly' | 'monthly'; // 반복 유형
  repeatCount?: number; // 반복 횟수
  repeatUntil?: string; // 반복 종료일 (YYYY-MM-DD)
}

interface AuthenticatedRequest extends Request {
  user: { userId: string; nickName: string };
}

@Controller('calendar')
export class CalendarController {
  private readonly internalApiKey: string;

  constructor(
    private readonly calendarService: CalendarService,
    private readonly configService: ConfigService,
  ) {
    this.internalApiKey = this.configService.get<string>('INTERNAL_API_KEY') || 'internal-secret-key';
  }

  /**
   * 내부 API 키 검증
   */
  private validateInternalApiKey(apiKey: string | undefined): void {
    if (!apiKey || apiKey !== this.internalApiKey) {
      throw new UnauthorizedException('Invalid internal API key');
    }
  }

  // ==================== OAuth 관련 엔드포인트 ====================

  /**
   * Google OAuth 인증 URL 생성
   * GET /calendar/oauth/auth-url
   */
  @Get('oauth/auth-url')
  @UseGuards(JwtAuthGuard)
  getAuthUrl(@Req() req: AuthenticatedRequest) {
    const userId = req.user.userId;
    const authUrl = this.calendarService.getAuthUrl(userId);
    return { authUrl };
  }

  /**
   * Google OAuth 콜백 처리
   * GET /calendar/oauth/callback?code=xxx&state=userId
   */
  @Get('oauth/callback')
  async handleCallback(
    @Query('code') code: string,
    @Query('state') userId: string,
    @Res() res: Response,
  ) {
    try {
      await this.calendarService.handleOAuthCallback(code, userId);

      // 프론트엔드로 리다이렉트 (성공 메시지 포함)
      const frontendUrl = process.env.FRONTEND_URL || 'https://aura.ai.kr';
      res.redirect(`${frontendUrl}/mypage?google_connected=true`);
    } catch (error) {
      const frontendUrl = process.env.FRONTEND_URL || 'https://aura.ai.kr';
      res.redirect(`${frontendUrl}/mypage?google_error=${encodeURIComponent(error.message)}`);
    }
  }

  /**
   * Google 연동 상태 확인
   * GET /calendar/oauth/status
   */
  @Get('oauth/status')
  @UseGuards(JwtAuthGuard)
  async checkConnection(@Req() req: AuthenticatedRequest) {
    const userId = req.user.userId;
    return this.calendarService.checkGoogleConnection(userId);
  }

  /**
   * Google 연동 해제
   * DELETE /calendar/oauth/disconnect
   */
  @Delete('oauth/disconnect')
  @UseGuards(JwtAuthGuard)
  async disconnect(@Req() req: AuthenticatedRequest) {
    const userId = req.user.userId;
    return this.calendarService.disconnectGoogle(userId);
  }

  // ==================== 사용자 캘린더 조회 (OAuth) ====================

  /**
   * 사용자의 캘린더 목록 조회
   * GET /calendar/user/calendars
   */
  @Get('user/calendars')
  @UseGuards(JwtAuthGuard)
  async getUserCalendars(@Req() req: AuthenticatedRequest) {
    const userId = req.user.userId;
    const calendars = await this.calendarService.getUserCalendars(userId);

    return {
      status: 'ok',
      calendars: calendars.map((cal) => ({
        id: cal.id,
        summary: cal.summary,
        description: cal.description,
        primary: cal.primary,
        backgroundColor: cal.backgroundColor,
      })),
    };
  }

  /**
   * 사용자의 일정 조회
   * GET /calendar/user/events?calendarId=xxx&timeMin=xxx&timeMax=xxx
   */
  @Get('user/events')
  @UseGuards(JwtAuthGuard)
  async getUserEvents(
    @Req() req: AuthenticatedRequest,
    @Query('calendarId') calendarId?: string,
    @Query('maxResults') maxResults?: string,
    @Query('timeMin') timeMin?: string,
    @Query('timeMax') timeMax?: string,
  ) {
    const userId = req.user.userId;
    const events = await this.calendarService.getUserEvents(userId, {
      calendarId,
      maxResults: maxResults ? parseInt(maxResults) : 50,
      timeMin,
      timeMax,
    });

    return {
      status: 'ok',
      events: events.map((e) => ({
        id: e.id,
        title: e.summary,
        description: e.description,
        start: e.start,
        end: e.end,
        location: e.location,
        link: e.htmlLink,
        status: e.status,
      })),
    };
  }

  /**
   * 사용자 개인 캘린더에 일정 추가
   * POST /calendar/user/events
   */
  @Post('user/events')
  @UseGuards(JwtAuthGuard)
  async addUserEvent(
    @Req() req: AuthenticatedRequest,
    @Body() dto: AddEventDto,
  ) {
    const userId = req.user.userId;
    const event = await this.calendarService.addUserEvent(userId, dto);

    return {
      status: 'ok',
      message: '개인 캘린더에 일정이 추가되었습니다.',
      event: {
        id: event.id,
        title: event.summary,
        start: event.start,
        end: event.end,
        link: event.htmlLink,
      },
    };
  }

  /**
   * 사용자 개인 캘린더 일정 수정
   * PATCH /calendar/user/events/:eventId
   */
  @Patch('user/events/:eventId')
  @UseGuards(JwtAuthGuard)
  async updateUserEvent(
    @Req() req: AuthenticatedRequest,
    @Param('eventId') eventId: string,
    @Body() dto: {
      title?: string;
      date?: string;
      time?: string;
      description?: string;
      durationMinutes?: number;
    },
  ) {
    const userId = req.user.userId;
    const event = await this.calendarService.updateUserEvent(userId, eventId, dto);

    return {
      status: 'ok',
      message: '개인 캘린더 일정이 수정되었습니다.',
      event: {
        id: event.id,
        title: event.summary,
        start: event.start,
        end: event.end,
        link: event.htmlLink,
      },
    };
  }

  /**
   * 사용자 개인 캘린더 일정 삭제
   * DELETE /calendar/user/events/:eventId
   */
  @Delete('user/events/:eventId')
  @UseGuards(JwtAuthGuard)
  async deleteUserEvent(
    @Req() req: AuthenticatedRequest,
    @Param('eventId') eventId: string,
  ) {
    const userId = req.user.userId;
    await this.calendarService.deleteUserEvent(userId, eventId);

    return {
      status: 'ok',
      message: '개인 캘린더 일정이 삭제되었습니다.',
    };
  }

  /**
   * Room 참여자들의 개인 캘린더에 일정 추가
   * POST /calendar/room/:roomId/events
   */
  @Post('room/:roomId/events')
  @UseGuards(JwtAuthGuard)
  async addEventToRoom(
    @Param('roomId') roomId: string,
    @Body() dto: AddEventDto,
  ) {
    const results = await this.calendarService.addEventToRoomParticipants(roomId, dto);

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    return {
      status: 'ok',
      message: `${successCount}명의 캘린더에 일정이 추가되었습니다.${failCount > 0 ? ` (${failCount}명 실패)` : ''}`,
      results,
    };
  }

  /**
   * Room 참여자들의 개인 캘린더 일정 수정
   * PATCH /calendar/room/:roomId/events
   */
  @Patch('room/:roomId/events')
  @UseGuards(JwtAuthGuard)
  async updateEventForRoom(
    @Param('roomId') roomId: string,
    @Body() dto: {
      originalTitle: string; // 기존 일정 제목 (검색용)
      title?: string;
      date?: string;
      time?: string;
      description?: string;
      durationMinutes?: number;
    },
  ) {
    const results = await this.calendarService.updateEventForRoomParticipants(roomId, dto);

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    return {
      status: 'ok',
      message: `${successCount}명의 캘린더 일정이 수정되었습니다.${failCount > 0 ? ` (${failCount}명 실패)` : ''}`,
      results,
    };
  }

  /**
   * 공통 빈 시간대 찾기 (여러 사용자)
   * POST /calendar/find-free-slots
   */
  @Post('find-free-slots')
  @UseGuards(JwtAuthGuard)
  async findFreeSlots(
    @Body()
    body: {
      userIds: string[];
      timeMin: string;
      timeMax: string;
      durationMinutes?: number;
      startHour?: number; // 업무 시작 시간 (기본: 9)
      endHour?: number;   // 업무 종료 시간 (기본: 18)
      excludeWeekends?: boolean; // 주말 제외 (기본: true)
    },
  ) {
    const freeSlots = await this.calendarService.findCommonFreeSlots(
      body.userIds,
      {
        timeMin: body.timeMin,
        timeMax: body.timeMax,
        durationMinutes: body.durationMinutes,
        startHour: body.startHour,
        endHour: body.endHour,
        excludeWeekends: body.excludeWeekends,
      },
    );

    return {
      status: 'ok',
      freeSlots,
    };
  }

  /**
   * 공통 빈 시간대 찾기 (내부 서비스용 - API 키 인증)
   * POST /calendar/internal/find-free-slots
   */
  @Post('internal/find-free-slots')
  async findFreeSlotsInternal(
    @Headers('x-internal-api-key') apiKey: string,
    @Body()
    body: {
      userIds: string[];
      timeMin: string;
      timeMax: string;
      durationMinutes?: number;
    },
  ) {
    this.validateInternalApiKey(apiKey);

    const freeSlots = await this.calendarService.findCommonFreeSlots(
      body.userIds,
      {
        timeMin: body.timeMin,
        timeMax: body.timeMax,
        durationMinutes: body.durationMinutes,
      },
    );

    return {
      status: 'ok',
      freeSlots,
    };
  }

  /**
   * 사용자 개인 캘린더에 일정 추가 (내부 서비스용 - API 키 인증)
   * POST /calendar/internal/add-event
   */
  @Post('internal/add-event')
  async addUserEventInternal(
    @Headers('x-internal-api-key') apiKey: string,
    @Body()
    body: {
      userIds: string[];
      title: string;
      date: string;
      time?: string;
      description?: string;
      durationMinutes?: number;
    },
  ) {
    this.validateInternalApiKey(apiKey);

    const results = await this.calendarService.addEventToMultipleUsers(
      body.userIds,
      {
        title: body.title,
        date: body.date,
        time: body.time,
        description: body.description,
        durationMinutes: body.durationMinutes,
      },
    );

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    return {
      status: 'ok',
      message: `${successCount}명의 캘린더에 일정이 추가되었습니다.${failCount > 0 ? ` (${failCount}명 실패)` : ''}`,
      results,
    };
  }

  // ==================== 캘린더 공유 관련 엔드포인트 ====================

  /**
   * 캘린더 공유 목록 조회
   * GET /calendar/share
   */
  @Get('share')
  @UseGuards(JwtAuthGuard)
  async getSharedUsers(@Req() req: AuthenticatedRequest) {
    const userId = req.user.userId;
    const sharedUsers = await this.calendarService.getSharedUsers(userId);

    return {
      status: 'ok',
      sharedUsers,
    };
  }

  /**
   * 특정 사용자에게 캘린더 공유
   * POST /calendar/share
   */
  @Post('share')
  @UseGuards(JwtAuthGuard)
  async shareCalendar(
    @Req() req: AuthenticatedRequest,
    @Body() body: {
      targetEmail: string;
      role?: 'freeBusyReader' | 'reader' | 'writer';
    },
  ) {
    const userId = req.user.userId;
    const result = await this.calendarService.shareCalendar(
      userId,
      body.targetEmail,
      body.role || 'reader',
    );

    if (result.success) {
      return {
        status: 'ok',
        message: `${body.targetEmail}에게 캘린더를 공유했습니다.`,
        ruleId: result.ruleId,
      };
    } else {
      return {
        status: 'error',
        message: result.error || '캘린더 공유에 실패했습니다.',
      };
    }
  }

  /**
   * 캘린더 공유 해제
   * DELETE /calendar/share/:ruleId
   */
  @Delete('share/:ruleId')
  @UseGuards(JwtAuthGuard)
  async unshareCalendar(
    @Req() req: AuthenticatedRequest,
    @Param('ruleId') ruleId: string,
  ) {
    const userId = req.user.userId;
    const result = await this.calendarService.unshareCalendar(userId, ruleId);

    if (result.success) {
      return {
        status: 'ok',
        message: '캘린더 공유가 해제되었습니다.',
      };
    } else {
      return {
        status: 'error',
        message: result.error || '캘린더 공유 해제에 실패했습니다.',
      };
    }
  }

  /**
   * 여러 사용자에게 캘린더 공유 (userId 목록으로)
   * POST /calendar/share/members
   */
  @Post('share/members')
  @UseGuards(JwtAuthGuard)
  async shareCalendarWithMembers(
    @Req() req: AuthenticatedRequest,
    @Body() body: {
      targetUserIds: string[];
      role?: 'freeBusyReader' | 'reader' | 'writer';
    },
  ) {
    const userId = req.user.userId;
    const results = await this.calendarService.shareCalendarWithMembers(
      userId,
      body.targetUserIds,
      body.role || 'reader',
    );

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    return {
      status: 'ok',
      message: `${successCount}명에게 캘린더를 공유했습니다.${failCount > 0 ? ` (${failCount}명 실패)` : ''}`,
      results,
    };
  }

  /**
   * Room 참여자들에게 캘린더 공유
   * POST /calendar/share/room/:roomId
   */
  @Post('share/room/:roomId')
  @UseGuards(JwtAuthGuard)
  async shareCalendarWithRoom(
    @Req() req: AuthenticatedRequest,
    @Param('roomId') roomId: string,
    @Body() body: {
      role?: 'freeBusyReader' | 'reader' | 'writer';
    },
  ) {
    const userId = req.user.userId;
    const results = await this.calendarService.shareCalendarWithRoomParticipants(
      userId,
      roomId,
      body.role || 'reader',
    );

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    return {
      status: 'ok',
      message: `Room 참여자 ${successCount}명에게 캘린더를 공유했습니다.${failCount > 0 ? ` (${failCount}명 실패)` : ''}`,
      results,
    };
  }

  // ==================== 공용 캘린더 (Service Account) - 기존 유지 ====================

  /**
   * 공용 캘린더에 일정 추가
   * POST /calendar/events
   */
  @Post('events')
  @UseGuards(JwtAuthGuard)
  async addEvent(@Body() dto: AddEventDto) {
    const event = await this.calendarService.addEvent(dto);
    return {
      status: 'ok',
      message: '일정이 추가되었습니다.',
      event: {
        id: event.id,
        title: event.summary,
        start: event.start,
        end: event.end,
        link: event.htmlLink,
      },
    };
  }

  /**
   * 공용 캘린더 일정 목록 조회
   * GET /calendar/events
   */
  @Get('events')
  @UseGuards(JwtAuthGuard)
  async listEvents(
    @Query('maxResults') maxResults?: string,
    @Query('timeMin') timeMin?: string,
    @Query('timeMax') timeMax?: string,
  ) {
    const events = await this.calendarService.listEvents({
      maxResults: maxResults ? parseInt(maxResults) : 10,
      timeMin,
      timeMax,
    });

    return {
      status: 'ok',
      events: events.map((e) => ({
        id: e.id,
        title: e.summary,
        start: e.start,
        end: e.end,
        link: e.htmlLink,
      })),
    };
  }

  /**
   * 공용 캘린더 일정 삭제
   * DELETE /calendar/events/:eventId
   */
  @Delete('events/:eventId')
  @UseGuards(JwtAuthGuard)
  async deleteEvent(@Param('eventId') eventId: string) {
    await this.calendarService.deleteEvent(eventId);
    return {
      status: 'ok',
      message: '일정이 삭제되었습니다.',
    };
  }
}
