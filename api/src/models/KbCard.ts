import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from "typeorm";
import { KbBoard } from "./KbBoard.js";
import { KbColumn } from "./KbColumn.js";
import { User } from "./User.js";
import { WorkerTask } from "./WorkerTask.js";
import type { KbCardLabel } from "./KbCardLabel.js";
import type { KbCardDependency } from "./KbCardDependency.js";
import type { KbComment } from "./KbComment.js";
import type { KbChecklist } from "./KbChecklist.js";

export type KbCardPriority = "urgent" | "high" | "medium" | "low";

@Entity("kb_cards")
@Index(["boardId"])
@Index(["columnId"])
export class KbCard {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "board_id", type: "uuid" })
  boardId: string;

  @Column({ name: "column_id", type: "uuid" })
  columnId: string;

  @Column({ type: "varchar", length: 500 })
  title: string;

  @Column({ type: "text", nullable: true })
  description: string | null;

  @Column({ type: "int", default: 0 })
  position: number;

  @Column({ type: "varchar", length: 20, nullable: true })
  priority: KbCardPriority | null;

  @Column({ name: "due_date", type: "timestamptz", nullable: true })
  dueDate: Date | null;

  @Column({ name: "assignee_id", type: "uuid", nullable: true })
  assigneeId: string | null;

  @Column({ name: "cover_color", type: "varchar", length: 20, nullable: true })
  coverColor: string | null;

  @Column({ name: "card_number", type: "int", nullable: true })
  cardNumber: number | null;

  @Column({ name: "created_by_id", type: "uuid", nullable: true })
  createdById: string | null;

  @Column({ name: "worker_task_id", type: "uuid", nullable: true })
  workerTaskId: string | null;

  @Column({ name: "github_repo", type: "varchar", length: 255, nullable: true })
  githubRepo: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => KbBoard, { onDelete: "CASCADE" })
  @JoinColumn({ name: "board_id" })
  board: KbBoard;

  @ManyToOne(() => KbColumn, (column) => column.cards, { onDelete: "CASCADE" })
  @JoinColumn({ name: "column_id" })
  column: KbColumn;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "assignee_id" })
  assignee: User | null;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "created_by_id" })
  createdBy: User | null;

  @ManyToOne(() => WorkerTask, { onDelete: "SET NULL" })
  @JoinColumn({ name: "worker_task_id" })
  workerTask: WorkerTask | null;

  @OneToMany("KbCardLabel", "card")
  cardLabels: KbCardLabel[];

  @OneToMany("KbCardDependency", "card")
  dependencies: KbCardDependency[];

  @OneToMany("KbCardDependency", "dependsOnCard")
  dependents: KbCardDependency[];

  @OneToMany("KbComment", "card")
  comments: KbComment[];

  @OneToMany("KbChecklist", "card")
  checklistItems: KbChecklist[];
}
