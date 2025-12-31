import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('user')
export class User {
  @PrimaryGeneratedColumn('uuid')
  userId: string;

  @Column({ type: 'varchar', length: 255 })
  userPassword: string;

  @Column({ type: 'varchar', length: 100 })
  nickName: string;

  @Column('text', { array: true, default: [] })
  roomReportIdxList: string[];
}
