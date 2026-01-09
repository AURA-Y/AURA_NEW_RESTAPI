import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from "typeorm";
import { User } from "../../auth/entities/user.entity";
import { ChannelMember } from "./channel-member.entity";
import { Team } from "./team.entity";

@Entity("channel")
export class Channel {
  @PrimaryGeneratedColumn("uuid")
  channelId: string;

  @Column({ type: "varchar", length: 100 })
  channelName: string;

  @Column({ type: "text", nullable: true })
  channelImg?: string;

  @CreateDateColumn({ type: "timestamp with time zone" })
  createdAt: Date;

  @Column({ type: "uuid" })
  ownerId: string;

  @ManyToOne(() => User, (user) => user.ownedChannels, { onDelete: "CASCADE" })
  @JoinColumn({ name: "ownerId" })
  owner: User;

  @OneToMany(() => ChannelMember, (member) => member.channel)
  members: ChannelMember[];

  @OneToMany(() => Team, (team) => team.channel)
  teams: Team[];
}
