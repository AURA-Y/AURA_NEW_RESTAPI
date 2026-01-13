import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { google, calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { User } from '../auth/entities/user.entity';

// 공용 캘린더 ID (Service Account용 - 기존 유지)
const CALENDAR_ID = 'd4faa91b83282cf8b377bb5ca7f586cd83959897fa544b3133f8e39c9cf42443@group.calendar.google.com';
const SERVICE_ACCOUNT_EMAIL = 'aura-29@bamboo-climate-384705.iam.gserviceaccount.com';

// OAuth 스코프
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
];

@Injectable()
export class CalendarService implements OnModuleInit {
  private calendar: calendar_v3.Calendar; // Service Account용 (공용 캘린더)
  private oauth2Client: OAuth2Client; // OAuth용 (개인 캘린더)
  private readonly logger = new Logger(CalendarService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private configService: ConfigService,
  ) {}

  onModuleInit() {
    // 1. Service Account 초기화 (기존 공용 캘린더용)
    const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    if (privateKey) {
      const auth = new google.auth.JWT({
        email: SERVICE_ACCOUNT_EMAIL,
        key: privateKey.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/calendar'],
      });
      this.calendar = google.calendar({ version: 'v3', auth });
      this.logger.log('Google Calendar service initialized (Service Account)');
    }

    // 2. OAuth2 클라이언트 초기화 (개인 캘린더용)
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.configService.get<string>('GOOGLE_CLIENT_SECRET');
    const redirectUri = this.configService.get<string>('GOOGLE_REDIRECT_URI');

    if (clientId && clientSecret && redirectUri) {
      this.oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);
      this.logger.log('Google OAuth2 client initialized');
    } else {
      this.logger.warn('Google OAuth2 credentials not configured');
    }
  }

  // ==================== OAuth 관련 메서드 ====================

  /**
   * OAuth 동의 URL 생성
   */
  getAuthUrl(userId: string): string {
    if (!this.oauth2Client) {
      throw new Error('Google OAuth2 client not configured');
    }

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent', // 항상 refresh_token 받기 위해
      state: userId, // 콜백에서 사용자 식별
    });
  }

  /**
   * OAuth 콜백 처리 - 토큰 저장
   */
  async handleOAuthCallback(code: string, userId: string): Promise<{ success: boolean }> {
    if (!this.oauth2Client) {
      throw new Error('Google OAuth2 client not configured');
    }

    const { tokens } = await this.oauth2Client.getToken(code);

    // 사용자 DB에 토큰 저장
    await this.userRepository.update(
      { userId },
      {
        googleAccessToken: tokens.access_token || null,
        googleRefreshToken: tokens.refresh_token || null,
        googleTokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      },
    );

    this.logger.log(`Google OAuth tokens saved for user: ${userId}`);
    return { success: true };
  }

  /**
   * 사용자의 Google 연동 상태 확인
   */
  async checkGoogleConnection(userId: string): Promise<{ connected: boolean; email?: string }> {
    const user = await this.userRepository.findOne({
      where: { userId },
      select: ['userId', 'googleAccessToken', 'googleRefreshToken'],
    });

    if (!user || !user.googleAccessToken) {
      return { connected: false };
    }

    // 토큰이 유효한지 확인 (간단히 존재 여부만)
    return { connected: true };
  }

  /**
   * Google 연동 해제
   */
  async disconnectGoogle(userId: string): Promise<{ success: boolean }> {
    await this.userRepository.update(
      { userId },
      {
        googleAccessToken: null,
        googleRefreshToken: null,
        googleTokenExpiry: null,
      },
    );

    this.logger.log(`Google disconnected for user: ${userId}`);
    return { success: true };
  }

  /**
   * 사용자별 OAuth2 클라이언트 생성 (토큰 자동 갱신 포함)
   */
  private async getUserOAuth2Client(userId: string): Promise<OAuth2Client> {
    const user = await this.userRepository.findOne({
      where: { userId },
      select: ['userId', 'googleAccessToken', 'googleRefreshToken', 'googleTokenExpiry'],
    });

    if (!user || !user.googleAccessToken) {
      throw new Error('Google Calendar not connected');
    }

    const oauth2Client = new OAuth2Client(
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
      this.configService.get<string>('GOOGLE_CLIENT_SECRET'),
      this.configService.get<string>('GOOGLE_REDIRECT_URI'),
    );

    oauth2Client.setCredentials({
      access_token: user.googleAccessToken,
      refresh_token: user.googleRefreshToken,
      expiry_date: user.googleTokenExpiry?.getTime(),
    });

    // 토큰 만료 시 자동 갱신
    if (user.googleTokenExpiry && user.googleTokenExpiry < new Date()) {
      this.logger.log(`Refreshing Google token for user: ${userId}`);
      const { credentials } = await oauth2Client.refreshAccessToken();

      await this.userRepository.update(
        { userId },
        {
          googleAccessToken: credentials.access_token || null,
          googleTokenExpiry: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
        },
      );

      oauth2Client.setCredentials(credentials);
    }

    return oauth2Client;
  }

  /**
   * 사용자의 캘린더 목록 조회
   */
  async getUserCalendars(userId: string): Promise<calendar_v3.Schema$CalendarListEntry[]> {
    const oauth2Client = await this.getUserOAuth2Client(userId);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const response = await calendar.calendarList.list({
      minAccessRole: 'reader',
    });

    return response.data.items || [];
  }

  /**
   * 사용자의 일정 조회 (특정 캘린더 또는 기본 캘린더)
   */
  async getUserEvents(
    userId: string,
    params?: {
      calendarId?: string;
      maxResults?: number;
      timeMin?: string;
      timeMax?: string;
    },
  ): Promise<calendar_v3.Schema$Event[]> {
    const oauth2Client = await this.getUserOAuth2Client(userId);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const { calendarId = 'primary', maxResults = 50, timeMin, timeMax } = params || {};

    const response = await calendar.events.list({
      calendarId,
      maxResults,
      timeMin: timeMin || new Date().toISOString(),
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
    });

    return response.data.items || [];
  }

  /**
   * UUID 형식인지 확인
   */
  private isValidUUID(str: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
  }

  /**
   * 닉네임 또는 userId로 실제 userId 조회
   */
  private async resolveUserId(identifier: string): Promise<string | null> {
    // 이미 UUID 형식이면 그대로 반환
    if (this.isValidUUID(identifier)) {
      return identifier;
    }

    // 닉네임으로 사용자 조회
    const user = await this.userRepository.findOne({
      where: { nickName: identifier },
      select: ['userId'],
    });

    if (user) {
      this.logger.log(`Resolved nickname "${identifier}" to userId: ${user.userId}`);
      return user.userId;
    }

    this.logger.warn(`Could not resolve identifier "${identifier}" to userId`);
    return null;
  }

  /**
   * 여러 사용자의 일정을 합쳐서 공통 빈 시간대 찾기
   */
  async findCommonFreeSlots(
    userIdentifiers: string[],
    params: {
      timeMin: string;
      timeMax: string;
      durationMinutes?: number;
    },
  ): Promise<{ start: string; end: string }[]> {
    const { timeMin, timeMax, durationMinutes = 60 } = params;
    const allEvents: { start: Date; end: Date }[] = [];

    // 모든 사용자의 일정 수집
    for (const identifier of userIdentifiers) {
      try {
        // 닉네임이면 userId로 변환
        const userId = await this.resolveUserId(identifier);
        if (!userId) {
          this.logger.warn(`Skipping unknown user: ${identifier}`);
          continue;
        }

        const events = await this.getUserEvents(userId, { timeMin, timeMax, maxResults: 100 });

        for (const event of events) {
          if (event.start?.dateTime && event.end?.dateTime) {
            allEvents.push({
              start: new Date(event.start.dateTime),
              end: new Date(event.end.dateTime),
            });
          }
        }
      } catch (error) {
        this.logger.warn(`Failed to get events for user ${identifier}: ${error.message}`);
      }
    }

    // 일정 정렬
    allEvents.sort((a, b) => a.start.getTime() - b.start.getTime());

    // 빈 시간대 찾기
    const freeSlots: { start: string; end: string }[] = [];
    let currentTime = new Date(timeMin);
    const endTime = new Date(timeMax);
    const durationMs = durationMinutes * 60 * 1000;

    for (const event of allEvents) {
      // 현재 시점부터 이벤트 시작까지 빈 시간이 있는지
      if (event.start.getTime() - currentTime.getTime() >= durationMs) {
        freeSlots.push({
          start: currentTime.toISOString(),
          end: event.start.toISOString(),
        });
      }
      // 현재 시점 업데이트
      if (event.end > currentTime) {
        currentTime = event.end;
      }
    }

    // 마지막 이벤트 이후 빈 시간
    if (endTime.getTime() - currentTime.getTime() >= durationMs) {
      freeSlots.push({
        start: currentTime.toISOString(),
        end: endTime.toISOString(),
      });
    }

    return freeSlots;
  }

  // ==================== Service Account (공용 캘린더) 메서드 - 기존 유지 ====================

  async addEvent(params: {
    title: string;
    date: string;
    time?: string;
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

    this.logger.log(`[공용캘린더] Event created: ${title} on ${date}`);
    return response.data;
  }

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

  async deleteEvent(eventId: string): Promise<void> {
    if (!this.calendar) {
      throw new Error('Calendar service not initialized. Check GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY env variable.');
    }
    await this.calendar.events.delete({
      calendarId: CALENDAR_ID,
      eventId,
    });
    this.logger.log(`[공용캘린더] Event deleted: ${eventId}`);
  }
}
