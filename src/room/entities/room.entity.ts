import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';

export interface UploadFileItem {
  fileId: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  fileType: string;
}

@Entity('room')
export class Room {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  roomId: string;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;

  @Column({ type: 'varchar', length: 500 })
  topic: string;

  @Column({ type: 'jsonb', default: [] })
  upload_File_list: UploadFileItem[];

  @Column('text', { array: true, default: [] })
  attendees: string[];

  @Column({ type: 'integer', default: 20 })
  maxParticipants: number;

  @Column({ type: 'text', nullable: true })
  token: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  livekitUrl: string;

  @Column({ type: 'uuid' })
  master: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'master' })
  masterUser: User;
}
