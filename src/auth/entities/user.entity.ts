import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from "typeorm";
import { Channel } from "../../channel/entities/channel.entity";
import { ChannelMember } from "../../channel/entities/channel-member.entity";
import { Room } from "../../room/entities/room.entity";

@Entity("user")
export class User {
  @PrimaryGeneratedColumn("uuid")
  userId: string;

  @Column({ type: "varchar", length: 255, unique: true })
  email: string;

  @Column({ type: "varchar", length: 255 })
  userPassword: string;

  @Column({ type: "varchar", length: 100, unique: true })
  nickName: string;

  @CreateDateColumn({ type: "timestamp with time zone" })
  createdAt: Date;

  @UpdateDateColumn({ type: "timestamp with time zone" })
  updatedAt: Date;

  @OneToMany(() => Channel, (channel) => channel.owner)
  ownedChannels: Channel[];

  @OneToMany(() => ChannelMember, (member) => member.user)
  memberships: ChannelMember[];

  @OneToMany(() => Room, (room) => room.masterUser)
  createdRooms: Room[];
}
