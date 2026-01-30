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
import { User } from "./User.js";
import { PersonaDirective, type DirectiveType } from "./PersonaDirective.js";

export type ExperimentStatus = "draft" | "running" | "completed" | "cancelled";

/**
 * Traffic allocation configuration for experiment variants.
 * Keys are variant names ("control", "variant_a", "variant_b", etc.)
 * Values are percentages that must sum to 100.
 */
export interface TrafficAllocation {
  control: number;
  [variantName: string]: number;
}

/**
 * Experiment result statistics for a single variant.
 */
export interface VariantStats {
  directiveId: string;
  usageCount: number;
  successCount: number;
  failureCount: number;
  successRate: number | null;
  avgQualityScore: number | null;
  avgAccuracyScore: number | null;
}

@Entity("directive_experiments")
@Index(["orgId"])
@Index(["status"])
@Index(["personaSlug"])
export class DirectiveExperiment {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;

  // =========================================================================
  // Experiment Identity
  // =========================================================================

  @Column({ type: "varchar", length: 255 })
  name: string;

  @Column({ type: "text", nullable: true })
  description: string | null;

  @Column({ type: "varchar", length: 50, default: "draft" })
  status: ExperimentStatus;

  // =========================================================================
  // What We're Testing
  // =========================================================================

  @Column({ name: "persona_slug", type: "varchar", length: 100 })
  personaSlug: string;

  @Column({ name: "directive_type", type: "varchar", length: 50 })
  directiveType: DirectiveType;

  @Column({ name: "directive_filename", type: "varchar", length: 255, nullable: true })
  directiveFilename: string | null;

  // =========================================================================
  // Variants
  // =========================================================================

  @Column({ name: "control_directive_id", type: "uuid" })
  controlDirectiveId: string;

  @ManyToOne(() => PersonaDirective, { onDelete: "CASCADE" })
  @JoinColumn({ name: "control_directive_id" })
  controlDirective: PersonaDirective;

  @Column({ name: "variant_directive_ids", type: "uuid", array: true, default: [] })
  variantDirectiveIds: string[];

  @Column({ name: "traffic_allocation", type: "jsonb", default: { control: 100 } })
  trafficAllocation: TrafficAllocation;

  // =========================================================================
  // Configuration
  // =========================================================================

  @Column({ name: "min_samples_per_variant", type: "int", default: 20 })
  minSamplesPerVariant: number;

  // =========================================================================
  // Timing
  // =========================================================================

  @Column({ name: "started_at", type: "timestamp", nullable: true })
  startedAt: Date | null;

  @Column({ name: "completed_at", type: "timestamp", nullable: true })
  completedAt: Date | null;

  // =========================================================================
  // Results
  // =========================================================================

  @Column({ name: "winner_directive_id", type: "uuid", nullable: true })
  winnerDirectiveId: string | null;

  @ManyToOne(() => PersonaDirective, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "winner_directive_id" })
  winnerDirective: PersonaDirective | null;

  @Column({ name: "winner_reason", type: "text", nullable: true })
  winnerReason: string | null;

  // =========================================================================
  // Audit
  // =========================================================================

  @Column({ name: "created_by_id", type: "uuid", nullable: true })
  createdById: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "created_by_id" })
  createdBy: User | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  // =========================================================================
  // Helper Methods
  // =========================================================================

  /**
   * Check if experiment is currently running
   */
  isRunning(): boolean {
    return this.status === "running";
  }

  /**
   * Check if experiment is completed
   */
  isCompleted(): boolean {
    return this.status === "completed";
  }

  /**
   * Check if experiment can be started
   */
  canStart(): boolean {
    return this.status === "draft";
  }

  /**
   * Get all variant directive IDs (control + variants)
   */
  getAllDirectiveIds(): string[] {
    return [this.controlDirectiveId, ...this.variantDirectiveIds];
  }

  /**
   * Get total number of variants (including control)
   */
  getVariantCount(): number {
    return 1 + this.variantDirectiveIds.length;
  }

  /**
   * Select a directive based on traffic allocation.
   * Returns the directive ID and variant key that should be used for a new task.
   */
  selectDirective(): { directiveId: string; variantKey: string } {
    const random = Math.random() * 100;
    let cumulative = 0;

    // Check control first
    cumulative += this.trafficAllocation.control;
    if (random < cumulative) {
      return { directiveId: this.controlDirectiveId, variantKey: "control" };
    }

    // Check variants
    const variantNames = Object.keys(this.trafficAllocation).filter(k => k !== "control");
    for (let i = 0; i < variantNames.length && i < this.variantDirectiveIds.length; i++) {
      cumulative += this.trafficAllocation[variantNames[i]] || 0;
      if (random < cumulative) {
        return { directiveId: this.variantDirectiveIds[i], variantKey: variantNames[i] };
      }
    }

    // Fallback to control
    return { directiveId: this.controlDirectiveId, variantKey: "control" };
  }

  /**
   * Get the directive key for matching (personaSlug:type:filename)
   */
  getDirectiveKey(): string {
    if (this.directiveType === "readme") {
      return `${this.personaSlug}:readme`;
    }
    return `${this.personaSlug}:common:${this.directiveFilename}`;
  }
}
