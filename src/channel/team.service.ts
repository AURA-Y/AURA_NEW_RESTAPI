import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Team } from './entities/team.entity';
import { Channel } from './entities/channel.entity';
import { ChannelMember, ChannelRole } from './entities/channel-member.entity';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';

@Injectable()
export class TeamService {
  constructor(
    @InjectRepository(Team)
    private teamRepository: Repository<Team>,
    @InjectRepository(Channel)
    private channelRepository: Repository<Channel>,
    @InjectRepository(ChannelMember)
    private channelMemberRepository: Repository<ChannelMember>,
  ) {}

  /**
   * 팀 생성 (채널 소유자 또는 관리자만 가능)
   */
  async createTeam(createTeamDto: CreateTeamDto, userId: string) {
    const { teamName, channelId } = createTeamDto;

    // 채널 존재 확인
    const channel = await this.channelRepository.findOne({
      where: { channelId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    // 요청자가 채널의 OWNER 또는 ADMIN인지 확인
    const member = await this.channelMemberRepository.findOne({
      where: {
        channelId,
        userId,
      }
    });

    if (!member || (member.role !== ChannelRole.OWNER && member.role !== ChannelRole.ADMIN)) {
      throw new ForbiddenException('Only channel owner or admin can create teams');
    }

    // 팀 생성
    const team = this.teamRepository.create({
      teamName,
      channelId,
    });

    await this.teamRepository.save(team);

    // 생성된 팀 정보 반환
    return this.teamRepository.findOne({
      where: { teamId: team.teamId },
      relations: ['channel', 'members', 'members.user'],
    });
  }

  /**
   * 특정 채널의 팀 목록 조회
   */
  async getTeamsByChannel(channelId: string, userId: string) {
    // 채널 멤버인지 확인
    const member = await this.channelMemberRepository.findOne({
      where: {
        channelId,
        userId,
      }
    });

    if (!member) {
      throw new ForbiddenException('You are not a member of this channel');
    }

    const teams = await this.teamRepository.find({
      where: { channelId },
      relations: ['members', 'members.user'],
      order: { createdAt: 'ASC' },
    });

    return teams;
  }

  /**
   * 특정 팀 상세 조회
   */
  async getTeamById(teamId: string, userId: string) {
    const team = await this.teamRepository.findOne({
      where: { teamId },
      relations: ['channel', 'members', 'members.user'],
    });

    if (!team) {
      throw new NotFoundException('Team not found');
    }

    // 해당 채널의 멤버인지 확인
    const channelMember = await this.channelMemberRepository.findOne({
      where: {
        channelId: team.channelId,
        userId,
      }
    });

    if (!channelMember) {
      throw new ForbiddenException('You are not a member of this channel');
    }

    return team;
  }

  /**
   * 팀 수정 (채널 소유자 또는 관리자만 가능)
   */
  async updateTeam(teamId: string, updateTeamDto: UpdateTeamDto, userId: string) {
    // 팀 존재 확인
    const team = await this.teamRepository.findOne({
      where: { teamId },
      relations: ['channel']
    });

    if (!team) {
      throw new NotFoundException('Team not found');
    }

    // 요청자가 채널의 OWNER 또는 ADMIN인지 확인
    const member = await this.channelMemberRepository.findOne({
      where: {
        channelId: team.channelId,
        userId,
      }
    });

    if (!member || (member.role !== ChannelRole.OWNER && member.role !== ChannelRole.ADMIN)) {
      throw new ForbiddenException('Only channel owner or admin can update teams');
    }

    // 팀 업데이트
    Object.assign(team, updateTeamDto);
    await this.teamRepository.save(team);

    // 업데이트된 팀 정보 반환
    return this.teamRepository.findOne({
      where: { teamId },
      relations: ['channel', 'members', 'members.user'],
    });
  }

  /**
   * 팀 삭제 (채널 소유자 또는 관리자만 가능)
   */
  async deleteTeam(teamId: string, userId: string) {
    // 팀 존재 확인
    const team = await this.teamRepository.findOne({
      where: { teamId },
    });

    if (!team) {
      throw new NotFoundException('Team not found');
    }

    // 요청자가 채널의 OWNER 또는 ADMIN인지 확인
    const member = await this.channelMemberRepository.findOne({
      where: {
        channelId: team.channelId,
        userId,
      }
    });

    if (!member || (member.role !== ChannelRole.OWNER && member.role !== ChannelRole.ADMIN)) {
      throw new ForbiddenException('Only channel owner or admin can delete teams');
    }

    // 팀 삭제
    await this.teamRepository.delete({ teamId });

    return { message: 'Team deleted successfully' };
  }

  /**
   * 팀에 멤버 할당 (채널 소유자 또는 관리자만 가능)
   */
  async assignMemberToTeam(teamId: string, targetUserId: string, requestUserId: string) {
    // 팀 존재 확인
    const team = await this.teamRepository.findOne({
      where: { teamId },
    });

    if (!team) {
      throw new NotFoundException('Team not found');
    }

    // 요청자가 채널의 OWNER 또는 ADMIN인지 확인
    const requesterMember = await this.channelMemberRepository.findOne({
      where: {
        channelId: team.channelId,
        userId: requestUserId,
      }
    });

    if (!requesterMember || (requesterMember.role !== ChannelRole.OWNER && requesterMember.role !== ChannelRole.ADMIN)) {
      throw new ForbiddenException('Only channel owner or admin can assign members to teams');
    }

    // 대상 사용자가 채널 멤버인지 확인
    const targetMember = await this.channelMemberRepository.findOne({
      where: {
        channelId: team.channelId,
        userId: targetUserId,
      }
    });

    if (!targetMember) {
      throw new NotFoundException('Target user is not a member of this channel');
    }

    // 팀에 멤버 할당 (teamId 업데이트)
    targetMember.teamId = teamId;
    await this.channelMemberRepository.save(targetMember);

    // 업데이트된 멤버 정보 반환
    return this.channelMemberRepository.findOne({
      where: {
        channelId: team.channelId,
        userId: targetUserId,
      },
      relations: ['user', 'team'],
    });
  }

  /**
   * 팀에서 멤버 제거 (채널 소유자 또는 관리자만 가능)
   */
  async removeMemberFromTeam(teamId: string, targetUserId: string, requestUserId: string) {
    // 팀 존재 확인
    const team = await this.teamRepository.findOne({
      where: { teamId },
    });

    if (!team) {
      throw new NotFoundException('Team not found');
    }

    // 요청자가 채널의 OWNER 또는 ADMIN인지 확인
    const requesterMember = await this.channelMemberRepository.findOne({
      where: {
        channelId: team.channelId,
        userId: requestUserId,
      }
    });

    if (!requesterMember || (requesterMember.role !== ChannelRole.OWNER && requesterMember.role !== ChannelRole.ADMIN)) {
      throw new ForbiddenException('Only channel owner or admin can remove members from teams');
    }

    // 팀에서 멤버 제거 (teamId를 null로 설정)
    const targetMember = await this.channelMemberRepository.findOne({
      where: {
        channelId: team.channelId,
        userId: targetUserId,
      }
    });

    if (targetMember) {
      targetMember.teamId = null;
      await this.channelMemberRepository.save(targetMember);
    }

    // 업데이트된 멤버 정보 반환
    return this.channelMemberRepository.findOne({
      where: {
        channelId: team.channelId,
        userId: targetUserId,
      },
      relations: ['user'],
    });
  }
}
