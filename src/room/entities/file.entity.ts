import {
  Entity,
  PrimaryColumn,
  Column,
  ManyToOne,
  JoinColumn,
  BeforeInsert,
} from "typeorm";
import { Room } from "./room.entity";
import { v4 as uuidv4 } from "uuid";

@Entity("File")
export class File {
  @PrimaryColumn({ type: "uuid" })
  fileId: string;

  @Column({ type: "varchar", length: 255 })
  fileName: string;

  @Column({ type: "text" })
  fileUrl: string;

  @Column({ type: "integer" })
  fileSize: number;

  @Column({ type: "timestamp with time zone", default: () => "CURRENT_TIMESTAMP" })
  createdAt: Date;

  @Column({ type: "varchar", length: 255 })
  roomId: string;

  @BeforeInsert()
  setDefaults() {
    if (!this.fileId) {
      this.fileId = uuidv4();
    }
    if (!this.createdAt) {
      this.createdAt = new Date();
    }
  }

  @ManyToOne(() => Room, (room) => room.files, { onDelete: "CASCADE" })
  @JoinColumn({ name: "roomId" })
  room: Room;
}
