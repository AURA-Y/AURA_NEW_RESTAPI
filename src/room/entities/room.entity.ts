import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  JoinColumn,
} from "typeorm";
import { User } from "../../auth/entities/user.entity";
import { Channel } from "../../channel/entities/channel.entity";
import { Team } from "../../channel/entities/team.entity";
import { RoomReport } from "./room-report.entity";
import { File } from "./file.entity";

@Entity("room")
export class Room {
  @PrimaryColumn({ type: "varchar", length: 255 })
  roomId: string;

  @CreateDateColumn({ type: "timestamp with time zone" })
  createdAt: Date;

  @Column({ type: "varchar", length: 255 })
  topic: string;

  @Column({ type: "text", nullable: true })
  description?: string | null;

  @Column({ type: "varchar", length: 50, nullable: true })
  roomPassword?: string | null;

  @Column({ type: "varchar", length: 255, unique: true })
  shareLink: string;

  @Column({ type: "uuid" })
  masterId: string;

  @ManyToOne(() => User, (user) => user.createdRooms, { onDelete: "CASCADE" })
  @JoinColumn({ name: "masterId" })
  master: User;

  @Column({ type: "uuid" })
  channelId: string;

  @ManyToOne(() => Channel, (channel) => channel.rooms, { onDelete: "CASCADE" })
  @JoinColumn({ name: "channelId" })
  channel: Channel;

  @Column({ type: "uuid", nullable: true })
  teamId?: string | null;

  @ManyToOne(() => Team, (team) => team.rooms, { onDelete: "SET NULL" })
  @JoinColumn({ name: "teamId" })
  team?: Team | null;

  @Column("text", { array: true, default: [] })
  attendees: string[];

  @Column({ type: "text", nullable: true })
  token?: string | null;

  @OneToMany(() => File, (file) => file.room)
  files: File[];

  @OneToOne(() => RoomReport, (report) => report.room)
  report?: RoomReport | null;
}
