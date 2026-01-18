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

// OAuth 스코프 (읽기 + 쓰기 + 공유 권한)
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',  // 일정 생성/수정/삭제 권한
  'https://www.googleapis.com/auth/calendar.acls',    // 캘린더 공유 권한
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
   * 한국 시간(KST) 기준으로 날짜의 특정 시간을 설정하는 헬퍼 함수
   * @param date 기준 날짜
   * @param hour 시간 (0-23)
   * @param minute 분 (0-59)
   */
  private setKSTHours(date: Date, hour: number, minute: number = 0): Date {
    // 한국 시간대 오프셋: UTC+9
    const KST_OFFSET = 9 * 60; // 분 단위

    // 날짜의 연/월/일 추출 (UTC 기준)
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const day = date.getUTCDate();

    // KST 기준 시간을 UTC로 변환하여 Date 객체 생성
    // KST hour:minute → UTC (hour - 9):minute
    const result = new Date(Date.UTC(year, month, day, hour - 9, minute, 0, 0));

    return result;
  }

  /**
   * 여러 사용자의 일정을 합쳐서 공통 빈 시간대 찾기
   * @param startHour 업무 시작 시간 (기본: 9, KST 기준)
   * @param endHour 업무 종료 시간 (기본: 18, KST 기준)
   * @param excludeWeekends 주말 제외 (기본: true)
   */
  async findCommonFreeSlots(
    userIdentifiers: string[],
    params: {
      timeMin: string;
      timeMax: string;
      durationMinutes?: number;
      startHour?: number;
      endHour?: number;
      excludeWeekends?: boolean;
    },
  ): Promise<{ start: string; end: string }[]> {
    const { timeMin, timeMax, durationMinutes = 60, startHour = 9, endHour = 18, excludeWeekends = true } = params;
    const allEvents: { start: Date; end: Date }[] = [];

    this.logger.log(`[빈시간찾기] 업무시간: ${startHour}시 ~ ${endHour}시 (KST)`);

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

    // 빈 시간대 찾기 (업무 시간 내에서만)
    const freeSlots: { start: string; end: string }[] = [];
    const rangeStart = new Date(timeMin);
    const rangeEnd = new Date(timeMax);
    const durationMs = durationMinutes * 60 * 1000;

    // 날짜별로 처리 (KST 기준)
    const currentDate = new Date(rangeStart);
    // KST 기준 자정으로 설정
    currentDate.setUTCHours(0 - 9, 0, 0, 0); // UTC 기준 전날 15시 = KST 자정

    while (currentDate <= rangeEnd) {
      // 주말 제외 옵션 체크 (KST 기준 요일 계산)
      // dayStart를 기준으로 KST 요일 확인
      const dayStart = this.setKSTHours(currentDate, startHour, 0);
      const kstDayOfWeek = (dayStart.getUTCDay() + (dayStart.getUTCHours() >= 15 ? 1 : 0)) % 7;
      // 더 정확한 KST 요일 계산: dayStart 시간 기준
      const kstDate = new Date(dayStart.getTime() + 9 * 60 * 60 * 1000);
      const dayOfWeek = kstDate.getUTCDay(); // 0=일, 6=토

      if (excludeWeekends && (dayOfWeek === 0 || dayOfWeek === 6)) {
        // 주말이면 건너뜀
        currentDate.setDate(currentDate.getDate() + 1);
        continue;
      }

      // 해당 날짜의 업무 종료 시간 설정 (KST 기준)
      const dayEnd = this.setKSTHours(currentDate, endHour, 0);

      // 범위 조정
      const effectiveStart = dayStart < rangeStart ? rangeStart : dayStart;
      const effectiveEnd = dayEnd > rangeEnd ? rangeEnd : dayEnd;

      if (effectiveStart < effectiveEnd) {
        // 해당 날짜의 이벤트 필터링
        const dayEvents = allEvents.filter(
          (e) => e.start < effectiveEnd && e.end > effectiveStart,
        );

        let currentTime = effectiveStart;

        for (const event of dayEvents) {
          const eventStart = event.start < effectiveStart ? effectiveStart : event.start;
          const eventEnd = event.end > effectiveEnd ? effectiveEnd : event.end;

          // 현재 시점부터 이벤트 시작까지 빈 시간이 있는지
          if (eventStart.getTime() - currentTime.getTime() >= durationMs) {
            freeSlots.push({
              start: currentTime.toISOString(),
              end: eventStart.toISOString(),
            });
          }
          // 현재 시점 업데이트
          if (eventEnd > currentTime) {
            currentTime = eventEnd;
          }
        }

        // 업무 종료 시간까지 빈 시간이 있으면 추가
        if (effectiveEnd.getTime() - currentTime.getTime() >= durationMs) {
          freeSlots.push({
            start: currentTime.toISOString(),
            end: effectiveEnd.toISOString(),
          });
        }
      }

      // 다음 날로 이동
      currentDate.setDate(currentDate.getDate() + 1);
    }

    if (durationMs <= 0) {
      return freeSlots;
    }

    const segmentedSlots: { start: string; end: string }[] = [];

    for (const slot of freeSlots) {
      const slotStart = new Date(slot.start);
      const slotEnd = new Date(slot.end);
      let cursor = new Date(slotStart.getTime());

      while (cursor.getTime() + durationMs <= slotEnd.getTime()) {
        const segmentEnd = new Date(cursor.getTime() + durationMs);
        segmentedSlots.push({
          start: cursor.toISOString(),
          end: segmentEnd.toISOString(),
        });
        cursor = segmentEnd;
      }
    }

    return segmentedSlots;
  }

  // ==================== 캘린더 공유 관련 메서드 ====================
  // 캘린더 공유 권한 유형:
  // - freeBusyReader: 한가함/바쁨 정보만 볼 수 있음
  // - reader: 일정 세부 정보 읽기 가능
  // - writer: 일정 읽기/쓰기 가능

  /**
   * 사용자의 캘린더를 다른 사용자와 공유
   * @param userId 캘린더 소유자의 userId
   * @param targetEmail 공유 대상의 이메일 주소
   * @param role 권한 수준 (기본: reader)
   * @param calendarId 캘린더 ID (기본: primary)
   */
  async shareCalendar(
    userId: string,
    targetEmail: string,
    role: 'freeBusyReader' | 'reader' | 'writer' = 'reader',
    calendarId: string = 'primary',
  ): Promise<{ success: boolean; ruleId?: string; error?: string }> {
    try {
      const oauth2Client = await this.getUserOAuth2Client(userId);
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      const response = await calendar.acl.insert({
        calendarId,
        requestBody: {
          role,
          scope: {
            type: 'user',
            value: targetEmail,
          },
        },
        sendNotifications: true, // 공유 초대 알림 전송
      });

      this.logger.log(`[캘린더공유] ${userId}의 캘린더를 ${targetEmail}에게 공유 (권한: ${role})`);
      return { success: true, ruleId: response.data.id || undefined };
    } catch (error) {
      this.logger.error(`[캘린더공유] 실패: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * 캘린더 공유 해제
   * @param userId 캘린더 소유자의 userId
   * @param ruleId ACL 규칙 ID (또는 user:email 형식)
   * @param calendarId 캘린더 ID (기본: primary)
   */
  async unshareCalendar(
    userId: string,
    ruleId: string,
    calendarId: string = 'primary',
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const oauth2Client = await this.getUserOAuth2Client(userId);
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      await calendar.acl.delete({
        calendarId,
        ruleId,
      });

      this.logger.log(`[캘린더공유] ${userId}의 캘린더 공유 해제: ${ruleId}`);
      return { success: true };
    } catch (error) {
      this.logger.error(`[캘린더공유 해제] 실패: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * 캘린더 공유 목록 조회
   * @param userId 캘린더 소유자의 userId
   * @param calendarId 캘린더 ID (기본: primary)
   */
  async getSharedUsers(
    userId: string,
    calendarId: string = 'primary',
  ): Promise<{ email: string; role: string; ruleId: string }[]> {
    try {
      const oauth2Client = await this.getUserOAuth2Client(userId);
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      const response = await calendar.acl.list({
        calendarId,
      });

      const sharedUsers = (response.data.items || [])
        .filter((item) => item.scope?.type === 'user' && item.scope?.value)
        .map((item) => ({
          email: item.scope!.value!,
          role: item.role || 'reader',
          ruleId: item.id || '',
        }));

      this.logger.log(`[캘린더공유] ${userId}의 공유 목록: ${sharedUsers.length}명`);
      return sharedUsers;
    } catch (error) {
      this.logger.error(`[캘린더공유 목록] 조회 실패: ${error.message}`);
      return [];
    }
  }

  /**
   * Room/Channel 멤버들에게 캘린더 공유
   * @param userId 캘린더 소유자의 userId
   * @param targetUserIds 공유 대상 userId 목록
   * @param role 권한 수준
   */
  async shareCalendarWithMembers(
    userId: string,
    targetUserIds: string[],
    role: 'freeBusyReader' | 'reader' | 'writer' = 'reader',
  ): Promise<{ userId: string; email?: string; success: boolean; error?: string }[]> {
    const results: { userId: string; email?: string; success: boolean; error?: string }[] = [];

    for (const targetUserId of targetUserIds) {
      try {
        // 대상 사용자의 이메일 조회
        const targetUser = await this.userRepository.findOne({
          where: { userId: targetUserId },
          select: ['userId', 'email'],
        });

        if (!targetUser || !targetUser.email) {
          results.push({ userId: targetUserId, success: false, error: '사용자 이메일을 찾을 수 없습니다' });
          continue;
        }

        const shareResult = await this.shareCalendar(userId, targetUser.email, role);
        results.push({
          userId: targetUserId,
          email: targetUser.email,
          success: shareResult.success,
          error: shareResult.error,
        });
      } catch (error) {
        results.push({ userId: targetUserId, success: false, error: error.message });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    this.logger.log(`[캘린더공유] ${userId}의 캘린더를 ${successCount}/${targetUserIds.length}명에게 공유`);

    return results;
  }

  /**
   * Room 참여자들에게 캘린더 공유
   * - participantUserIds에 있는 사용자들에게만 공유
   * - participantUserIds가 비어있으면 masterId만 대상
   */
  async shareCalendarWithRoomParticipants(
    userId: string,
    roomId: string,
    role: 'freeBusyReader' | 'reader' | 'writer' = 'reader',
  ): Promise<{ userId: string; email?: string; success: boolean; error?: string }[]> {
    const room = await this.roomRepository.findOne({
      where: { roomId },
      select: ['roomId', 'participantUserIds', 'masterId'],
    });

    if (!room) {
      this.logger.warn(`[캘린더공유] Room을 찾을 수 없음: ${roomId}`);
      return [{ userId: roomId, success: false, error: 'Room을 찾을 수 없습니다' }];
    }

    this.logger.log(`[캘린더공유] Room ${roomId} - participantUserIds: ${room.participantUserIds?.length || 0}명, masterId: ${room.masterId}`);

    // Room의 participantUserIds 사용 (비어있으면 masterId만)
    let targetUserIds: string[] = [];

    if (room.participantUserIds && room.participantUserIds.length > 0) {
      targetUserIds = [...room.participantUserIds];
    } else {
      // participantUserIds가 비어있으면 방장만 포함
      targetUserIds = [room.masterId];
    }

    // 자기 자신 제외
    targetUserIds = targetUserIds.filter((id) => id !== userId);

    if (targetUserIds.length === 0) {
      return [{ userId, success: false, error: '공유할 대상이 없습니다 (Room에 본인만 있습니다)' }];
    }

    this.logger.log(`[캘린더공유] 공유 대상: ${targetUserIds.length}명 - ${targetUserIds.join(', ')}`);
    return this.shareCalendarWithMembers(userId, targetUserIds, role);
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
