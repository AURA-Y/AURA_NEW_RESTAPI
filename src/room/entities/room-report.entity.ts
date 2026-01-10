import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  OneToOne,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Room } from "./room.entity";
import { Channel } from "../../channel/entities/channel.entity";
import { Team } from "../../channel/entities/team.entity";

export enum ReportScope {
  PUBLIC = "PUBLIC",     // 전체 공개
  TEAM = "TEAM",         // 특정 팀 공개
  CHANNEL = "CHANNEL",   // 채널 전체 공개
  PRIVATE = "PRIVATE",   // 참여자만 공개
}

@Entity("room_report")
export class RoomReport {
  @PrimaryColumn({ type: "varchar", length: 255 })
  reportId: string; // roomId와 동일한 값 권장

  @Column({ type: "varchar", length: 255 })
  topic: string;

  @Column({ type: "text", nullable: true })
  description: string | null;

  @Column("text", { array: true, default: [] })
  attendees: string[];

  @CreateDateColumn({ type: "timestamp with time zone" })
  createdAt: Date;

  // 권한 범위 설정
  @Column({
    type: "enum",
    enum: ReportScope,
    default: ReportScope.CHANNEL,
  })
  shareScope: ReportScope;

  @Column("uuid", { array: true, default: [] })
  specialAuth: string[]; // 특별 열람 권한을 가진 userId 배열

  // Room 관계 (1:1)
  @Column({ type: "varchar", length: 255, unique: true })
  roomId: string;

  @OneToOne(() => Room, (room) => room.report, { onDelete: "CASCADE" })
  @JoinColumn({ name: "roomId" })
  room: Room;

  // Channel 관계 (nullable: 기존 레코드 마이그레이션 지원)
  @Column({ type: "uuid", nullable: true })
  channelId: string | null;

  @ManyToOne(() => Channel, (channel) => channel.reports, { onDelete: "CASCADE" })
  @JoinColumn({ name: "channelId" })
  channel: Channel | null;

  // Team 관계 (선택)
  @Column({ type: "uuid", nullable: true })
  teamId: string | null;

  @ManyToOne(() => Team, (team) => team.reports, { onDelete: "SET NULL" })
  @JoinColumn({ name: "teamId" })
  team: Team | null;
}
