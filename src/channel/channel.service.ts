import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaClient, ChannelRole } from '../../generated/prisma';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';

@Injectable()
export class ChannelService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  /**
   * 채널 생성
   */
  async createChannel(createChannelDto: CreateChannelDto, userId: string) {
    const { channelName } = createChannelDto;

    // 사용자 확인
    const user = await this.prisma.user.findUnique({
      where: { userId }
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // 채널 생성 및 소유자를 자동으로 멤버로 추가
    const channel = await this.prisma.channel.create({
      data: {
        channelName,
        ownerId: userId,
        members: {
          create: {
            userId: userId,
            role: ChannelRole.OWNER,
          }
        }
      },
      include: {
        owner: {
          select: {
            userId: true,
            email: true,
            nickName: true,
          }
        },
        members: true,
      }
    });

    return channel;
  }

  /**
   * 내 채널 목록 조회 (내가 소유하거나 참여 중인)
   */
  async getMyChannels(userId: string) {
    const channels = await this.prisma.channel.findMany({
      where: {
        members: {
          some: {
            userId: userId,
          }
        }
      },
      include: {
        owner: {
          select: {
            userId: true,
            email: true,
            nickName: true,
          }
        },
        members: {
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
        },
        teams: true,
        _count: {
          select: {
            members: true,
            teams: true,
            rooms: true,
          }
        }
      },
      orderBy: { createdAt: 'asc' },
    });

    return channels;
  }

  /**
   * 특정 채널 상세 조회
   */
  async getChannelById(channelId: string, userId: string) {
    // 채널 존재 및 접근 권한 확인
    const channel = await this.prisma.channel.findFirst({
      where: {
        channelId,
        members: {
          some: {
            userId: userId,
          }
        }
      },
      include: {
        owner: {
          select: {
            userId: true,
            email: true,
            nickName: true,
          }
        },
        members: {
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
        },
        teams: {
          include: {
            _count: {
              select: {
                members: true,
              }
            }
          }
        },
        _count: {
          select: {
            members: true,
            teams: true,
            rooms: true,
          }
        }
      },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found or access denied');
    }

    return channel;
  }

  /**
   * 채널 수정 (소유자만 가능)
   */
  async updateChannel(channelId: string, updateChannelDto: UpdateChannelDto, userId: string) {
    // 채널 존재 및 소유자 확인
    const channel = await this.prisma.channel.findUnique({
      where: { channelId },
      include: { owner: true }
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    if (channel.ownerId !== userId) {
      throw new ForbiddenException('Only channel owner can update the channel');
    }

    // 채널 업데이트
    const updatedChannel = await this.prisma.channel.update({
      where: { channelId },
      data: updateChannelDto,
      include: {
        owner: {
          select: {
            userId: true,
            email: true,
            nickName: true,
          }
        },
        members: true,
        teams: true,
      }
    });

    return updatedChannel;
  }

  /**
   * 채널 삭제 (소유자만 가능)
   */
  async deleteChannel(channelId: string, userId: string) {
    // 채널 존재 및 소유자 확인
    const channel = await this.prisma.channel.findUnique({
      where: { channelId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    if (channel.ownerId !== userId) {
      throw new ForbiddenException('Only channel owner can delete the channel');
    }

    // 채널 삭제 (CASCADE로 관련 데이터도 삭제됨)
    await this.prisma.channel.delete({
      where: { channelId },
    });

    return { message: 'Channel deleted successfully' };
  }

  /**
   * 채널 멤버 추가
   */
  async addMember(channelId: string, targetUserId: string, requestUserId: string, role: ChannelRole = ChannelRole.MEMBER) {
    // 채널 존재 확인
    const channel = await this.prisma.channel.findUnique({
      where: { channelId },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    // 요청자가 OWNER 또는 ADMIN인지 확인
    const requesterMember = await this.prisma.channelMember.findUnique({
      where: {
        channelId_userId: {
          channelId,
          userId: requestUserId,
        }
      }
    });

    if (!requesterMember || (requesterMember.role !== ChannelRole.OWNER && requesterMember.role !== ChannelRole.ADMIN)) {
      throw new ForbiddenException('Only channel owner or admin can add members');
    }

    // 대상 사용자 존재 확인
    const targetUser = await this.prisma.user.findUnique({
      where: { userId: targetUserId },
    });

    if (!targetUser) {
      throw new NotFoundException('Target user not found');
    }

    // 이미 멤버인지 확인
    const existingMember = await this.prisma.channelMember.findUnique({
      where: {
        channelId_userId: {
          channelId,
          userId: targetUserId,
        }
      }
    });

    if (existingMember) {
      throw new ConflictException('User is already a member of this channel');
    }

    // 멤버 추가
    const newMember = await this.prisma.channelMember.create({
      data: {
        channelId,
        userId: targetUserId,
        role,
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

    return newMember;
  }
}
