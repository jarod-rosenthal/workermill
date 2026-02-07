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
import { WorkerTask } from "./WorkerTask.js";

/**
 * A single step in a procedural skill
 */
export interface SkillStep {
  step: number;
  action: string;
  details?: string;
  example?: string;
}

/**
 * Prerequisites for using a skill
 */
export interface SkillPrerequisites {
  filesMustExist?: string[];
  dependencies?: string[];
  technologies?: string[];
  [key: string]: unknown;
}

/**
 * Conditions when a skill is applicable
 */
export interface SkillApplicability {
  taskTypes?: string[];
  technologies?: string[];
  keywords?: string[];
  filePatterns?: string[];
  [key: string]: unknown;
}

/**
 * ProceduralMemory stores reusable procedures (skills) extracted from successful tasks.
 * Part of the Agent Memory & Learning System (Phase 3).
 */
@Entity("procedural_memories")
@Index(["orgId", "repository"])
@Index(["orgId", "slug"])
export class ProceduralMemory {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId!: string;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization!: Organization;

  /**
   * Human-readable name of the skill
   */
  @Column({ type: "varchar", length: 255 })
  name!: string;

  /**
   * URL-safe identifier for the skill
   */
  @Column({ type: "varchar", length: 255 })
  slug!: string;

  /**
   * Description of what this skill does
   */
  @Column({ type: "text" })
  description!: string;

  /**
   * Raw learning text from worker self-reported ::learning:: markers.
   * Contains the actionable insight discovered during task execution.
   */
  @Column({ type: "text", nullable: true })
  insight!: string | null;

  /**
   * Repository this skill applies to (null = applies to any repo)
   */
  @Column({ type: "varchar", length: 255, nullable: true })
  repository!: string | null;

  /**
   * Conditions when this skill is applicable
   */
  @Column({ name: "applicable_to", type: "jsonb", nullable: true })
  applicableTo!: SkillApplicability | null;

  /**
   * The ordered steps of the procedure
   */
  @Column({ type: "jsonb" })
  steps!: SkillStep[];

  /**
   * Prerequisites that must be met before using this skill
   */
  @Column({ type: "jsonb", nullable: true })
  prerequisites!: SkillPrerequisites | null;

  /**
   * The task this skill was extracted from
   */
  @Column({ name: "source_task_id", type: "uuid", nullable: true })
  sourceTaskId!: string | null;

  @ManyToOne(() => WorkerTask, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "source_task_id" })
  sourceTask!: WorkerTask | null;

  /**
   * When this skill was extracted
   */
  @Column({ name: "extracted_at", type: "timestamptz", default: () => "NOW()" })
  extractedAt!: Date;

  /**
   * Number of times this skill was used successfully
   */
  @Column({ name: "success_count", type: "int", default: 0 })
  successCount!: number;

  /**
   * Number of times this skill failed when used
   */
  @Column({ name: "failure_count", type: "int", default: 0 })
  failureCount!: number;

  /**
   * Calculated success rate (stored/computed by database)
   * Note: This is a generated column in PostgreSQL
   */
  @Column({ name: "success_rate", type: "float", nullable: true, insert: false, update: false })
  successRate!: number | null;

  /**
   * Vector embedding for similarity search
   */
  @Column({ type: "varchar", nullable: true })
  embedding!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  /**
   * How many times this skill has been retrieved
   */
  @Column({ name: "retrieval_count", type: "int", default: 0 })
  retrievalCount!: number;

  /**
   * When this skill was last retrieved
   */
  @Column({ name: "last_retrieved_at", type: "timestamptz", nullable: true })
  lastRetrievedAt!: Date | null;

  /**
   * When this skill was last actually used in a task
   */
  @Column({ name: "last_used_at", type: "timestamptz", nullable: true })
  lastUsedAt!: Date | null;
}
