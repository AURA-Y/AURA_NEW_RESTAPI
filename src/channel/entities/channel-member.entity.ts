import {
  Entity,
  Column,
  CreateDateColumn,
  ManyToOne,
  PrimaryColumn,
  JoinColumn,
} from "typeorm";
import { User } from "../../auth/entities/user.entity";
import { Channel } from "./channel.entity";
import { Team } from "./team.entity";

export enum ChannelRole {
  OWNER = "OWNER",
  ADMIN = "ADMIN",
  MEMBER = "MEMBER",
}

@Entity("channel_member")
export class ChannelMember {
  @PrimaryColumn({ type: "uuid" })
  userId: string;

  @PrimaryColumn({ type: "uuid" })
  channelId: string;

  @Column({ type: "uuid", nullable: true })
  teamId?: string | null;

  @Column({ type: "enum", enum: ChannelRole, default: ChannelRole.MEMBER })
  role: ChannelRole;

  @CreateDateColumn({ type: "timestamp with time zone" })
  joinedAt: Date;

  @ManyToOne(() => User, (user) => user.memberships, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user: User;

  @ManyToOne(() => Channel, (channel) => channel.members, { onDelete: "CASCADE" })
  @JoinColumn({ name: "channelId" })
  channel: Channel;

  @ManyToOne(() => Team, (team) => team.members, { onDelete: "SET NULL" })
  @JoinColumn({ name: "teamId" })
  team?: Team | null;
}
