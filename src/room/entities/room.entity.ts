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
import { File } from "./file.entity";
import { RoomReport } from "./room-report.entity";

export interface UploadFileItem {
  fileId: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  fileType: string;
}

@Entity("room")
export class Room {
  @PrimaryColumn({ type: "varchar", length: 255 })
  roomId: string;

  @Column({ type: "varchar", length: 255 })
  roomTopic: string;

  @Column({ type: "text", nullable: true })
  roomDescription: string;

  @Column({ type: "varchar", length: 50, nullable: true })
  roomPassword?: string;

  @Column({ type: "varchar", unique: true })
  roomShareLink: string;

  @CreateDateColumn({ type: "timestamp with time zone" })
  createdAt: Date;

  @Column({ type: "uuid" })
  masterId: string;

  @ManyToOne(() => User, (user) => user.createdRooms)
  @JoinColumn({ name: "masterId" })
  masterUser: User;

  @Column({ type: "uuid" })
  channelId: string;

  @ManyToOne(() => Channel, (channel) => channel.rooms)
  @JoinColumn({ name: "channelId" })
  channel: Channel;

  @Column({ type: "uuid", nullable: true })
  teamId?: string;

  @ManyToOne(() => Team, (team) => team.rooms)
  @JoinColumn({ name: "teamId" })
  team?: Team;

  @Column("text", { array: true, default: [] })
  attendees: string[];

  @Column({ type: "text", nullable: true })
  token?: string;

  @OneToMany(() => File, (file) => file.room)
  files: File[];

  @OneToOne(() => RoomReport, (report) => report.room)
  report?: RoomReport;
}
