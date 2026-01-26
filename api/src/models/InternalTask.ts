import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Project } from "./Project.js";
import { Organization } from "./Organization.js";
import { BoardColumn } from "./BoardColumn.js";
import { User } from "./User.js";
import type { WorkerTask } from "./WorkerTask.js";

// Acceptance criteria in Gherkin format
export interface AcceptanceCriterion {
  given: string;
  when: string;
  then: string;
}

// Definition of done checklist item
export interface DefinitionOfDoneItem {
  text: string;
  checked: boolean;
}

// Internal task status - drives column assignment automatically
export type InternalTaskStatus =
  | "draft"      // Task created, missing required fields (no persona, incomplete AC)
  | "ready"      // Task has all required fields, ready to execute
  | "queued"     // WorkerTask created, waiting to be claimed
  | "executing"  // Worker is actively working on task
  | "review"     // PR created, awaiting review
  | "completed"  // Task completed (PR merged or deployed)
  | "failed";    // Task execution failed

@Entity("internal_tasks")
export class InternalTask {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "project_id", type: "uuid" })
  projectId: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ name: "column_id", type: "uuid" })
  columnId: string;

  // Identification
  @Column({ name: "task_key", type: "varchar", length: 20 })
  taskKey: string;

  @Column({ name: "sequence_number", type: "int" })
  sequenceNumber: number;

  // User Story Format
  @Column({ type: "varchar", length: 500 })
  title: string;

  @Column({ name: "user_story_role", type: "varchar", length: 200, nullable: true })
  userStoryRole: string | null;

  @Column({ name: "user_story_want", type: "varchar", length: 500, nullable: true })
  userStoryWant: string | null;

  @Column({ name: "user_story_benefit", type: "varchar", length: 500, nullable: true })
  userStoryBenefit: string | null;

  // Rich Content
  @Column({ type: "text", nullable: true })
  description: string | null;

  @Column({ name: "acceptance_criteria", type: "jsonb", default: [] })
  acceptanceCriteria: AcceptanceCriterion[];

  @Column({ name: "definition_of_done", type: "jsonb", default: [] })
  definitionOfDone: DefinitionOfDoneItem[];

  @Column({ name: "technical_notes", type: "text", nullable: true })
  technicalNotes: string | null;

  // Worker Config (overrides project defaults)
  @Column({ type: "varchar", length: 50, nullable: true })
  persona: string | null;

  @Column({ type: "varchar", length: 100, nullable: true })
  model: string | null;

  @Column({ type: "varchar", length: 50, nullable: true })
  provider: string | null;

  @Column({ name: "github_repo", type: "varchar", length: 255, nullable: true })
  githubRepo: string | null;

  @Column({ type: "text", array: true, nullable: true })
  labels: string[] | null;

  // Position within column
  @Column({ name: "column_position", type: "int", default: 0 })
  columnPosition: number;

  // System-controlled status (drives column assignment)
  @Column({ type: "varchar", length: 20, default: "draft" })
  status: InternalTaskStatus;

  // Story index for ordering within epic execution
  @Column({ name: "story_index", type: "int", nullable: true })
  storyIndex: number | null;

  // Worker Integration
  @Column({ name: "worker_task_id", type: "uuid", nullable: true })
  workerTaskId: string | null;

  @Column({ name: "assigned_at", type: "timestamp", nullable: true })
  assignedAt: Date | null;

  // Metadata
  @Column({ name: "created_by", type: "uuid", nullable: true })
  createdBy: string | null;

  @Column({ name: "due_date", type: "date", nullable: true })
  dueDate: Date | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => Project, (project) => project.tasks, { onDelete: "CASCADE" })
  @JoinColumn({ name: "project_id" })
  project: Project;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;

  @ManyToOne(() => BoardColumn, (column) => column.tasks, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "column_id" })
  column: BoardColumn;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "created_by" })
  creator: User;

  @ManyToOne("WorkerTask", { onDelete: "SET NULL" })
  @JoinColumn({ name: "worker_task_id" })
  workerTask: WorkerTask;

  // Helper to check if task is assigned to a worker
  isAssigned(): boolean {
    return this.workerTaskId !== null;
  }

  // Helper to format as user story
  formatUserStory(): string {
    if (!this.userStoryRole && !this.userStoryWant && !this.userStoryBenefit) {
      return this.title;
    }

    const parts: string[] = [];
    if (this.userStoryRole) parts.push(`As a ${this.userStoryRole},`);
    if (this.userStoryWant) parts.push(`I want ${this.userStoryWant},`);
    if (this.userStoryBenefit) parts.push(`So that ${this.userStoryBenefit}.`);
    return parts.join(" ");
  }

  // Helper to format acceptance criteria for worker
  formatAcceptanceCriteria(): string {
    if (!this.acceptanceCriteria || this.acceptanceCriteria.length === 0) {
      return "";
    }

    return this.acceptanceCriteria
      .map((ac, i) => `${i + 1}. GIVEN ${ac.given}\n   WHEN ${ac.when}\n   THEN ${ac.then}`)
      .join("\n\n");
  }

  // Helper to format full description for worker assignment
  formatForWorker(): string {
    const sections: string[] = [];

    // Title / User Story
    sections.push(`***REMOVED*** ${this.title}`);
    const story = this.formatUserStory();
    if (story !== this.title) {
      sections.push(`\n**User Story:** ${story}`);
    }

    // Description
    if (this.description) {
      sections.push(`\n***REMOVED******REMOVED*** Description\n${this.description}`);
    }

    // Acceptance Criteria
    const ac = this.formatAcceptanceCriteria();
    if (ac) {
      sections.push(`\n***REMOVED******REMOVED*** Acceptance Criteria\n${ac}`);
    }

    // Definition of Done
    if (this.definitionOfDone && this.definitionOfDone.length > 0) {
      const dod = this.definitionOfDone.map((d) => `- [ ] ${d.text}`).join("\n");
      sections.push(`\n***REMOVED******REMOVED*** Definition of Done\n${dod}`);
    }

    // Technical Notes
    if (this.technicalNotes) {
      sections.push(`\n***REMOVED******REMOVED*** Technical Notes\n${this.technicalNotes}`);
    }

    return sections.join("\n");
  }

  // Status helper methods

  /**
   * Check if task has all required fields to be executed
   * Required: title, persona, at least one acceptance criterion
   */
  hasRequiredFields(): boolean {
    return !!(
      this.title &&
      this.persona &&
      this.acceptanceCriteria &&
      this.acceptanceCriteria.length > 0
    );
  }

  /**
   * Check if task is ready to be executed
   */
  isReady(): boolean {
    return this.status === "ready" && this.hasRequiredFields();
  }

  /**
   * Check if task is currently being executed
   */
  isExecuting(): boolean {
    return this.status === "executing" || this.status === "queued";
  }

  /**
   * Check if task is in a terminal state
   */
  isTerminal(): boolean {
    return this.status === "completed" || this.status === "failed";
  }

  /**
   * Check if task can be run (not already executing or completed)
   */
  canRun(): boolean {
    return this.status === "ready" && !this.workerTaskId;
  }
}
