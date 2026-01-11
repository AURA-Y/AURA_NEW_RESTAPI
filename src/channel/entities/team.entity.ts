import {
  Entity,
  PrimaryColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  BeforeInsert,
} from "typeorm";
import { Channel } from "./channel.entity";
import { ChannelMember } from "./channel-member.entity";
import { Room } from "../../room/entities/room.entity";
import { RoomReport } from "../../room/entities/room-report.entity";
import { v4 as uuidv4 } from "uuid";

@Entity("Team")
export class Team {
  @PrimaryColumn({ type: "uuid" })
  teamId: string;

  @Column({ type: "varchar", length: 100 })
  teamName: string;

  @Column({ type: "timestamp with time zone" })
  createdAt: Date;

  @Column({ type: "uuid" })
  channelId: string;

  @BeforeInsert()
  setDefaults() {
    if (!this.teamId) {
      this.teamId = uuidv4();
    }
    if (!this.createdAt) {
      this.createdAt = new Date();
    }
  }

  @ManyToOne(() => Channel, (channel) => channel.teams, { onDelete: "CASCADE" })
  @JoinColumn({ name: "channelId" })
  channel: Channel;

  @OneToMany(() => ChannelMember, (member) => member.team)
  members: ChannelMember[];

  @OneToMany(() => Room, (room) => room.team)
  rooms: Room[];

  @OneToMany(() => RoomReport, (report) => report.team)
  reports: RoomReport[];
}
