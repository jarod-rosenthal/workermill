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
  Unique,
} from "typeorm";
import { Organization } from "./Organization.js";
import { PersonaDirective } from "./PersonaDirective.js";
import { PersonaScript } from "./PersonaScript.js";

@Entity("personas")
@Unique(["orgId", "slug"])
@Index(["orgId", "enabled"])
export class Persona {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid", nullable: true })
  orgId: string | null; // null = system/global persona

  @ManyToOne(() => Organization, { onDelete: "CASCADE", nullable: true })
  @JoinColumn({ name: "org_id" })
  organization: Organization | null;

  @Column({ type: "varchar", length: 50 })
  slug: string; // e.g., "backend_developer"

  @Column({ type: "varchar", length: 100 })
  name: string; // e.g., "Backend Developer"

  @Column({ type: "varchar", length: 10, nullable: true })
  emoji: string | null; // e.g., "⚙️"

  @Column({ type: "varchar", length: 50, nullable: true })
  color: string | null; // e.g., "blue-500" for Tailwind

  @Column({ name: "short_label", type: "varchar", length: 30, nullable: true })
  shortLabel: string | null; // e.g., "Backend"

  @Column({ type: "text", nullable: true })
  description: string | null;

  @Column({ type: "boolean", default: true })
  enabled: boolean;

  @Column({ name: "is_system", type: "boolean", default: false })
  isSystem: boolean; // True for built-in personas, cannot delete

  @Column({ type: "int", default: 0 })
  priority: number; // Sort order

  @Column({ type: "simple-array", nullable: true })
  skills: string[] | null; // e.g., ["React", "TypeScript"]

  @Column({ name: "risk_level", type: "varchar", length: 20, default: "medium" })
  riskLevel: "low" | "medium" | "high";

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @OneToMany(() => PersonaDirective, (d) => d.persona)
  directives: PersonaDirective[];

  @OneToMany(() => PersonaScript, (s) => s.persona)
  scripts: PersonaScript[];

  /**
   * Check if this persona can be deleted (not a system persona)
   */
  canDelete(): boolean {
    return !this.isSystem;
  }

  /**
   * Check if this persona can be edited by an org
   * System personas can only be edited if the org has overridden them
   */
  canEdit(requestingOrgId: string | null): boolean {
    // System personas with null orgId cannot be edited
    if (this.orgId === null) {
      return false;
    }
    // Org-specific personas can only be edited by that org
    return this.orgId === requestingOrgId;
  }
}
