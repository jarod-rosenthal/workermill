import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Organization } from "./Organization.js";

export type PaymentMethodType = "card";

@Entity("payment_methods")
export class PaymentMethod {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;

  @Column({ name: "stripe_payment_method_id", type: "varchar", length: 255 })
  stripePaymentMethodId: string;

  @Column({ type: "varchar", length: 20, default: "card" })
  type: PaymentMethodType;

  @Column({ name: "last_four", type: "varchar", length: 4, nullable: true })
  lastFour: string | null;

  @Column({ type: "varchar", length: 20, nullable: true })
  brand: string | null;

  @Column({ name: "exp_month", type: "int", nullable: true })
  expMonth: number | null;

  @Column({ name: "exp_year", type: "int", nullable: true })
  expYear: number | null;

  @Column({ name: "is_default", type: "boolean", default: false })
  isDefault: boolean;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;
}
