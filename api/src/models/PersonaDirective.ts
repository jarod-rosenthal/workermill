import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { Persona } from "./Persona.js";
import { User } from "./User.js";
import { Organization } from "./Organization.js";

export type DirectiveType = "readme" | "common";

/**
 * Directive usage record stored in WorkerTask.directivesUsed
 */
export interface DirectiveUsage {
  directiveId: string;
  version: number;
  type: DirectiveType;
  filename?: string;
  personaSlug: string;
}

@Entity("persona_directives")
@Index(["personaId", "type", "filename", "isActive"])
@Index(["personaId", "isActive"])
@Index(["orgId"])
@Index(["orgId", "isActive"])
export class PersonaDirective {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "persona_id", type: "uuid" })
  personaId: string;

  @Column({ name: "org_id", type: "uuid", nullable: true })
  orgId: string | null;

  @ManyToOne(() => Persona, (p) => p.directives, { onDelete: "CASCADE" })
  @JoinColumn({ name: "persona_id" })
  persona: Persona;

  @ManyToOne(() => Organization, { onDelete: "CASCADE", nullable: true })
  @JoinColumn({ name: "org_id" })
  organization: Organization | null;

  @Column({ type: "varchar", length: 50 })
  type: DirectiveType; // "readme" = persona-specific, "common" = shared directive

  @Column({ type: "varchar", length: 100, nullable: true })
  filename: string | null; // For common directives: "git_workflow.md"

  @Column({ type: "text" })
  content: string; // Markdown content

  @Column({ type: "int", default: 1 })
  version: number;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive: boolean; // Only one active version per type+filename

  @Column({ name: "created_by_id", type: "uuid", nullable: true })
  createdById: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "created_by_id" })
  createdBy: User | null;

  @Column({ name: "change_summary", type: "varchar", length: 500, nullable: true })
  changeSummary: string | null; // Brief description of changes

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  // =========================================================================
  // Effectiveness Tracking Metrics
  // =========================================================================

  @Column({ name: "usage_count", type: "int", default: 0 })
  usageCount: number;

  @Column({ name: "success_count", type: "int", default: 0 })
  successCount: number;

  @Column({ name: "failure_count", type: "int", default: 0 })
  failureCount: number;

  @Column({ name: "avg_quality_score", type: "float", nullable: true })
  avgQualityScore: number | null;

  @Column({ name: "avg_accuracy_score", type: "float", nullable: true })
  avgAccuracyScore: number | null;

  @Column({ name: "last_used_at", type: "timestamp", nullable: true })
  lastUsedAt: Date | null;

  // =========================================================================
  // Deprecation Tracking
  // =========================================================================

  @Column({ name: "deprecated_at", type: "timestamp", nullable: true })
  deprecatedAt: Date | null;

  @Column({ name: "deprecation_reason", type: "text", nullable: true })
  deprecationReason: string | null;

  @Column({ name: "superseded_by_id", type: "uuid", nullable: true })
  supersededById: string | null;

  @ManyToOne(() => PersonaDirective, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "superseded_by_id" })
  supersededBy: PersonaDirective | null;

  /**
   * Get the unique key for this directive (for versioning)
   */
  getVersionKey(): string {
    if (this.type === "readme") {
      return `${this.personaId}:readme`;
    }
    return `${this.personaId}:common:${this.filename}`;
  }

  /**
   * Calculate success rate (0-1 scale)
   * Returns null if no outcomes recorded
   */
  getSuccessRate(): number | null {
    const total = this.successCount + this.failureCount;
    if (total === 0) return null;
    return this.successCount / total;
  }

  /**
   * Check if directive is deprecated
   */
  isDeprecated(): boolean {
    return this.deprecatedAt !== null;
  }

  /**
   * Check if directive has enough samples for statistical significance
   */
  hasEnoughSamples(minSamples: number = 10): boolean {
    return this.usageCount >= minSamples;
  }
}
