import { Module } from '@nestjs/common';
import { GitHubController } from './github.controller';
import { GitHubService } from './github.service';
import { GitHubAppService } from './github-app.service';
import { GitHubProjectsService } from './github-projects.service';
import { ActionItemService } from './services/action-item.service';
import { ActionItemParserService } from './services/action-item-parser.service';

/**
 * GitHubModule
 *
 * GitHub Issue 연동 기능을 제공하는 모듈
 *
 * 의존성:
 * - SecretsModule (Global) → SecretsService
 * - EncryptionModule (Global) → EncryptionService
 * - PrismaModule (Global) → PrismaService
 *
 * 제공 서비스:
 * - GitHubAppService: GitHub App 인증 (JWT, Installation Token)
 * - GitHubService: Issue 생성, 설정 관리
 *
 * API 엔드포인트 (/restapi/github/*):
 * - Channel 설정: GET/PUT/DELETE /github/channels/:channelId
 * - Room 오버라이드: GET/PUT/DELETE /github/rooms/:roomId
 * - Issue 생성: POST /github/rooms/:roomId/issues
 * - 연결 테스트: POST /github/test-connection
 */
@Module({
  controllers: [GitHubController],
  providers: [
    GitHubAppService,
    GitHubService,
    GitHubProjectsService,
    ActionItemParserService,
    ActionItemService,
  ],
  exports: [
    GitHubService,
    GitHubAppService,
    GitHubProjectsService,
    ActionItemService,
  ],
})
export class GitHubModule {}
