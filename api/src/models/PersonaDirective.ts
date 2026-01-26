import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { Persona } from "./Persona.js";
import { User } from "./User.js";
import { Organization } from "./Organization.js";

export type DirectiveType = "readme" | "common";

@Entity("persona_directives")
@Index(["personaId", "type", "filename", "isActive"])
@Index(["personaId", "isActive"])
@Index(["orgId"])
@Index(["orgId", "isActive"])
export class PersonaDirective {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "persona_id", type: "uuid" })
  personaId: string;

  @Column({ name: "org_id", type: "uuid", nullable: true })
  orgId: string | null;

  @ManyToOne(() => Persona, (p) => p.directives, { onDelete: "CASCADE" })
  @JoinColumn({ name: "persona_id" })
  persona: Persona;

  @ManyToOne(() => Organization, { onDelete: "CASCADE", nullable: true })
  @JoinColumn({ name: "org_id" })
  organization: Organization | null;

  @Column({ type: "varchar", length: 50 })
  type: DirectiveType; // "readme" = persona-specific, "common" = shared directive

  @Column({ type: "varchar", length: 100, nullable: true })
  filename: string | null; // For common directives: "git_workflow.md"

  @Column({ type: "text" })
  content: string; // Markdown content

  @Column({ type: "int", default: 1 })
  version: number;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive: boolean; // Only one active version per type+filename

  @Column({ name: "created_by_id", type: "uuid", nullable: true })
  createdById: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "created_by_id" })
  createdBy: User | null;

  @Column({ name: "change_summary", type: "varchar", length: 500, nullable: true })
  changeSummary: string | null; // Brief description of changes

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  /**
   * Get the unique key for this directive (for versioning)
   */
  getVersionKey(): string {
    if (this.type === "readme") {
      return `${this.personaId}:readme`;
    }
    return `${this.personaId}:common:${this.filename}`;
  }
}
