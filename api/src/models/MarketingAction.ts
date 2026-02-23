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

export type MarketingActionType =
  | "publish"
  | "bid_adjust"
  | "pause"
  | "resume"
  | "create_campaign"
  | "report";

@Entity("marketing_actions")
@Index(["orgId"])
export class MarketingAction {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ name: "mission_run_id", type: "varchar", length: 100 })
  missionRunId: string;

  @Column({ name: "action_type", type: "varchar", length: 50 })
  actionType: MarketingActionType;

  @Column({ type: "varchar", length: 50, nullable: true })
  platform: string | null;

  @Column({ type: "text" })
  description: string;

  @Column({ type: "jsonb", default: {} })
  details: Record<string, unknown>;

  @Column({ name: "auto_executed", type: "boolean", default: true })
  autoExecuted: boolean;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  // Relations
  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;
}
