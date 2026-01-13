import {
  Entity,
  Column,
  ManyToOne,
  PrimaryColumn,
  JoinColumn,
  BeforeInsert,
} from "typeorm";
import { User } from "../../auth/entities/user.entity";
import { Channel } from "./channel.entity";
import { Team } from "./team.entity";

export enum ChannelRole {
  OWNER = "OWNER",
  ADMIN = "ADMIN",
  MEMBER = "MEMBER",
}

@Entity("ChannelMember")
export class ChannelMember {
  @PrimaryColumn({ type: "uuid" })
  userId: string;

  @PrimaryColumn({ type: "uuid" })
  channelId: string;

  @Column({ type: "uuid", nullable: true })
  teamId?: string | null;

  @Column({ type: "enum", enum: ChannelRole, default: ChannelRole.MEMBER })
  role: ChannelRole;

  @Column({ type: "timestamp with time zone", default: () => "CURRENT_TIMESTAMP" })
  joinedAt: Date;

  @BeforeInsert()
  setDefaults() {
    if (!this.joinedAt) {
      this.joinedAt = new Date();
    }
  }

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
