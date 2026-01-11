import {
  Entity,
  PrimaryColumn,
  Column,
  ManyToOne,
  OneToOne,
  OneToMany,
  JoinColumn,
  BeforeInsert,
} from "typeorm";
import { User } from "../../auth/entities/user.entity";
import { Channel } from "../../channel/entities/channel.entity";
import { Team } from "../../channel/entities/team.entity";
import { RoomReport } from "./room-report.entity";
import { File } from "./file.entity";

@Entity("Room")
export class Room {
  @PrimaryColumn({ type: "varchar", length: 255 })
  roomId: string; // 백엔드에서 직접 생성 (room- 형식)

  @Column({ type: "varchar", length: 255, nullable: false })
  roomTopic: string;

  @Column({ type: "text", nullable: true })
  roomDescription: string | null;

  @Column({ type: "varchar", length: 50, nullable: true })
  roomPassword: string | null;

  @Column({ type: "varchar", length: 255, unique: true })
  roomShareLink: string;

  @Column({ type: "timestamp with time zone" })
  createdAt: Date;

  @Column({ type: "uuid", nullable: false })
  masterId: string;

  @Column({ type: "uuid", nullable: false })
  channelId: string;

  @Column({ type: "uuid", nullable: true })
  teamId: string | null;

  @Column("text", { array: true, default: [] })
  attendees: string[];

  @Column({ type: "text", nullable: true })
  token: string | null;

  @BeforeInsert()
  setDefaults() {
    if (!this.createdAt) {
      this.createdAt = new Date();
    }
    if (!this.attendees) {
      this.attendees = [];
    }
  }

  @ManyToOne(() => User, (user) => user.createdRooms, { onDelete: "CASCADE" })
  @JoinColumn({ name: "masterId" })
  master: User;

  @ManyToOne(() => Channel, (channel) => channel.rooms, { onDelete: "CASCADE" })
  @JoinColumn({ name: "channelId" })
  channel: Channel | null;

  @ManyToOne(() => Team, (team) => team.rooms, { onDelete: "SET NULL" })
  @JoinColumn({ name: "teamId" })
  team: Team | null;

  @OneToMany(() => File, (file) => file.room)
  files: File[];

  @OneToOne(() => RoomReport, (report) => report.room)
  report: RoomReport | null;
}
