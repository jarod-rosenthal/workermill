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

export type InboundEmailAction = "create_task" | "reply_to_task" | "route_to_persona";

export interface InboundEmailActionConfig {
  defaultPersona?: string;
  defaultLabels?: string[];
  requireAuth?: boolean;
  [key: string]: unknown;
}

@Entity("inbound_email_mappings")
@Index(["orgId"])
export class InboundEmailMapping {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ name: "email_pattern", type: "varchar", length: 255 })
  emailPattern: string;

  @Column({ name: "action_type", type: "varchar", length: 50 })
  actionType: InboundEmailAction;

  @Column({ name: "action_config", type: "jsonb", default: {} })
  actionConfig: InboundEmailActionConfig;

  @Column({ type: "varchar", length: 50, nullable: true })
  persona: string | null;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive: boolean;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;
}
