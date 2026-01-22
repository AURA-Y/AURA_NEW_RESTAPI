import {
  Entity,
  PrimaryColumn,
  Column,
  ManyToOne,
  JoinColumn,
  BeforeInsert,
} from "typeorm";
import { User } from "../../auth/entities/user.entity";
import { Channel } from "../../channel/entities/channel.entity";

@Entity("Room")
export class Room {
  @PrimaryColumn({ type: "varchar", length: 255 })
  roomId: string; // 백엔드에서 직접 생성 (room- 형식)

  @Column({ type: "varchar", length: 255, nullable: false })
  roomTopic: string;

  @Column({ type: "varchar", length: 50, nullable: true })
  roomPassword: string | null;

  @Column({ type: "varchar", length: 255, unique: true, default: () => "gen_random_uuid()" })
  roomShareLink: string;

  @Column({ type: "timestamp with time zone", default: () => "CURRENT_TIMESTAMP" })
  createdAt: Date;

  @Column({ type: "uuid", nullable: false })
  masterId: string;

  @Column({ type: "uuid", nullable: false })
  channelId: string;

  @Column("uuid", { array: true, default: [] })
  participantUserIds: string[];  // 빈 배열 = 전체 공개, 값이 있으면 해당 유저만 접근 가능

  // 예정 참여자 (userId + nickName)
  @Column({ type: "jsonb", default: [] })
  expectedAttendees: Array<{
    userId: string;
    nickName: string;
  }>;

  @Column("text", { array: true, default: [] })
  attendees: string[];  // 실제 참석자 (닉네임 목록)

  @Column({ type: "text", nullable: true })
  token: string | null;

  @Column("text", { array: true, default: [] })
  tags: string[];

  // 파일 (JSON 형태로 저장)
  // [{fileId, fileName, fileUrl, fileSize, createdAt}, ...]
  @Column({ type: "jsonb", default: [] })
  uploadFileList: Array<{
    fileId: string;
    fileName: string;
    fileUrl: string;
    fileSize: number;
    createdAt: string;
  }>;

  // 이전 회의에서 참조한 파일 (LiveKit 방에서만 사용, 첨부파일로 표시 안 함)
  @Column({ type: "jsonb", default: [] })
  referencedFiles: Array<{
    fileId: string;
    fileName: string;
    fileUrl: string;
    fileSize: number;
    createdAt: string;
    sourceRoomId?: string;  // 원본 회의 ID
  }>;

  // 예약 관련 필드
  @Column({ type: "timestamp with time zone", nullable: true })
  scheduledAt: Date | null;  // 예약된 시작 시간 (null = 즉시 생성)

  @Column({ type: "int", nullable: true })
  duration: number | null;  // 예약된 진행 시간 (분)

  @Column({
    type: "enum",
    enum: ["SCHEDULED", "ACTIVE", "ENDED", "CANCELLED"],
    default: "ACTIVE"
  })
  status: "SCHEDULED" | "ACTIVE" | "ENDED" | "CANCELLED";

  @Column({ type: "varchar", length: 255, nullable: true })
  calendarEventId: string | null;  // Google Calendar 이벤트 ID

  @Column({ type: "varchar", length: 255, nullable: true })
  jobId: string | null;  // BullMQ Job ID (취소용)

  // 반복 예약 관련 필드
  @Column({
    type: "enum",
    enum: ["NONE", "DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY"],
    default: "NONE"
  })
  recurrenceRule: "NONE" | "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";

  @Column({ type: "timestamp with time zone", nullable: true })
  recurrenceEndDate: Date | null;  // 반복 종료일 (null = 무한 반복하지 않음)

  @Column({ type: "varchar", length: 255, nullable: true })
  parentRoomId: string | null;  // 반복 회의의 원본 roomId (시리즈 추적용)

  @Column({ type: "int", default: 0 })
  recurrenceIndex: number;  // 반복 회의 인덱스 (0 = 원본, 1, 2, 3... = 반복된 회의)

  @BeforeInsert()
  setDefaults() {
    if (!this.createdAt) {
      this.createdAt = new Date();
    }
    if (!this.expectedAttendees) {
      this.expectedAttendees = [];
    }
    if (!this.attendees) {
      this.attendees = [];
    }
    if (!this.tags) {
      this.tags = [];
    }
    if (!this.uploadFileList) {
      this.uploadFileList = [];
    }
    if (!this.referencedFiles) {
      this.referencedFiles = [];
    }
    if (!this.status) {
      this.status = "ACTIVE";
    }
  }

  @ManyToOne(() => User, (user) => user.createdRooms, { onDelete: "CASCADE" })
  @JoinColumn({ name: "masterId" })
  master: User;

  @ManyToOne(() => Channel, (channel) => channel.rooms, { onDelete: "CASCADE" })
  @JoinColumn({ name: "channelId" })
  channel: Channel | null;

  // RoomReport와의 FK 관계 제거됨 - Room 삭제해도 Report는 유지됨
}
