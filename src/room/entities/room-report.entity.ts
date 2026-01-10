import { Entity, PrimaryColumn, Column, CreateDateColumn, OneToOne, JoinColumn, ManyToOne } from 'typeorm';
import { Room } from './room.entity';
import { Channel } from '../../channel/entities/channel.entity';
import { Team } from '../../channel/entities/team.entity';

export enum ReportScope {
  PUBLIC = "PUBLIC",
  TEAM = "TEAM",
  CHANNEL = "CHANNEL",
  PRIVATE = "PRIVATE",
}

@Entity("room_report")
export class RoomReport {
  @PrimaryColumn({ type: "varchar", length: 255 })
  reportId: string;

  @Column({ type: "varchar", length: 255 })
  topic: string;

  @Column({ type: "text", nullable: true })
  description: string;

  @Column("text", { array: true, default: [] })
  attendees: string[];

  @CreateDateColumn({ type: "timestamp with time zone" })
  createdAt: Date;

  @Column({ type: "enum", enum: ReportScope, default: ReportScope.CHANNEL })
  shareScope: ReportScope;

  @Column("uuid", { array: true, default: [] })
  specialAuth: string[];

  @Column({ type: "varchar", length: 255, unique: true })
  roomId: string;

  @OneToOne(() => Room, (room) => room.report)
  @JoinColumn({ name: "roomId" })
  room: Room;

  @Column({ type: "uuid" })
  channelId: string;

  @ManyToOne(() => Channel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: "channelId" })
  channel: Channel;

  @Column({ type: "uuid", nullable: true })
  teamId: string;

  @ManyToOne(() => Team, { onDelete: 'SET NULL' })
  @JoinColumn({ name: "teamId" })
  team: Team;
}
