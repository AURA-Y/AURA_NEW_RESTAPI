import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Channel } from './entities/channel.entity';
import { CreateChannelDto } from './dto/create-channel.dto';
import { User } from '../auth/entities/user.entity';

@Injectable()
export class ChannelService {
  constructor(
    @InjectRepository(Channel)
    private channelRepository: Repository<Channel>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  /**
   * 채널 생성
   */
  async createChannel(createChannelDto: CreateChannelDto, userId: string): Promise<Channel> {
    const { channelName, channelImg } = createChannelDto;

    // 사용자 확인
    const user = await this.userRepository.findOne({ where: { userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // 채널 생성
    const channel = this.channelRepository.create({
      channelName,
      channelImg,
      owner: user, // 소유자 설정
    });

    return await this.channelRepository.save(channel);
  }

  /**
   * 내 채널 목록 조회 (내가 소유하거나 참여 중인)
   * 현재는 소유한 채널만 반환 (추후 멤버십 로직 추가 필요)
   */
  async getMyChannels(userId: string): Promise<Channel[]> {
    return this.channelRepository.find({
      where: [
        { owner: { userId } }, // 내가 소유한 채널
        // { members: { user: { userId } } } // 내가 멤버인 채널 (추후 구현)
      ],
      order: { createdAt: 'ASC' },
    });
  }
}
