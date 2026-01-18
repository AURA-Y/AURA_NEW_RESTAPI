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

  @Column("text", { array: true, default: [] })
  attendees: string[];

  @Column("text", { array: true, default: [] })
  tags: string[];

  @Column({ type: "timestamp with time zone", default: () => "CURRENT_TIMESTAMP"})
  createdAt: Date;

  @Column({ type: "timestamp with time zone", nullable: true })
  startedAt: Date | null;  // 회의 시작 시간

  @Column({ type: "timestamp with time zone", nullable: true })
  endedAt: Date | null;  // 회의 종료 시간

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

  // 예정 참여자 (userId + nickName) - 불참자 확인용
  @Column({ type: "jsonb", default: [] })
  expectedAttendees: Array<{
    userId: string;
    nickName: string;
  }>;

  @Column({ type: "uuid", nullable: true })
  masterId: string | null;  // Host 구분용 (Room 삭제 후에도 유지)

  // 업로드된 파일 목록 (JSONB)
  @Column({ type: "jsonb", default: [] })
  uploadFileList: Array<{
    fileId: string;
    fileName: string;
    fileUrl: string;
    fileSize: number;
    createdAt: string;
  }>;

  // 이전 회의에서 참조한 파일 목록 (JSONB)
  @Column({ type: "jsonb", default: [] })
  referencedFiles: Array<{
    fileId: string;
    fileName: string;
    fileUrl: string;
    fileSize: number;
    createdAt: string;
    sourceRoomId?: string;
  }>;

  @BeforeInsert()
  setDefaults() {
    if (!this.createdAt) {
      this.createdAt = new Date();
    }
    if (!this.attendees) {
      this.attendees = [];
    }
    if (!this.expectedAttendees) {
      this.expectedAttendees = [];
    }
    if (!this.tags) {
      this.tags = [];
    }
    if (!this.specialAuth) {
      this.specialAuth = [];
    }
    if (!this.uploadFileList) {
      this.uploadFileList = [];
    }
    if (!this.referencedFiles) {
      this.referencedFiles = [];
    }
  }

  // Room과의 FK 관계 제거됨 - Room 삭제해도 Report는 유지됨

  @ManyToOne(() => Channel, (channel) => channel.reports, { onDelete: "CASCADE" })
  @JoinColumn({ name: "channelId" })
  channel: Channel;

  // participantUserIds는 UUID 배열이므로 ManyToOne 관계 대신 배열로 관리
}
