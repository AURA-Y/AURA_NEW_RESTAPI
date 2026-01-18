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

  @Column("text", { array: true, default: [] })
  attendees: string[];

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
    if (!this.uploadFileList) {
      this.uploadFileList = [];
    }
    if (!this.referencedFiles) {
      this.referencedFiles = [];
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
