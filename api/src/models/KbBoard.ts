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
import { Organization } from "./Organization.js";
import { User } from "./User.js";
import type { KbColumn } from "./KbColumn.js";
import type { KbStarredBoard } from "./KbStarredBoard.js";
import type { KbActivity } from "./KbActivity.js";

export type BoardPriority = "urgent" | "high" | "medium" | "low";
export type BoardStatus = "active" | "completed" | "archived";

@Entity("kb_boards")
@Index(["orgId"])
export class KbBoard {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ type: "varchar", length: 200 })
  name: string;

  @Column({ type: "text", nullable: true })
  description: string | null;

  @Column({ type: "int", default: 0 })
  position: number;

  @Column({ type: "varchar", length: 50, nullable: true })
  template: string | null;

  @Column({ name: "prd_content", type: "text", nullable: true })
  prdContent: string | null;

  @Column({ name: "prd_source", type: "varchar", length: 20, nullable: true })
  prdSource: string | null;

  @Column({ name: "github_repo", type: "varchar", length: 255, nullable: true })
  githubRepo: string | null;

  @Column({ type: "varchar", length: 10 })
  prefix: string;

  @Column({ name: "next_card_number", type: "int", default: 1 })
  nextCardNumber: number;

  @Column({ type: "jsonb", default: () => "'{}'" })
  metadata: {
    qualityGates?: {
      name: string;
      trigger: string;
      commands: string[];
    }[];
    ciWorkflowPath?: string;
  };

  // First-class quality gate fields (migrated from metadata JSONB)
  @Column({ name: "quality_gate_commands", type: "jsonb", nullable: true })
  qualityGateCommands: Array<{ name: string; trigger: string; commands: string[] }> | null;

  @Column({ name: "ci_workflow_path", type: "varchar", length: 500, nullable: true })
  ciWorkflowPath: string | null;

  // Epic ticket fields
  @Column({ type: "varchar", length: 20, nullable: true })
  priority: BoardPriority | null;

  @Column({ name: "due_date", type: "timestamptz", nullable: true })
  dueDate: Date | null;

  @Column({ name: "assignee_id", type: "uuid", nullable: true })
  assigneeId: string | null;

  @Column({ type: "varchar", length: 50, default: "active" })
  status: BoardStatus;

  @Column({ name: "spec_id", type: "uuid", nullable: true })
  specId: string | null;

  @Column({ name: "created_by", type: "uuid", nullable: true })
  createdById: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "created_by" })
  createdBy: User | null;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "assignee_id" })
  assignee: User | null;

  @OneToMany("KbColumn", "board")
  columns: KbColumn[];

  @OneToMany("KbStarredBoard", "board")
  starredBy: KbStarredBoard[];

  @OneToMany("KbActivity", "board")
  activities: KbActivity[];
}
