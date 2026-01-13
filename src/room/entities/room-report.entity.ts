import {
  Entity,
  PrimaryColumn,
  Column,
  ManyToOne,
  JoinColumn,
  BeforeInsert,
} from "typeorm";
import { Channel } from "../../channel/entities/channel.entity";

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

  @Column("text", { array: true, default: [] })
  tags: string[];

  @Column({ type: "timestamp with time zone", default: () => "CURRENT_TIMESTAMP"})
  createdAt: Date;

  @Column({
    type: "enum",
    enum: ReportScope,
    default: ReportScope.CHANNEL,
  })
  shareScope: ReportScope;

  @Column("uuid", { array: true, default: [] })
  specialAuth: string[];

  // roomId는 FK 없이 단순 문자열로 저장 (Room 삭제 시 Report 유지)
  @Column({ type: "varchar", length: 255, unique: true })
  roomId: string;

  @Column({ type: "uuid", nullable: false })
  channelId: string;

  @Column("uuid", { array: true, default: [] })
  participantUserIds: string[];  // 빈 배열 = 전체 공개, 값이 있으면 해당 유저만 접근 가능

  @BeforeInsert()
  setDefaults() {
    if (!this.createdAt) {
      this.createdAt = new Date();
    }
    if (!this.attendees) {
      this.attendees = [];
    }
    if (!this.tags) {
      this.tags = [];
    }
    if (!this.specialAuth) {
      this.specialAuth = [];
    }
  }

  // Room과의 FK 관계 제거됨 - Room 삭제해도 Report는 유지됨

  @ManyToOne(() => Channel, (channel) => channel.reports, { onDelete: "CASCADE" })
  @JoinColumn({ name: "channelId" })
  channel: Channel;

  // participantUserIds는 UUID 배열이므로 ManyToOne 관계 대신 배열로 관리
}
