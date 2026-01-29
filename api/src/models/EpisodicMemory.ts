import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { Organization } from "./Organization.js";
import { WorkerTask } from "./WorkerTask.js";

/**
 * Event types for episodic memories
 */
export type EpisodicEventType =
  | "task_completed"    // Task finished successfully
  | "task_failed"       // Task failed
  | "approach_worked"   // A specific approach/technique worked
  | "approach_failed"   // A specific approach/technique failed
  | "error_resolved"    // An error was encountered and resolved
  | "pattern_discovered"; // A new pattern/convention was discovered

/**
 * Outcome of the experience
 */
export type EpisodicOutcome = "success" | "failure" | "partial";

/**
 * Structured details for episodic memories
 */
export interface EpisodicDetails {
  filesAffected?: string[];
  error?: string;
  correctApproach?: string;
  toolsUsed?: string[];
  retriesNeeded?: number;
  [key: string]: unknown;
}

/**
 * EpisodicMemory stores task-specific experiences - what happened, what worked, what failed.
 * Part of the Agent Memory & Learning System (Phase 3).
 */
@Entity("episodic_memories")
@Index(["orgId", "repository"])
@Index(["eventType"])
@Index(["outcome"])
@Index(["taskId"])
export class EpisodicMemory {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId!: string;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization!: Organization;

  /**
   * The task this experience came from (optional - may be manually created)
   */
  @Column({ name: "task_id", type: "uuid", nullable: true })
  taskId!: string | null;

  @ManyToOne(() => WorkerTask, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "task_id" })
  task!: WorkerTask | null;

  /**
   * Repository this experience relates to
   */
  @Column({ type: "varchar", length: 255 })
  repository!: string;

  /**
   * Type of event/experience
   */
  @Column({ name: "event_type", type: "varchar", length: 50 })
  eventType!: EpisodicEventType;

  /**
   * Human-readable summary of what happened
   */
  @Column({ type: "text" })
  summary!: string;

  /**
   * Structured details (error messages, file paths, etc.)
   */
  @Column({ type: "jsonb", nullable: true })
  details!: EpisodicDetails | null;

  /**
   * Outcome: did this work or fail?
   */
  @Column({ type: "varchar", length: 20 })
  outcome!: EpisodicOutcome;

  /**
   * Why it succeeded or failed
   */
  @Column({ name: "outcome_details", type: "text", nullable: true })
  outcomeDetails!: string | null;

  /**
   * Vector embedding for similarity search
   * Note: TypeORM doesn't natively support pgvector, so we use raw queries for vector operations
   */
  @Column({ type: "varchar", nullable: true })
  embedding!: string | null;

  /**
   * Which persona created this memory
   */
  @Column({ type: "varchar", length: 50, nullable: true })
  persona!: string | null;

  /**
   * Which model was used
   */
  @Column({ type: "varchar", length: 100, nullable: true })
  model!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  /**
   * How many times this memory has been retrieved
   */
  @Column({ name: "retrieval_count", type: "int", default: 0 })
  retrievalCount!: number;

  /**
   * When this memory was last retrieved
   */
  @Column({ name: "last_retrieved_at", type: "timestamptz", nullable: true })
  lastRetrievedAt!: Date | null;

  /**
   * How often retrieval of this memory led to successful task outcomes
   */
  @Column({ name: "effectiveness_score", type: "float", nullable: true })
  effectivenessScore!: number | null;
}
