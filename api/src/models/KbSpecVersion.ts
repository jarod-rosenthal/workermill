import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { KbSpec } from "./KbSpec.js";

@Entity("kb_spec_versions")
@Index(["specId"])
export class KbSpecVersion {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "spec_id", type: "uuid" })
  specId: string;

  @Column({ type: "text" })
  content: string;

  @Column({ name: "quality_score", type: "int", nullable: true })
  qualityScore: number | null;

  @Column({ type: "int" })
  version: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @ManyToOne(() => KbSpec, (s) => s.versions, { onDelete: "CASCADE" })
  @JoinColumn({ name: "spec_id" })
  spec: KbSpec;
}
