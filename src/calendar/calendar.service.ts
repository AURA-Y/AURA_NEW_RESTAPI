import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { google, calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { User } from '../auth/entities/user.entity';
import { Room } from '../room/entities/room.entity';

// 공용 캘린더 ID (Service Account용)
const CALENDAR_ID = 'f2b4581e2663a2be54d0d277919a3a0ee2fe1d2c6734511d37636f33a8f7315b@group.calendar.google.com';
const SERVICE_ACCOUNT_EMAIL = 'aura-29@bamboo-climate-384705.iam.gserviceaccount.com';

// OAuth 스코프 (읽기 + 쓰기 권한)
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',  // 일정 생성/수정/삭제 권한
];

@Injectable()
export class CalendarService implements OnModuleInit {
  private calendar: calendar_v3.Calendar; // Service Account용 (공용 캘린더)
  private oauth2Client: OAuth2Client; // OAuth용 (개인 캘린더)
  private readonly logger = new Logger(CalendarService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Room)
    private roomRepository: Repository<Room>,
    private configService: ConfigService,
  ) {}

  onModuleInit() {
    // 1. Service Account 초기화 (기존 공용 캘린더용)
    const rawPrivateKey = this.configService.get<string>('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY');
    if (rawPrivateKey) {
      // Docker 환경에서 \n이 리터럴 문자열로 전달될 수 있으므로 처리
      // 따옴표 제거 및 줄바꿈 변환
      const privateKey = rawPrivateKey
        .replace(/^["']|["']$/g, '') // 앞뒤 따옴표 제거
        .replace(/\\n/g, '\n');       // \n 문자열을 실제 줄바꿈으로 변환

      this.logger.log(`Private key length: ${privateKey.length}, starts with: ${privateKey.substring(0, 30)}`);

      const auth = new google.auth.JWT({
        email: SERVICE_ACCOUNT_EMAIL,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/calendar'],
      });
      this.calendar = google.calendar({ version: 'v3', auth });
      this.logger.log('Google Calendar service initialized (Service Account)');
    } else {
      this.logger.warn('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY not configured - public calendar disabled');
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
   * 반복 규칙 생성 (RFC 5545 RRULE 형식)
   * @param recurrence 반복 유형: 'daily' | 'weekly' | 'monthly'
   * @param repeatCount 반복 횟수 (선택, 없으면 무한 반복)
   * @param repeatUntil 반복 종료일 (선택, YYYY-MM-DD 형식)
   */
  private buildRecurrenceRule(
    recurrence: 'daily' | 'weekly' | 'monthly',
    repeatCount?: number,
    repeatUntil?: string,
  ): string[] {
    let rule = 'RRULE:FREQ=';

    switch (recurrence) {
      case 'daily':
        rule += 'DAILY';
        break;
      case 'weekly':
        rule += 'WEEKLY';
        break;
      case 'monthly':
        rule += 'MONTHLY';
        break;
    }

    // 반복 횟수 지정
    if (repeatCount && repeatCount > 0) {
      rule += `;COUNT=${repeatCount}`;
    }
    // 반복 종료일 지정 (COUNT보다 우선)
    else if (repeatUntil) {
      // UNTIL 형식: YYYYMMDDTHHMMSSZ (UTC)
      const untilDate = new Date(repeatUntil);
      untilDate.setHours(23, 59, 59);
      const untilStr = untilDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      rule += `;UNTIL=${untilStr}`;
    }

    return [rule];
  }

  /**
   * 사용자의 개인 캘린더에 일정 추가 (OAuth)
   */
  async addUserEvent(
    userId: string,
    params: {
      title: string;
      date: string; // YYYY-MM-DD
      time?: string; // HH:mm
      description?: string;
      durationMinutes?: number;
      attendees?: string[]; // 참석자 이메일 목록
      recurrence?: 'daily' | 'weekly' | 'monthly'; // 반복 유형
      repeatCount?: number; // 반복 횟수
      repeatUntil?: string; // 반복 종료일 (YYYY-MM-DD)
    },
  ): Promise<calendar_v3.Schema$Event> {
    const oauth2Client = await this.getUserOAuth2Client(userId);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const { title, date, time, description, durationMinutes = 60, attendees, recurrence, repeatCount, repeatUntil } = params;

    let start: calendar_v3.Schema$EventDateTime;
    let end: calendar_v3.Schema$EventDateTime;

    if (time) {
      // 시간이 있는 일정
      const startDateTime = `${date}T${time}:00`;
      const endDate = new Date(`${date}T${time}:00`);
      endDate.setMinutes(endDate.getMinutes() + durationMinutes);

      const endDateStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}T${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}:00`;

      start = { dateTime: startDateTime, timeZone: 'Asia/Seoul' };
      end = { dateTime: endDateStr, timeZone: 'Asia/Seoul' };
    } else {
      // 종일 일정
      const endDateObj = new Date(date);
      endDateObj.setDate(endDateObj.getDate() + 1);
      const endDateStr = endDateObj.toISOString().split('T')[0];

      start = { date };
      end = { date: endDateStr };
    }

    const eventBody: calendar_v3.Schema$Event = {
      summary: title,
      description,
      start,
      end,
    };

    // 참석자 추가
    if (attendees && attendees.length > 0) {
      eventBody.attendees = attendees.map(email => ({ email }));
    }

    // 반복 규칙 추가
    if (recurrence) {
      eventBody.recurrence = this.buildRecurrenceRule(recurrence, repeatCount, repeatUntil);
      this.logger.log(`[개인캘린더] 반복 일정 규칙: ${eventBody.recurrence[0]}`);
    }

    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: eventBody,
      sendUpdates: 'all', // 참석자에게 알림 전송
    });

    this.logger.log(`[개인캘린더] 일정 생성: ${title} on ${date} for user ${userId}${recurrence ? ` (반복: ${recurrence})` : ''}`);
    return response.data;
  }

  /**
   * 사용자의 개인 캘린더 일정 수정 (OAuth)
   */
  async updateUserEvent(
    userId: string,
    eventId: string,
    params: {
      title?: string;
      date?: string; // YYYY-MM-DD
      time?: string; // HH:mm
      description?: string;
      durationMinutes?: number;
    },
  ): Promise<calendar_v3.Schema$Event> {
    const oauth2Client = await this.getUserOAuth2Client(userId);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const { title, date, time, description, durationMinutes = 60 } = params;

    const updateBody: calendar_v3.Schema$Event = {};

    if (title) {
      updateBody.summary = title;
    }

    if (description !== undefined) {
      updateBody.description = description;
    }

    if (date) {
      let start: calendar_v3.Schema$EventDateTime;
      let end: calendar_v3.Schema$EventDateTime;

      if (time) {
        const startDateTime = `${date}T${time}:00`;
        const endDate = new Date(`${date}T${time}:00`);
        endDate.setMinutes(endDate.getMinutes() + durationMinutes);

        const endDateStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}T${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}:00`;

        start = { dateTime: startDateTime, timeZone: 'Asia/Seoul' };
        end = { dateTime: endDateStr, timeZone: 'Asia/Seoul' };
      } else {
        const endDateObj = new Date(date);
        endDateObj.setDate(endDateObj.getDate() + 1);
        const endDateStr = endDateObj.toISOString().split('T')[0];

        start = { date };
        end = { date: endDateStr };
      }

      updateBody.start = start;
      updateBody.end = end;
    }

    const response = await calendar.events.patch({
      calendarId: 'primary',
      eventId,
      requestBody: updateBody,
      sendUpdates: 'all',
    });

    this.logger.log(`[개인캘린더] 일정 수정: ${eventId} for user ${userId}`);
    return response.data;
  }

  /**
   * 여러 사용자의 개인 캘린더에 동시에 일정 추가 + 공용 캘린더에도 추가
   */
  async addEventToMultipleUsers(
    userIdentifiers: string[],
    params: {
      title: string;
      date: string;
      time?: string;
      description?: string;
      durationMinutes?: number;
    },
  ): Promise<{ userId: string; success: boolean; eventId?: string; error?: string }[]> {
    // 1. 공용 캘린더 추가 (비동기로 시작)
    const publicCalendarPromise = this.addEvent(params)
      .then(() => this.logger.log(`[공용캘린더] 일정 추가 성공: ${params.title}`))
      .catch((error) => this.logger.warn(`[공용캘린더] 일정 추가 실패: ${error.message}`));

    // 2. 각 사용자의 개인 캘린더에 추가 (병렬 처리)
    const userPromises = userIdentifiers.map(async (identifier) => {
      try {
        const userId = await this.resolveUserId(identifier);
        if (!userId) {
          return { userId: identifier, success: false, error: '사용자를 찾을 수 없습니다' };
        }

        const event = await this.addUserEvent(userId, params);
        return { userId, success: true, eventId: event.id || undefined };
      } catch (error) {
        this.logger.warn(`[개인캘린더] 일정 추가 실패 (${identifier}): ${error.message}`);
        return { userId: identifier, success: false, error: error.message };
      }
    });

    // 공용 캘린더와 개인 캘린더 모두 완료 대기
    const [, ...userResults] = await Promise.all([publicCalendarPromise, ...userPromises]);

    return userResults as { userId: string; success: boolean; eventId?: string; error?: string }[];
  }

  /**
   * Room의 참여자들 개인 캘린더에 일정 추가
   * participantUserIds가 비어있으면 채널 전체 공개이므로 masterId만 추가
   */
  async addEventToRoomParticipants(
    roomId: string,
    params: {
      title: string;
      date: string;
      time?: string;
      description?: string;
      durationMinutes?: number;
      recurrence?: 'daily' | 'weekly' | 'monthly'; // 반복 유형
      repeatCount?: number; // 반복 횟수
      repeatUntil?: string; // 반복 종료일 (YYYY-MM-DD)
    },
  ): Promise<{ userId: string; success: boolean; eventId?: string; error?: string }[]> {
    // Room 조회
    const room = await this.roomRepository.findOne({
      where: { roomId },
      select: ['roomId', 'roomTopic', 'participantUserIds', 'masterId'],
    });

    if (!room) {
      this.logger.warn(`[캘린더] Room을 찾을 수 없음: ${roomId}`);
      return [{ userId: roomId, success: false, error: 'Room을 찾을 수 없습니다' }];
    }

    // 참여자 목록 결정
    // participantUserIds가 비어있으면 masterId만 사용
    const userIds = room.participantUserIds.length > 0
      ? room.participantUserIds
      : [room.masterId];

    this.logger.log(`[캘린더] Room ${roomId} 참여자 ${userIds.length}명에게 일정 추가: ${params.title}`);

    // 각 참여자의 개인 캘린더에 추가
    const results = await Promise.all(
      userIds.map(async (userId) => {
        try {
          const event = await this.addUserEvent(userId, params);
          return { userId, success: true, eventId: event.id || undefined };
        } catch (error) {
          this.logger.warn(`[개인캘린더] 일정 추가 실패 (${userId}): ${error.message}`);
          return { userId, success: false, error: error.message };
        }
      }),
    );

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    this.logger.log(`[캘린더] Room ${roomId} 일정 추가 완료: ${successCount}명 성공, ${failCount}명 실패`);

    return results;
  }

  /**
   * Room 참여자들의 일정 수정
   * 각 참여자의 캘린더에서 제목으로 일정을 찾아 수정
   */
  async updateEventForRoomParticipants(
    roomId: string,
    params: {
      originalTitle: string; // 기존 일정 제목 (검색용)
      title?: string;
      date?: string;
      time?: string;
      description?: string;
      durationMinutes?: number;
    },
  ): Promise<{ userId: string; success: boolean; eventId?: string; error?: string }[]> {
    const room = await this.roomRepository.findOne({
      where: { roomId },
      select: ['roomId', 'roomTopic', 'participantUserIds', 'masterId'],
    });

    if (!room) {
      this.logger.warn(`[캘린더] Room을 찾을 수 없음: ${roomId}`);
      return [{ userId: roomId, success: false, error: 'Room을 찾을 수 없습니다' }];
    }

    const userIds = room.participantUserIds.length > 0
      ? room.participantUserIds
      : [room.masterId];

    this.logger.log(`[캘린더] Room ${roomId} 참여자 ${userIds.length}명의 일정 수정: ${params.originalTitle}`);

    const results = await Promise.all(
      userIds.map(async (userId) => {
        try {
          // 사용자의 캘린더에서 제목으로 일정 검색
          const events = await this.getUserEvents(userId, {
            maxResults: 100,
            timeMin: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30일 전부터
            timeMax: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1년 후까지
          });

          const targetEvent = events.find(e => e.summary === params.originalTitle);

          if (!targetEvent || !targetEvent.id) {
            return { userId, success: false, error: '일정을 찾을 수 없습니다' };
          }

          const updatedEvent = await this.updateUserEvent(userId, targetEvent.id, {
            title: params.title,
            date: params.date,
            time: params.time,
            description: params.description,
            durationMinutes: params.durationMinutes,
          });

          return { userId, success: true, eventId: updatedEvent.id || undefined };
        } catch (error) {
          this.logger.warn(`[개인캘린더] 일정 수정 실패 (${userId}): ${error.message}`);
          return { userId, success: false, error: error.message };
        }
      }),
    );

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    this.logger.log(`[캘린더] Room ${roomId} 일정 수정 완료: ${successCount}명 성공, ${failCount}명 실패`);

    return results;
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
   * 1. UUID 형식이면 그대로 반환
   * 2. 정확히 일치하는 닉네임 조회
   * 3. 대소문자 무시 매칭
   */
  private async resolveUserId(identifier: string): Promise<string | null> {
    // 이미 UUID 형식이면 그대로 반환
    if (this.isValidUUID(identifier)) {
      return identifier;
    }

    // 1. 정확히 일치하는 닉네임으로 사용자 조회
    let user = await this.userRepository.findOne({
      where: { nickName: identifier },
      select: ['userId', 'nickName'],
    });

    if (user) {
      this.logger.log(`[캘린더] 닉네임 정확히 일치: "${identifier}" -> ${user.userId}`);
      return user.userId;
    }

    // 2. 대소문자 무시 매칭 (ILike)
    user = await this.userRepository.findOne({
      where: { nickName: ILike(identifier) },
      select: ['userId', 'nickName'],
    });

    if (user) {
      this.logger.log(`[캘린더] 닉네임 대소문자 무시 매칭: "${identifier}" -> "${user.nickName}" (${user.userId})`);
      return user.userId;
    }

    // 3. 부분 일치 (마지막 시도)
    user = await this.userRepository.findOne({
      where: { nickName: ILike(`%${identifier}%`) },
      select: ['userId', 'nickName'],
    });

    if (user) {
      this.logger.log(`[캘린더] 닉네임 부분 일치: "${identifier}" -> "${user.nickName}" (${user.userId})`);
      return user.userId;
    }

    this.logger.warn(`[캘린더] 사용자 찾기 실패: "${identifier}"`);
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
      // 시간이 있는 일정
      const startDateTime = `${date}T${time}:00`;
      const endDate = new Date(`${date}T${time}:00`);
      endDate.setMinutes(endDate.getMinutes() + durationMinutes);

      // 로컬 시간 형식으로 변환 (YYYY-MM-DDTHH:mm:ss)
      const endDateStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}T${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}:00`;

      start = { dateTime: startDateTime, timeZone: 'Asia/Seoul' };
      end = { dateTime: endDateStr, timeZone: 'Asia/Seoul' };
    } else {
      // 종일 일정: end는 다음 날이어야 함
      const endDateObj = new Date(date);
      endDateObj.setDate(endDateObj.getDate() + 1);
      const endDateStr = endDateObj.toISOString().split('T')[0];

      start = { date };
      end = { date: endDateStr };
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
