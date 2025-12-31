import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('room_report')
export class RoomReport {
  @PrimaryGeneratedColumn('uuid')
  reportId: string;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt: Date;

  @Column({ type: 'varchar', length: 500 })
  topic: string;

  @Column('text', { array: true, default: [] })
  attendees: string[];
}
