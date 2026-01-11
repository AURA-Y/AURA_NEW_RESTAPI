import {
  Entity,
  PrimaryColumn,
  Column,
  OneToOne,
  ManyToOne,
  JoinColumn,
  BeforeInsert,
} from "typeorm";
import { Room } from "./room.entity";
import { Channel } from "../../channel/entities/channel.entity";
import { Team } from "../../channel/entities/team.entity";

export enum ReportScope {
  PUBLIC = "PUBLIC",
  TEAM = "TEAM",
  CHANNEL = "CHANNEL",
  PRIVATE = "PRIVATE",
}

@Entity("RoomReport")
export class RoomReport {
  @PrimaryColumn({ type: "varchar", length: 255 })
  reportId: string; // roomId와 동일한 값

  @Column({ type: "varchar", length: 255 })
  topic: string;

  @Column({ type: "text", nullable: true })
  description: string | null;

  @Column("text", { array: true, default: [] })
  attendees: string[];

  @Column({ type: "timestamp with time zone" })
  createdAt: Date;

  @Column({
    type: "enum",
    enum: ReportScope,
    default: ReportScope.CHANNEL,
  })
  shareScope: ReportScope;

  @Column("uuid", { array: true, default: [] })
  specialAuth: string[];

  @Column({ type: "varchar", length: 255, unique: true })
  roomId: string;

  @Column({ type: "uuid", nullable: false })
  channelId: string;

  @Column({ type: "uuid", nullable: true })
  teamId: string | null;

  @BeforeInsert()
  setDefaults() {
    if (!this.createdAt) {
      this.createdAt = new Date();
    }
    if (!this.attendees) {
      this.attendees = [];
    }
    if (!this.specialAuth) {
      this.specialAuth = [];
    }
  }

  @OneToOne(() => Room, (room) => room.report, { onDelete: "CASCADE" })
  @JoinColumn({ name: "roomId" })
  room: Room;

  @ManyToOne(() => Channel, (channel) => channel.reports, { onDelete: "CASCADE" })
  @JoinColumn({ name: "channelId" })
  channel: Channel;

  @ManyToOne(() => Team, (team) => team.reports, { onDelete: "SET NULL" })
  @JoinColumn({ name: "teamId" })
  team: Team | null;
}
