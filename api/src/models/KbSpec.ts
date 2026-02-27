import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from "typeorm";
import { Organization } from "./Organization.js";
import { KbSpecTemplate } from "./KbSpecTemplate.js";
import { KbSpecVersion } from "./KbSpecVersion.js";

export type SpecStatus = "draft" | "validated" | "decomposed" | "archived";

export interface QualityDimensionScore {
  score: number;
  feedback: string;
}

export interface QualityFeedback {
  overall: number;
  dimensions: {
    completeness: QualityDimensionScore;
    clarity: QualityDimensionScore;
    decomposability: QualityDimensionScore;
    constraints: QualityDimensionScore;
    testability: QualityDimensionScore;
  };
  suggestions: string[];
}

@Entity("kb_specs")
@Index(["orgId"])
@Index(["boardId"])
@Index(["status"])
export class KbSpec {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ type: "varchar", length: 500 })
  title: string;

  @Column({ type: "text", nullable: true })
  content: string | null;

  @Column({ type: "varchar", length: 50, default: "draft" })
  status: SpecStatus;

  @Column({ name: "quality_score", type: "int", nullable: true })
  qualityScore: number | null;

  @Column({ name: "quality_feedback", type: "jsonb", nullable: true })
  qualityFeedback: QualityFeedback | null;

  @Column({ name: "template_id", type: "uuid", nullable: true })
  templateId: string | null;

  @Column({ type: "int", default: 1 })
  version: number;

  @Column({ name: "created_by", type: "uuid", nullable: true })
  createdBy: string | null;

  @Column({ name: "board_id", type: "uuid", nullable: true })
  boardId: string | null;

  @Column({ type: "jsonb", default: () => "'{}'" })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;

  @ManyToOne(() => KbSpecTemplate, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "template_id" })
  template: KbSpecTemplate | null;

  @OneToMany(() => KbSpecVersion, (v) => v.spec)
  versions: KbSpecVersion[];
}
