import {
  Entity,
  PrimaryColumn,
  Column,
  ManyToOne,
  JoinColumn,
  BeforeInsert,
} from "typeorm";
import { User } from "../../auth/entities/user.entity";
import { Channel } from "./channel.entity";
import { v4 as uuidv4 } from "uuid";

export enum JoinRequestStatus {
  PENDING = "PENDING",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
}

@Entity("JoinRequest")
export class JoinRequest {
  @PrimaryColumn({ type: "uuid" })
  id: string;

  @Column({ type: "uuid" })
  userId: string;

  @Column({ type: "uuid" })
  channelId: string;

  @Column({
    type: "enum",
    enum: JoinRequestStatus,
    default: JoinRequestStatus.PENDING,
  })
  status: JoinRequestStatus;

  @Column({ type: "timestamp with time zone", default: () => "CURRENT_TIMESTAMP" })
  createdAt: Date;

  @Column({ type: "timestamp with time zone", nullable: true })
  processedAt: Date | null;

  @Column({ type: "timestamp with time zone", nullable: true })
  expiresAt: Date | null;

  @BeforeInsert()
  setDefaults() {
    if (!this.id) {
      this.id = uuidv4();
    }
    if (!this.createdAt) {
      this.createdAt = new Date();
    }
  }

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user: User;

  @ManyToOne(() => Channel, (channel) => channel.joinRequests, { onDelete: "CASCADE" })
  @JoinColumn({ name: "channelId" })
  channel: Channel;
}
