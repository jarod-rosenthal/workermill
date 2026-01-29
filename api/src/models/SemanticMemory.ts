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
 * Memory scope - what level does this knowledge apply to?
 */
export type MemoryScope = "repository" | "organization" | "global";

/**
 * Memory category - what type of knowledge is this?
 */
export type MemoryCategory =
  | "convention"   // Coding conventions and style
  | "pattern"      // Design patterns used
  | "technology"   // Tech stack information
  | "structure"    // Codebase structure
  | "rule";        // Hard rules/constraints

/**
 * Memory source - where did this knowledge come from?
 */
export type MemorySource =
  | "inferred"     // Extracted from successful tasks
  | "explicit"     // Explicitly provided by user
  | "feedback"     // Learned from PR review feedback
  | "documentation"; // Extracted from docs

/**
 * SemanticMemory stores general knowledge about repositories, patterns, and conventions.
 * Part of the Agent Memory & Learning System (Phase 3).
 */
@Entity("semantic_memories")
@Index(["orgId", "repository"])
@Index(["scope"])
@Index(["category"])
@Index(["subject"])
export class SemanticMemory {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId!: string;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization!: Organization;

  /**
   * Repository this knowledge applies to (null = org-wide or global)
   */
  @Column({ type: "varchar", length: 255, nullable: true })
  repository!: string | null;

  /**
   * Scope of this knowledge
   */
  @Column({ type: "varchar", length: 50, default: "repository" })
  scope!: MemoryScope;

  /**
   * Category of knowledge
   */
  @Column({ type: "varchar", length: 50 })
  category!: MemoryCategory;

  /**
   * Subject/topic (e.g., "testing", "authentication", "error handling")
   */
  @Column({ type: "varchar", length: 255 })
  subject!: string;

  /**
   * The actual knowledge content
   */
  @Column({ type: "text" })
  knowledge!: string;

  /**
   * Confidence score (0-1), increases with validation
   */
  @Column({ type: "float", default: 0.5 })
  confidence!: number;

  /**
   * Source of this knowledge
   */
  @Column({ type: "varchar", length: 50, default: "inferred" })
  source!: MemorySource;

  /**
   * How many times this knowledge was confirmed/validated
   */
  @Column({ name: "evidence_count", type: "int", default: 1 })
  evidenceCount!: number;

  /**
   * Vector embedding for similarity search (stored as string, queried with pgvector)
   * Note: TypeORM doesn't natively support pgvector, so we use raw queries for vector operations
   */
  @Column({ type: "varchar", nullable: true })
  embedding!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  /**
   * When this knowledge was last validated as accurate
   */
  @Column({ name: "last_validated_at", type: "timestamptz", nullable: true })
  lastValidatedAt!: Date | null;

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
}
