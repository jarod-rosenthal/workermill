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
 * Type of PR feedback
 */
export type PrFeedbackType =
  | "review_comment"     // Inline code review comment
  | "review_approved"    // PR approved
  | "review_rejected"    // PR rejected/changes requested
  | "general_comment"    // General PR comment (not inline)
  | "suggestion";        // Code suggestion from reviewer

/**
 * Source SCM provider
 */
export type PrFeedbackSource = "github" | "gitlab" | "bitbucket";

/**
 * Resolution status for suggestions (REQ-6: Capture Accepted vs Rejected Suggestions)
 */
export type PrFeedbackResolution =
  | "pending"              // Not yet resolved
  | "accepted"             // Suggestion was applied as-is
  | "rejected"             // Suggestion was dismissed/not applied
  | "partially_accepted";  // Suggestion was modified and partially applied

/**
 * PrFeedback stores PR review comments on AI-generated code.
 * Part of the Agent Memory & Learning System (Phase 3) - Feedback Learning.
 */
@Entity("pr_feedback")
@Index(["orgId", "taskId"])
@Index(["orgId", "repository"])
@Index(["feedbackType"])
@Index(["createdAt"])
export class PrFeedback {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId!: string;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization!: Organization;

  /**
   * The task that created the PR
   */
  @Column({ name: "task_id", type: "uuid", nullable: true })
  taskId!: string | null;

  @ManyToOne(() => WorkerTask, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "task_id" })
  task!: WorkerTask | null;

  /**
   * Repository the PR is in
   */
  @Column({ type: "varchar", length: 255 })
  repository!: string;

  /**
   * PR number
   */
  @Column({ name: "pr_number", type: "int" })
  prNumber!: number;

  /**
   * PR URL for reference
   */
  @Column({ name: "pr_url", type: "varchar", length: 500, nullable: true })
  prUrl!: string | null;

  /**
   * Type of feedback
   */
  @Column({ name: "feedback_type", type: "varchar", length: 50 })
  feedbackType!: PrFeedbackType;

  /**
   * Source SCM provider
   */
  @Column({ type: "varchar", length: 20 })
  source!: PrFeedbackSource;

  /**
   * The actual comment/feedback content
   */
  @Column({ type: "text" })
  content!: string;

  /**
   * File path if this is an inline comment
   */
  @Column({ name: "file_path", type: "varchar", length: 500, nullable: true })
  filePath!: string | null;

  /**
   * Line number if this is an inline comment
   */
  @Column({ name: "line_number", type: "int", nullable: true })
  lineNumber!: number | null;

  /**
   * Code snippet the comment refers to
   */
  @Column({ name: "code_snippet", type: "text", nullable: true })
  codeSnippet!: string | null;

  /**
   * Who left the feedback
   */
  @Column({ name: "reviewer_username", type: "varchar", length: 255 })
  reviewerUsername!: string;

  /**
   * Whether this feedback was addressed/resolved
   */
  @Column({ name: "is_resolved", type: "boolean", default: false })
  isResolved!: boolean;

  /**
   * External ID from the SCM (comment ID, review ID, etc.)
   */
  @Column({ name: "external_id", type: "varchar", length: 100, nullable: true })
  externalId!: string | null;

  /**
   * Persona that generated the code being reviewed
   */
  @Column({ type: "varchar", length: 50, nullable: true })
  persona!: string | null;

  /**
   * Model that generated the code being reviewed
   */
  @Column({ type: "varchar", length: 100, nullable: true })
  model!: string | null;

  /**
   * Resolution status for suggestions (REQ-6)
   * pending = not yet resolved
   * accepted = suggestion was applied as-is
   * rejected = suggestion was dismissed
   * partially_accepted = suggestion was modified and partially applied
   */
  @Column({ name: "resolution_status", type: "varchar", length: 30, default: "pending" })
  resolutionStatus!: PrFeedbackResolution;

  /**
   * When the feedback was resolved
   */
  @Column({ name: "resolved_at", type: "timestamptz", nullable: true })
  resolvedAt!: Date | null;

  /**
   * Commit SHA where suggestion was applied (if accepted)
   */
  @Column({ name: "applied_in_commit", type: "varchar", length: 40, nullable: true })
  appliedInCommit!: string | null;

  /**
   * Notes about resolution (e.g., why rejected, what was modified)
   */
  @Column({ name: "resolution_notes", type: "text", nullable: true })
  resolutionNotes!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  /**
   * When the feedback was created in the SCM (may differ from our created_at)
   */
  @Column({ name: "external_created_at", type: "timestamptz", nullable: true })
  externalCreatedAt!: Date | null;
}
