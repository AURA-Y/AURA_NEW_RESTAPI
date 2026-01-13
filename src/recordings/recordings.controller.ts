import { Controller, Get, Param } from "@nestjs/common";
import { RecordingsService } from "./recordings.service";

@Controller("recordings")
export class RecordingsController {
  constructor(private readonly recordingsService: RecordingsService) {}

  /**
   * 특정 회의실의 녹화 목록 조회
   * GET /restapi/recordings/:roomId
   */
  @Get(":roomId")
  async getRecordings(@Param("roomId") roomId: string) {
    return this.recordingsService.listRecordings(roomId);
  }
}
