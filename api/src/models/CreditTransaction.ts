import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Organization } from "./Organization.js";
import { WorkerTask } from "./WorkerTask.js";

export type CreditTransactionType =
  | "deposit"
  | "usage"
  | "refund"
  | "bonus"
  | "auto_recharge";

@Entity("credit_transactions")
export class CreditTransaction {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;

  @Column({ type: "varchar", length: 20 })
  type: CreditTransactionType;

  @Column({ name: "amount_cents", type: "int" })
  amountCents: number;

  @Column({ name: "balance_after_cents", type: "int" })
  balanceAfterCents: number;

  @Column({ type: "text", nullable: true })
  description: string | null;

  @Column({ name: "task_id", type: "uuid", nullable: true })
  taskId: string | null;

  @ManyToOne(() => WorkerTask, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "task_id" })
  task: WorkerTask | null;

  @Column({ name: "ai_cost_cents", type: "int", nullable: true })
  aiCostCents: number | null;

  @Column({ name: "fee_cents", type: "int", nullable: true })
  feeCents: number | null;

  @Column({ name: "stripe_payment_intent_id", type: "varchar", length: 255, nullable: true })
  stripePaymentIntentId: string | null;

  @Column({ name: "stripe_charge_id", type: "varchar", length: 255, nullable: true })
  stripeChargeId: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;
}
