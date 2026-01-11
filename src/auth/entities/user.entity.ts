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

  @Column({ type: "timestamp with time zone" })
  createdAt: Date;

  @Column({ type: "timestamp with time zone" })
  updatedAt: Date;

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

