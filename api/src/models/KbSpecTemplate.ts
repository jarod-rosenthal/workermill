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

@Entity("kb_spec_templates")
@Index(["orgId"])
export class KbSpecTemplate {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ type: "varchar", length: 255 })
  name: string;

  @Column({ type: "text", nullable: true })
  description: string | null;

  @Column({ type: "text" })
  content: string;

  @Column({ name: "required_sections", type: "jsonb", default: () => "'[]'" })
  requiredSections: string[];

  @Column({ name: "is_default", type: "boolean", default: false })
  isDefault: boolean;

  @Column({ name: "is_public", type: "boolean", default: false })
  isPublic: boolean;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;
}
