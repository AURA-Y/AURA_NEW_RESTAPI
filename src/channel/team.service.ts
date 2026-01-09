import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaClient, ChannelRole } from '../../generated/prisma';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';

@Injectable()
export class TeamService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  /**
   * 팀 생성 (채널 소유자 또는 관리자만 가능)
   */
  async createTeam(createTeamDto: CreateTeamDto, userId: string) {
    const { teamName, channelId } = createTeamDto;

    // 채널 존재 확인
    const channel = await this.prisma.channel.findUnique({
      where: { channelId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    // 요청자가 채널의 OWNER 또는 ADMIN인지 확인
    const member = await this.prisma.channelMember.findUnique({
      where: {
        channelId_userId: {
          channelId,
          userId,
        }
      }
    });

    if (!member || (member.role !== ChannelRole.OWNER && member.role !== ChannelRole.ADMIN)) {
      throw new ForbiddenException('Only channel owner or admin can create teams');
    }

    // 팀 생성
    const team = await this.prisma.team.create({
      data: {
        teamName,
        channelId,
      },
      include: {
        channel: {
          select: {
            channelId: true,
            channelName: true,
          }
        },
        _count: {
          select: {
            members: true,
          }
        }
      }
    });

    return team;
  }

  /**
   * 특정 채널의 팀 목록 조회
   */
  async getTeamsByChannel(channelId: string, userId: string) {
    // 채널 멤버인지 확인
    const member = await this.prisma.channelMember.findUnique({
      where: {
        channelId_userId: {
          channelId,
          userId,
        }
      }
    });

    if (!member) {
      throw new ForbiddenException('You are not a member of this channel');
    }

    const teams = await this.prisma.team.findMany({
      where: { channelId },
      include: {
        members: {
          include: {
            user: {
              select: {
                userId: true,
                email: true,
                nickName: true,
              }
            }
          }
        },
        _count: {
          select: {
            members: true,
            rooms: true,
          }
        }
      },
      orderBy: { createdAt: 'asc' },
    });

    return teams;
  }

  /**
   * 특정 팀 상세 조회
   */
  async getTeamById(teamId: string, userId: string) {
    const team = await this.prisma.team.findUnique({
      where: { teamId },
      include: {
        channel: true,
        members: {
          include: {
            user: {
              select: {
                userId: true,
                email: true,
                nickName: true,
              }
            }
          }
        },
        _count: {
          select: {
            members: true,
            rooms: true,
            reports: true,
          }
        }
      }
    });

    if (!team) {
      throw new NotFoundException('Team not found');
    }

    // 해당 채널의 멤버인지 확인
    const channelMember = await this.prisma.channelMember.findUnique({
      where: {
        channelId_userId: {
          channelId: team.channelId,
          userId,
        }
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
    const team = await this.prisma.team.findUnique({
      where: { teamId },
      include: { channel: true }
    });

    if (!team) {
      throw new NotFoundException('Team not found');
    }

    // 요청자가 채널의 OWNER 또는 ADMIN인지 확인
    const member = await this.prisma.channelMember.findUnique({
      where: {
        channelId_userId: {
          channelId: team.channelId,
          userId,
        }
      }
    });

    if (!member || (member.role !== ChannelRole.OWNER && member.role !== ChannelRole.ADMIN)) {
      throw new ForbiddenException('Only channel owner or admin can update teams');
    }

    // 팀 업데이트
    const updatedTeam = await this.prisma.team.update({
      where: { teamId },
      data: updateTeamDto,
      include: {
        channel: {
          select: {
            channelId: true,
            channelName: true,
          }
        },
        _count: {
          select: {
            members: true,
          }
        }
      }
    });

    return updatedTeam;
  }

  /**
   * 팀 삭제 (채널 소유자 또는 관리자만 가능)
   */
  async deleteTeam(teamId: string, userId: string) {
    // 팀 존재 확인
    const team = await this.prisma.team.findUnique({
      where: { teamId },
    });

    if (!team) {
      throw new NotFoundException('Team not found');
    }

    // 요청자가 채널의 OWNER 또는 ADMIN인지 확인
    const member = await this.prisma.channelMember.findUnique({
      where: {
        channelId_userId: {
          channelId: team.channelId,
          userId,
        }
      }
    });

    if (!member || (member.role !== ChannelRole.OWNER && member.role !== ChannelRole.ADMIN)) {
      throw new ForbiddenException('Only channel owner or admin can delete teams');
    }

    // 팀 삭제
    await this.prisma.team.delete({
      where: { teamId },
    });

    return { message: 'Team deleted successfully' };
  }

  /**
   * 팀에 멤버 할당 (채널 소유자 또는 관리자만 가능)
   */
  async assignMemberToTeam(teamId: string, targetUserId: string, requestUserId: string) {
    // 팀 존재 확인
    const team = await this.prisma.team.findUnique({
      where: { teamId },
    });

    if (!team) {
      throw new NotFoundException('Team not found');
    }

    // 요청자가 채널의 OWNER 또는 ADMIN인지 확인
    const requesterMember = await this.prisma.channelMember.findUnique({
      where: {
        channelId_userId: {
          channelId: team.channelId,
          userId: requestUserId,
        }
      }
    });

    if (!requesterMember || (requesterMember.role !== ChannelRole.OWNER && requesterMember.role !== ChannelRole.ADMIN)) {
      throw new ForbiddenException('Only channel owner or admin can assign members to teams');
    }

    // 대상 사용자가 채널 멤버인지 확인
    const targetMember = await this.prisma.channelMember.findUnique({
      where: {
        channelId_userId: {
          channelId: team.channelId,
          userId: targetUserId,
        }
      }
    });

    if (!targetMember) {
      throw new NotFoundException('Target user is not a member of this channel');
    }

    // 팀에 멤버 할당 (teamId 업데이트)
    const updatedMember = await this.prisma.channelMember.update({
      where: {
        channelId_userId: {
          channelId: team.channelId,
          userId: targetUserId,
        }
      },
      data: {
        teamId: teamId,
      },
      include: {
        user: {
          select: {
            userId: true,
            email: true,
            nickName: true,
          }
        },
        team: true,
      }
    });

    return updatedMember;
  }

  /**
   * 팀에서 멤버 제거 (채널 소유자 또는 관리자만 가능)
   */
  async removeMemberFromTeam(teamId: string, targetUserId: string, requestUserId: string) {
    // 팀 존재 확인
    const team = await this.prisma.team.findUnique({
      where: { teamId },
    });

    if (!team) {
      throw new NotFoundException('Team not found');
    }

    // 요청자가 채널의 OWNER 또는 ADMIN인지 확인
    const requesterMember = await this.prisma.channelMember.findUnique({
      where: {
        channelId_userId: {
          channelId: team.channelId,
          userId: requestUserId,
        }
      }
    });

    if (!requesterMember || (requesterMember.role !== ChannelRole.OWNER && requesterMember.role !== ChannelRole.ADMIN)) {
      throw new ForbiddenException('Only channel owner or admin can remove members from teams');
    }

    // 팀에서 멤버 제거 (teamId를 null로 설정)
    const updatedMember = await this.prisma.channelMember.update({
      where: {
        channelId_userId: {
          channelId: team.channelId,
          userId: targetUserId,
        }
      },
      data: {
        teamId: null,
      },
      include: {
        user: {
          select: {
            userId: true,
            email: true,
            nickName: true,
          }
        }
      }
    });

    return updatedMember;
  }
}
