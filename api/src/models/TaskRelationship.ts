import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from "typeorm";
import { Organization } from "./Organization.js";
import { WorkerTask } from "./WorkerTask.js";

/**
 * Type of relationship between tasks
 */
export type TaskRelationshipType =
  | "similar_to"         // Tasks are conceptually similar
  | "depends_on"         // Target task depends on source task
  | "parent_of"          // Source task is parent (epic) of target (story)
  | "shares_pattern"     // Tasks share implementation patterns
  | "shares_technology"  // Tasks use the same technologies
  | "preceded_by"        // Temporal relationship - task came before
  | "related_to"         // General relationship
  | "blocks"             // Source task blocks target
  | "duplicates";        // Tasks are duplicates

/**
 * Source of how the relationship was discovered
 */
export type RelationshipSource =
  | "inferred"      // Auto-discovered from task content
  | "explicit"      // Manually defined
  | "jira"          // From Jira links
  | "linear"        // From Linear relations
  | "github"        // From GitHub references
  | "similarity";   // From embedding similarity

/**
 * Metadata for task relationships
 */
export interface TaskRelationshipMetadata {
  reason?: string;
  sharedTechnologies?: string[];
  sharedPatterns?: string[];
  similarityScore?: number;
  jiraLinkType?: string;
  githubReference?: string;
  [key: string]: unknown;
}

/**
 * TaskRelationship stores edges in the task knowledge graph.
 * Part of the Agent Memory & Learning System (Phase 3) - REQ-12.
 */
@Entity("task_relationships")
@Index(["orgId", "sourceTaskId"])
@Index(["orgId", "targetTaskId"])
@Index(["relationshipType"])
@Unique(["sourceTaskId", "targetTaskId", "relationshipType"])
export class TaskRelationship {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId!: string;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization!: Organization;

  /**
   * Source task (from side of the relationship)
   */
  @Column({ name: "source_task_id", type: "uuid" })
  sourceTaskId!: string;

  @ManyToOne(() => WorkerTask, { onDelete: "CASCADE" })
  @JoinColumn({ name: "source_task_id" })
  sourceTask!: WorkerTask;

  /**
   * Target task (to side of the relationship)
   */
  @Column({ name: "target_task_id", type: "uuid" })
  targetTaskId!: string;

  @ManyToOne(() => WorkerTask, { onDelete: "CASCADE" })
  @JoinColumn({ name: "target_task_id" })
  targetTask!: WorkerTask;

  /**
   * Type of relationship
   */
  @Column({ name: "relationship_type", type: "varchar", length: 50 })
  relationshipType!: TaskRelationshipType;

  /**
   * Strength/weight of the relationship (0-1)
   */
  @Column({ type: "float", default: 1.0 })
  strength!: number;

  /**
   * Additional metadata about the relationship
   */
  @Column({ type: "jsonb", default: {} })
  metadata!: TaskRelationshipMetadata;

  /**
   * How the relationship was discovered
   */
  @Column({ type: "varchar", length: 30, default: "inferred" })
  source!: RelationshipSource;

  /**
   * Confidence in the relationship (0-1)
   */
  @Column({ type: "float", default: 0.7 })
  confidence!: number;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
