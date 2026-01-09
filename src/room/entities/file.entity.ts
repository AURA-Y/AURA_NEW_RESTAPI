import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Room } from "./room.entity";

@Entity("file")
export class File {
  @PrimaryGeneratedColumn("uuid")
  fileId: string;

  @Column({ type: "varchar", length: 255 })
  fileName: string;

  @Column({ type: "text" })
  fileUrl: string;

  @Column({ type: "integer" })
  fileSize: number;

  @CreateDateColumn({ type: "timestamp with time zone" })
  createdAt: Date;

  @Column({ type: "varchar", length: 255 })
  roomId: string;

  @ManyToOne(() => Room, (room) => room.files, { onDelete: "CASCADE" })
  @JoinColumn({ name: "roomId" })
  room: Room;
}
