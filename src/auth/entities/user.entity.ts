import {
  Entity,
  PrimaryColumn,
  Column,
  OneToMany,
  BeforeInsert,
  BeforeUpdate,
} from "typeorm";
import { Channel } from "../../channel/entities/channel.entity";
import { ChannelMember } from "../../channel/entities/channel-member.entity";
import { Room } from "../../room/entities/room.entity";
import { v4 as uuidv4 } from "uuid";

@Entity("User")
export class User {
  @PrimaryColumn({ type: "uuid" })
  userId: string;

  @Column({ type: "varchar", length: 255, unique: true })
  email: string;

  @Column({ type: "varchar", length: 255 })
  userPassword: string;

  @Column({ type: "varchar", length: 100, unique: true })
  nickName: string;

  @Column({ type: "timestamp with time zone", default: () => "CURRENT_TIMESTAMP" })
  createdAt: Date;

  @Column({ type: "timestamp with time zone", default: () => "CURRENT_TIMESTAMP" })
  updatedAt: Date;

  // Google OAuth 토큰 (캘린더 연동용)
  @Column({ type: "text", nullable: true })
  googleAccessToken: string | null;

  @Column({ type: "text", nullable: true })
  googleRefreshToken: string | null;

  @Column({ type: "timestamp with time zone", nullable: true })
  googleTokenExpiry: Date | null;

  // 프로필 이미지 URL
  @Column({ type: "text", nullable: true })
  profileImage: string | null;

  // GitHub 사용자명 (액션 아이템 Assignee 연동용)
  @Column({ type: "varchar", length: 39, nullable: true })
  githubUsername: string | null;

  // GitHub 계정 ID (OAuth 연동용)
  @Column({ type: "varchar", length: 100, nullable: true })
  githubId: string | null;

  // GitHub 계정 연동 일시
  @Column({ type: "timestamp with time zone", nullable: true })
  githubLinkedAt: Date | null;

  @BeforeInsert()
  setInsertDefaults() {
    if (!this.userId) {
      this.userId = uuidv4();
    }
    const now = new Date();
    this.createdAt = now;
    this.updatedAt = now;
  }

  @BeforeUpdate()
  setUpdateTimestamp() {
    this.updatedAt = new Date();
  }

  // 관계 설정
  @OneToMany(() => Channel, (channel) => channel.owner)
  ownedChannels: Channel[];

  @OneToMany(() => ChannelMember, (member) => member.user)
  memberships: ChannelMember[];

  @OneToMany(() => Room, (room) => room.master)
  createdRooms: Room[];
}

