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
import { User } from "./User.js";
import type { KbColumn } from "./KbColumn.js";
import type { KbStarredBoard } from "./KbStarredBoard.js";
import type { KbActivity } from "./KbActivity.js";

@Entity("kb_boards")
@Index(["orgId"])
export class KbBoard {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ type: "varchar", length: 200 })
  name: string;

  @Column({ type: "text", nullable: true })
  description: string | null;

  @Column({ type: "int", default: 0 })
  position: number;

  @Column({ type: "varchar", length: 50, nullable: true })
  template: string | null;

  @Column({ type: "varchar", length: 10 })
  prefix: string;

  @Column({ name: "next_card_number", type: "int", default: 1 })
  nextCardNumber: number;

  @Column({ name: "created_by", type: "uuid", nullable: true })
  createdById: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "created_by" })
  createdBy: User | null;

  @OneToMany("KbColumn", "board")
  columns: KbColumn[];

  @OneToMany("KbStarredBoard", "board")
  starredBy: KbStarredBoard[];

  @OneToMany("KbActivity", "board")
  activities: KbActivity[];
}
