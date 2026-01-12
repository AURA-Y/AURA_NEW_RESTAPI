import {
  Controller,
  Get,
  Post,
  Body,
  Sse,
  Req,
  UseGuards,
  MessageEvent,
  HttpCode,
} from '@nestjs/common';
import { Observable, map, finalize } from 'rxjs';
import { SseService, NotificationEvent } from './sse.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller()
export class SseController {
  constructor(private readonly sseService: SseService) {}

  // SSE 연결 엔드포인트 (JWT 인증 필요)
  @Get('sse/notifications')
  @UseGuards(JwtAuthGuard)
  @Sse()
  notifications(@Req() req: any): Observable<MessageEvent> {
    const userId = req.user.userId;
    const subject = this.sseService.addClient(userId);

    return subject.pipe(
      map((event: NotificationEvent) => ({
        data: JSON.stringify(event),
      })),
      finalize(() => {
        this.sseService.removeClient(userId);
      }),
    );
  }

  // AURA_RAG에서 호출하는 Webhook 엔드포인트
  // payload는 snake_case로 들어옴 (room_id, meeting_title 등)
  @Post('webhook/report-complete')
  @HttpCode(200)
  async handleReportComplete(
    @Body() payload: any,
  ): Promise<{ status: string; notified: string[]; failed: string[] }> {
    console.log(`[Webhook] Report complete received for room: ${payload.room_id}`);

    const result = await this.sseService.handleReportComplete({
      roomId: payload.room_id,
      meetingTitle: payload.meeting_title,
      reportUrl: payload.report_url,
      downloadUrl: payload.download_url,
      speakers: payload.speakers || [],
      completedAt: payload.completed_at,
    });

    return {
      status: 'ok',
      ...result,
    };
  }

  // livekit-api 서버에서 호출하는 Room 정리 엔드포인트 (인증 없음 - 내부 서버 간 통신)
  @Post('internal/room-cleanup')
  @HttpCode(200)
  async handleRoomCleanup(
    @Body() payload: { roomId: string },
  ): Promise<{
    status: string;
    roomDeleted: boolean;
    reportDeleted: boolean;
    filesDeleted: number;
    s3Deleted: boolean;
  }> {
    console.log(`[Internal] Room cleanup requested for: ${payload.roomId}`);

    const result = await this.sseService.cleanupRoom(payload.roomId);

    return {
      status: 'ok',
      ...result,
    };
  }
}
