import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { Organization } from "./Organization.js";

/**
 * Indexing status states
 */
export type IndexingStatus = "pending" | "indexing" | "ready" | "failed" | "stale";

/**
 * Codebase Index Status entity for tracking repository indexing state.
 * Part of the Codebase RAG system.
 */
@Entity("codebase_index_status")
@Index(["orgId"])
@Index(["status"])
@Index(["orgId", "repository"])
export class CodebaseIndexStatus {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;

  // Repository identification
  @Column({ type: "varchar", length: 255 })
  repository: string;

  @Column({ type: "varchar", length: 255, default: "main" })
  branch: string;

  // Status
  @Column({ type: "varchar", length: 50, default: "pending" })
  status: IndexingStatus;

  // Progress tracking
  @Column({ name: "total_files", type: "int", default: 0 })
  totalFiles: number;

  @Column({ name: "indexed_files", type: "int", default: 0 })
  indexedFiles: number;

  @Column({ name: "total_chunks", type: "int", default: 0 })
  totalChunks: number;

  @Column({ name: "skipped_files", type: "int", default: 0 })
  skippedFiles: number;

  // Cost tracking
  @Column({ name: "tokens_used", type: "int", default: 0 })
  tokensUsed: number;

  @Column({ name: "estimated_cost_usd", type: "decimal", precision: 10, scale: 4, default: 0 })
  estimatedCostUsd: number;

  // Timing
  @Column({ name: "started_at", type: "timestamp with time zone", nullable: true })
  startedAt: Date | null;

  @Column({ name: "completed_at", type: "timestamp with time zone", nullable: true })
  completedAt: Date | null;

  // Git state
  @Column({ name: "last_indexed_commit", type: "varchar", length: 40, nullable: true })
  lastIndexedCommit: string | null;

  // Error handling
  @Column({ name: "last_error", type: "text", nullable: true })
  lastError: string | null;

  @Column({ name: "error_count", type: "int", default: 0 })
  errorCount: number;

  // Timestamps
  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
