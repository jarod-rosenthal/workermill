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
import { Project } from "./Project.js";
import type { InternalTask } from "./InternalTask.js";
import { Organization } from "./Organization.js";

export type BoardColumnType = "backlog" | "in_progress" | "review" | "pr_approved" | "deployed";

// Default column configurations
export const DEFAULT_COLUMNS: Array<{
  name: string;
  columnType: BoardColumnType;
  position: number;
  color: string;
  isDefault: boolean;
}> = [
  { name: "Backlog", columnType: "backlog", position: 0, color: "***REMOVED***6b7280", isDefault: true },
  { name: "In Progress", columnType: "in_progress", position: 1, color: "***REMOVED***f59e0b", isDefault: false },
  { name: "Review", columnType: "review", position: 2, color: "***REMOVED***8b5cf6", isDefault: false },
  { name: "PR Approved", columnType: "pr_approved", position: 3, color: "***REMOVED***3b82f6", isDefault: false },
  { name: "Deployed", columnType: "deployed", position: 4, color: "***REMOVED***10b981", isDefault: false },
];

@Entity("board_columns")
@Index(["orgId"])
export class BoardColumn {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "project_id", type: "uuid" })
  projectId: string;

  @Column({ name: "org_id", type: "uuid", nullable: true })
  orgId: string | null;

  @ManyToOne(() => Organization, { onDelete: "CASCADE", nullable: true })
  @JoinColumn({ name: "org_id" })
  organization: Organization | null;

  @Column({ type: "varchar", length: 100 })
  name: string;

  @Column({ name: "column_type", type: "varchar", length: 30 })
  columnType: BoardColumnType;

  @Column({ type: "int" })
  position: number;

  @Column({ name: "wip_limit", type: "int", nullable: true })
  wipLimit: number | null;

  @Column({ type: "varchar", length: 20, nullable: true })
  color: string | null;

  @Column({ name: "is_default", type: "boolean", default: false })
  isDefault: boolean;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  // Relations
  @ManyToOne(() => Project, (project) => project.columns, { onDelete: "CASCADE" })
  @JoinColumn({ name: "project_id" })
  project: Project;

  @OneToMany("InternalTask", "column")
  tasks: InternalTask[];

  // Helper to check if this column allows worker assignment
  canAssignToWorker(): boolean {
    return this.columnType === "backlog";
  }

  // Helper to check if this is a terminal column
  isTerminal(): boolean {
    return this.columnType === "deployed";
  }
}
