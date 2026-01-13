import { Injectable, OnModuleInit } from '@nestjs/common';
import { google, calendar_v3 } from 'googleapis';

// 캘린더 ID (공용 캘린더)
const CALENDAR_ID = 'd4faa91b83282cf8b377bb5ca7f586cd83959897fa544b3133f8e39c9cf42443@group.calendar.google.com';

// Service Account 이메일 (공개 가능)
const SERVICE_ACCOUNT_EMAIL = 'aura-29@bamboo-climate-384705.iam.gserviceaccount.com';

@Injectable()
export class CalendarService implements OnModuleInit {
  private calendar: calendar_v3.Calendar;

  onModuleInit() {
    const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

    if (!privateKey) {
      console.error('[Calendar] GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is not set');
      return;
    }

    const auth = new google.auth.JWT({
      email: SERVICE_ACCOUNT_EMAIL,
      // 환경변수에서 \n이 문자열로 들어오면 실제 줄바꿈으로 변환
      key: privateKey.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });

    this.calendar = google.calendar({ version: 'v3', auth });
    console.log('[Calendar] Google Calendar service initialized (Service Account)');
  }

  // 일정 추가
  async addEvent(params: {
    title: string;
    date: string; // YYYY-MM-DD
    time?: string; // HH:mm (optional)
    description?: string;
    durationMinutes?: number;
  }): Promise<calendar_v3.Schema$Event> {
    if (!this.calendar) {
      throw new Error('Calendar service not initialized. Check GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY env variable.');
    }
    const { title, date, time, description, durationMinutes = 60 } = params;

    let start: calendar_v3.Schema$EventDateTime;
    let end: calendar_v3.Schema$EventDateTime;

    if (time) {
      const startDateTime = `${date}T${time}:00`;
      const endDate = new Date(`${date}T${time}:00`);
      endDate.setMinutes(endDate.getMinutes() + durationMinutes);

      start = { dateTime: startDateTime, timeZone: 'Asia/Seoul' };
      end = { dateTime: endDate.toISOString().slice(0, 19), timeZone: 'Asia/Seoul' };
    } else {
      start = { date };
      end = { date };
    }

    const response = await this.calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: {
        summary: title,
        description,
        start,
        end,
      },
    });

    console.log(`[Calendar] Event created: ${title} on ${date}`);
    return response.data;
  }

  // 일정 목록 조회
  async listEvents(params?: {
    maxResults?: number;
    timeMin?: string;
    timeMax?: string;
  }): Promise<calendar_v3.Schema$Event[]> {
    if (!this.calendar) {
      console.warn('[Calendar] Service not initialized, returning empty list');
      return [];
    }
    const { maxResults = 10, timeMin, timeMax } = params || {};

    const response = await this.calendar.events.list({
      calendarId: CALENDAR_ID,
      maxResults,
      timeMin: timeMin || new Date().toISOString(),
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
    });

    return response.data.items || [];
  }

  // 일정 삭제
  async deleteEvent(eventId: string): Promise<void> {
    if (!this.calendar) {
      throw new Error('Calendar service not initialized. Check GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY env variable.');
    }
    await this.calendar.events.delete({
      calendarId: CALENDAR_ID,
      eventId,
    });
    console.log(`[Calendar] Event deleted: ${eventId}`);
  }
}
