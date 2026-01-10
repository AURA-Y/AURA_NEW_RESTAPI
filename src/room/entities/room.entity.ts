import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToOne,
  OneToMany,
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
  roomId: string; // LiveKit roomId (UUID 형식 권장)

  @Column({ type: "varchar", length: 255, nullable: false })
  roomTopic: string; // 방 제목 (표시용)

  @Column({ type: "text", nullable: true })
  roomDescription: string | null;

  @Column({ type: "varchar", length: 50, nullable: true })
  roomPassword: string | null;

  @Column({ type: "varchar", length: 255, unique: true })
  roomShareLink: string; // 공유 링크

  @CreateDateColumn({ type: "timestamp with time zone" })
  createdAt: Date;

  // 방장 정보 (nullable: 기존 레코드 마이그레이션 지원)
  @Column({ type: "uuid", nullable: false })
  masterId: string;

  @ManyToOne(() => User, (user) => user.createdRooms, { onDelete: "CASCADE" })
  @JoinColumn({ name: "masterId" })
  master: User;

  // 채널 소속 (선택 - 자동 생성 시 null 가능)
  @Column({ type: "uuid", nullable: false })
  channelId: string;

  @ManyToOne(() => Channel, (channel) => channel.rooms, { onDelete: "CASCADE" })
  @JoinColumn({ name: "channelId" })
  channel: Channel | null;

  // 팀 소속 (선택)
  @Column({ type: "uuid", nullable: true })
  teamId: string | null;

  @ManyToOne(() => Team, (team) => team.rooms, { onDelete: "SET NULL" })
  @JoinColumn({ name: "teamId" })
  team: Team | null;

  // 회의 데이터
  @Column("text", { array: true, default: [] })
  attendees: string[]; // 참석자 닉네임 배열

  @Column({ type: "text", nullable: true })
  token: string | null; // 미디어 서버 접속용 토큰

  // 파일 및 리포트
  @OneToMany(() => File, (file) => file.room)
  files: File[];

  @OneToOne(() => RoomReport, (report) => report.room)
  report: RoomReport | null;
}
