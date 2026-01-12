import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CalendarService } from './calendar.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

interface AddEventDto {
  title: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:mm
  description?: string;
  durationMinutes?: number;
}

@Controller('calendar')
@UseGuards(JwtAuthGuard)
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  // 일정 추가
  @Post('events')
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

  // 일정 목록 조회
  @Get('events')
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

  // 일정 삭제
  @Delete('events/:eventId')
  async deleteEvent(@Param('eventId') eventId: string) {
    await this.calendarService.deleteEvent(eventId);
    return {
      status: 'ok',
      message: '일정이 삭제되었습니다.',
    };
  }
}
