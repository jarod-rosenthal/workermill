import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { WorkerTask } from "./WorkerTask.js";
import { Organization } from "./Organization.js";

export type ContextMessageType =
  | "file_created"    // "I created src/services/AuthService.ts"
  | "file_modified"   // "I modified src/models/User.ts"
  | "decision"        // "I'm using bcrypt for password hashing"
  | "dependency"      // "I need frontend to import AuthService from..."
  | "question"        // "Should I use JWT or session-based auth?"
  | "answer"          // Response to a sibling's question
  | "completion"      // "Story 1 complete, auth API ready at /api/auth/*"
  | "blocker"         // "Waiting for backend API to be ready"
  | "warning"         // "The User model schema changed, update your imports"
  | "progress";       // General progress update

/**
 * WorkerContext enables real-time communication between sibling workers
 *
 * When multiple workers execute stories from the same PRD in parallel,
 * they use this system to:
 * - Share what files they've created/modified
 * - Announce decisions that affect siblings
 * - Ask questions to siblings or humans
 * - Report blockers that need resolution
 * - Coordinate completion of dependencies
 */
@Entity("worker_contexts")
@Index(["parentTaskId", "createdAt"])
@Index(["parentTaskId", "messageType"])
@Index(["taskId", "createdAt"])
@Index(["orgId", "createdAt"])
export class WorkerContext {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // Links all sibling workers - the parent PRD task ID
  @Column({ name: "parent_task_id", type: "uuid" })
  parentTaskId: string;

  // Which worker posted this message
  @Column({ name: "task_id", type: "uuid" })
  taskId: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  // Persona of the worker that posted (for display)
  @Column({ type: "varchar", length: 50 })
  persona: string;

  // Type of context message
  @Column({ name: "message_type", type: "varchar", length: 50 })
  messageType: ContextMessageType;

  // The actual message content
  @Column({ type: "text" })
  content: string;

  // Optional structured metadata (file paths, line numbers, etc.)
  @Column({ type: "jsonb", nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  // Archived flag - set when parent workflow completes
  // Archived messages are preserved for history but filtered out of active workflows
  @Column({ type: "boolean", default: false })
  archived: boolean;

  @Column({ name: "archived_at", type: "timestamptz", nullable: true })
  archivedAt: Date | null;

  // Relations
  @ManyToOne(() => WorkerTask, { onDelete: "CASCADE" })
  @JoinColumn({ name: "parent_task_id" })
  parentTask: WorkerTask;

  @ManyToOne(() => WorkerTask, { onDelete: "CASCADE" })
  @JoinColumn({ name: "task_id" })
  task: WorkerTask;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;

  // Helper methods

  isBlocker(): boolean {
    return this.messageType === "blocker";
  }

  isQuestion(): boolean {
    return this.messageType === "question";
  }

  isFileChange(): boolean {
    return this.messageType === "file_created" || this.messageType === "file_modified";
  }

  isCompletion(): boolean {
    return this.messageType === "completion";
  }

  // Factory method for creating context messages
  static create(
    parentTaskId: string,
    taskId: string,
    orgId: string,
    persona: string,
    messageType: ContextMessageType,
    content: string,
    metadata?: Record<string, unknown>
  ): Partial<WorkerContext> {
    return {
      parentTaskId,
      taskId,
      orgId,
      persona,
      messageType,
      content,
      metadata: metadata || null,
    };
  }

  // Factory for file change messages
  static fileCreated(
    parentTaskId: string,
    taskId: string,
    orgId: string,
    persona: string,
    filePath: string,
    description?: string
  ): Partial<WorkerContext> {
    return WorkerContext.create(
      parentTaskId,
      taskId,
      orgId,
      persona,
      "file_created",
      description || `Created ${filePath}`,
      { filePath }
    );
  }

  // Factory for blocker messages
  static blocker(
    parentTaskId: string,
    taskId: string,
    orgId: string,
    persona: string,
    blockerDescription: string,
    dependsOnStory?: number
  ): Partial<WorkerContext> {
    return WorkerContext.create(
      parentTaskId,
      taskId,
      orgId,
      persona,
      "blocker",
      blockerDescription,
      dependsOnStory !== undefined ? { dependsOnStory } : undefined
    );
  }

  // Factory for completion messages
  static completed(
    parentTaskId: string,
    taskId: string,
    orgId: string,
    persona: string,
    storyIndex: number,
    summary: string
  ): Partial<WorkerContext> {
    return WorkerContext.create(
      parentTaskId,
      taskId,
      orgId,
      persona,
      "completion",
      summary,
      { storyIndex }
    );
  }
}
