import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * Tenant represents an organization/workspace in the system.
 * This is a minimal model for multi-tenancy - extend as needed.
 */
@Entity("tenants")
export class Tenant {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 255 })
  name: string;

  @Column({ type: "varchar", length: 100, unique: true })
  slug: string;

  // AI Worker cost tracking
  @Column({
    name: "ai_worker_cumulative_cost",
    type: "decimal",
    precision: 10,
    scale: 4,
    default: 0,
  })
  aiWorkerCumulativeCost: number;

  @Column({ name: "ai_worker_cost_reset_at", type: "timestamptz", nullable: true })
  aiWorkerCostResetAt: Date | null;

  // Settings
  @Column({ type: "jsonb", default: "{}" })
  settings: Record<string, any>;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
