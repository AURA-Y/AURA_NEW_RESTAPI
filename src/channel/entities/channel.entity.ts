import {
  Entity,
  PrimaryColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  BeforeInsert,
} from "typeorm";
import { User } from "../../auth/entities/user.entity";
import { ChannelMember } from "./channel-member.entity";
import { Team } from "./team.entity";
import { Room } from "../../room/entities/room.entity";
import { RoomReport } from "../../room/entities/room-report.entity";
import { JoinRequest } from "./join-request.entity";
import { v4 as uuidv4 } from "uuid";

@Entity("Channel")
export class Channel {
  @PrimaryColumn({ type: "uuid" })
  channelId: string;

  @Column({ type: "varchar", length: 100 })
  channelName: string;

  @Column({ type: "timestamp with time zone" })
  createdAt: Date;

  @Column({ type: "uuid" })
  ownerId: string;

  @BeforeInsert()
  setDefaults() {
    if (!this.channelId) {
      this.channelId = uuidv4();
    }
    if (!this.createdAt) {
      this.createdAt = new Date();
    }
  }

  @ManyToOne(() => User, (user) => user.ownedChannels, { onDelete: "CASCADE" })
  @JoinColumn({ name: "ownerId" })
  owner: User;

  @OneToMany(() => ChannelMember, (member) => member.channel)
  members: ChannelMember[];

  @OneToMany(() => Team, (team) => team.channel)
  teams: Team[];

  @OneToMany(() => Room, (room) => room.channel)
  rooms: Room[];

  @OneToMany(() => RoomReport, (report) => report.channel)
  reports: RoomReport[];

  @OneToMany(() => JoinRequest, (request) => request.channel)
  joinRequests: JoinRequest[];
}
