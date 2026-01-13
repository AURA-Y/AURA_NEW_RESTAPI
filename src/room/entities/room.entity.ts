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

  @Column({ type: "text", nullable: true })
  roomDescription: string | null;

  @Column({ type: "varchar", length: 50, nullable: true })
  roomPassword: string | null;

  @Column({ type: "varchar", length: 255, unique: true })
  roomShareLink: string;

  @Column({ type: "timestamp with time zone", default: () => "NOW()" })
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
  }

  @ManyToOne(() => User, (user) => user.createdRooms, { onDelete: "CASCADE" })
  @JoinColumn({ name: "masterId" })
  master: User;

  @ManyToOne(() => Channel, (channel) => channel.rooms, { onDelete: "CASCADE" })
  @JoinColumn({ name: "channelId" })
  channel: Channel | null;

  // RoomReport와의 FK 관계 제거됨 - Room 삭제해도 Report는 유지됨
}
