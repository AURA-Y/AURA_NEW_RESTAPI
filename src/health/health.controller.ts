import { Controller, Get } from '@nestjs/common';

@Controller('restapi/health')
export class HealthController {
  @Get()
  health() {
    return { status: 'ok' };
  }
}
