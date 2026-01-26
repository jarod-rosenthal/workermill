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

export type BoardColumnType = "backlog" | "ready" | "in_progress" | "review" | "done";

// Default column configurations
export const DEFAULT_COLUMNS: Array<{
  name: string;
  columnType: BoardColumnType;
  position: number;
  color: string;
  isDefault: boolean;
}> = [
  { name: "Backlog", columnType: "backlog", position: 0, color: "#6b7280", isDefault: false },
  { name: "Ready", columnType: "ready", position: 1, color: "#3b82f6", isDefault: true },
  { name: "In Progress", columnType: "in_progress", position: 2, color: "#f59e0b", isDefault: false },
  { name: "Review", columnType: "review", position: 3, color: "#8b5cf6", isDefault: false },
  { name: "Done", columnType: "done", position: 4, color: "#10b981", isDefault: false },
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
    // Only Ready column allows assigning to worker
    return this.columnType === "ready";
  }

  // Helper to check if this is a terminal column
  isTerminal(): boolean {
    return this.columnType === "done";
  }
}
