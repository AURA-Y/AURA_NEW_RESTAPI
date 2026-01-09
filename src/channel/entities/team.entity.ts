import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from "typeorm";
import { Channel } from "./channel.entity";
import { ChannelMember } from "./channel-member.entity";

@Entity("team")
export class Team {
  @PrimaryGeneratedColumn("uuid")
  teamId: string;

  @Column({ type: "varchar", length: 100 })
  teamName: string;

  @CreateDateColumn({ type: "timestamp with time zone" })
  createdAt: Date;

  @Column({ type: "uuid" })
  channelId: string;

  @ManyToOne(() => Channel, (channel) => channel.teams, { onDelete: "CASCADE" })
  @JoinColumn({ name: "channelId" })
  channel: Channel;

  @OneToMany(() => ChannelMember, (member) => member.team)
  members: ChannelMember[];
}
