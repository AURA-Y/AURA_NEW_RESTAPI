import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { TeamService } from './team.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('teams')
@UseGuards(JwtAuthGuard)
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  /**
   * POST /teams - 팀 생성
   */
  @Post()
  async createTeam(@Body() createTeamDto: CreateTeamDto, @Request() req) {
    return this.teamService.createTeam(createTeamDto, req.user.id);
  }

  /**
   * GET /teams/channel/:channelId - 특정 채널의 팀 목록 조회
   */
  @Get('channel/:channelId')
  async getTeamsByChannel(@Param('channelId') channelId: string, @Request() req) {
    return this.teamService.getTeamsByChannel(channelId, req.user.id);
  }

  /**
   * GET /teams/:teamId - 특정 팀 상세 조회
   */
  @Get(':teamId')
  async getTeamById(@Param('teamId') teamId: string, @Request() req) {
    return this.teamService.getTeamById(teamId, req.user.id);
  }

  /**
   * PUT /teams/:teamId - 팀 수정
   */
  @Put(':teamId')
  async updateTeam(
    @Param('teamId') teamId: string,
    @Body() updateTeamDto: UpdateTeamDto,
    @Request() req
  ) {
    return this.teamService.updateTeam(teamId, updateTeamDto, req.user.id);
  }

  /**
   * DELETE /teams/:teamId - 팀 삭제
   */
  @Delete(':teamId')
  async deleteTeam(@Param('teamId') teamId: string, @Request() req) {
    return this.teamService.deleteTeam(teamId, req.user.id);
  }

  /**
   * POST /teams/:teamId/members - 팀에 멤버 할당
   */
  @Post(':teamId/members')
  async assignMemberToTeam(
    @Param('teamId') teamId: string,
    @Body('userId') targetUserId: string,
    @Request() req
  ) {
    return this.teamService.assignMemberToTeam(teamId, targetUserId, req.user.id);
  }

  /**
   * DELETE /teams/:teamId/members/:userId - 팀에서 멤버 제거
   */
  @Delete(':teamId/members/:userId')
  async removeMemberFromTeam(
    @Param('teamId') teamId: string,
    @Param('userId') targetUserId: string,
    @Request() req
  ) {
    return this.teamService.removeMemberFromTeam(teamId, targetUserId, req.user.id);
  }
}
