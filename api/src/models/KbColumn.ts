import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from "typeorm";
import { KbBoard } from "./KbBoard.js";
import type { KbCard } from "./KbCard.js";

@Entity("kb_columns")
@Index(["boardId"])
export class KbColumn {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "board_id", type: "uuid" })
  boardId: string;

  @Column({ type: "varchar", length: 100 })
  name: string;

  @Column({ type: "int" })
  position: number;

  @Column({ type: "varchar", length: 20, nullable: true })
  color: string | null;

  @Column({ name: "wip_limit", type: "int", nullable: true })
  wipLimit: number | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  // Relations
  @ManyToOne(() => KbBoard, (board) => board.columns, { onDelete: "CASCADE" })
  @JoinColumn({ name: "board_id" })
  board: KbBoard;

  @OneToMany("KbCard", "column")
  cards: KbCard[];
}
