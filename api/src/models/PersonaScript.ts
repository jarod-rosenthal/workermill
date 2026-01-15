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

@Entity("persona_scripts")
@Index(["personaId", "category", "name", "isActive"])
@Index(["personaId", "isActive"])
export class PersonaScript {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "persona_id", type: "uuid" })
  personaId: string;

  @ManyToOne(() => Persona, (p) => p.scripts, { onDelete: "CASCADE" })
  @JoinColumn({ name: "persona_id" })
  persona: Persona;

  @Column({ type: "varchar", length: 50 })
  category: string; // e.g., "git", "deploy", "test", "ticket"

  @Column({ type: "varchar", length: 100 })
  name: string; // e.g., "create_pr"

  @Column({ type: "text" })
  content: string; // TypeScript source code

  @Column({ type: "int", default: 1 })
  version: number;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive: boolean;

  @Column({ name: "created_by_id", type: "uuid", nullable: true })
  createdById: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "created_by_id" })
  createdBy: User | null;

  @Column({ name: "change_summary", type: "varchar", length: 500, nullable: true })
  changeSummary: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  /**
   * Get the unique key for this script (for versioning)
   */
  getVersionKey(): string {
    return `${this.personaId}:${this.category}:${this.name}`;
  }

  /**
   * Get the full script path (category/name)
   */
  getPath(): string {
    return `${this.category}/${this.name}`;
  }
}
