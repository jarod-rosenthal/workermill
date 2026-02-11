import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { KbBoard } from "./KbBoard.js";
import { User } from "./User.js";

@Entity("kb_activities")
@Index(["boardId"])
export class KbActivity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "board_id", type: "uuid" })
  boardId: string;

  @Column({ name: "user_id", type: "uuid", nullable: true })
  userId: string | null;

  @Column({ type: "varchar", length: 50 })
  action: string;

  @Column({ name: "entity_type", type: "varchar", length: 50 })
  entityType: string;

  @Column({ name: "entity_id", type: "uuid", nullable: true })
  entityId: string | null;

  @Column({ type: "jsonb", nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  // Relations
  @ManyToOne(() => KbBoard, (board) => board.activities, { onDelete: "CASCADE" })
  @JoinColumn({ name: "board_id" })
  board: KbBoard;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "user_id" })
  user: User | null;
}
