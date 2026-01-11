import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Organization } from "./Organization.js";

export type UserRole = "admin" | "member" | "viewer";

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  // Cognito user ID
  @Column({ name: "cognito_id", type: "varchar", length: 255, unique: true })
  cognitoId: string;

  @Column({ type: "varchar", length: 255 })
  email: string;

  @Column({ name: "full_name", type: "varchar", length: 255, nullable: true })
  fullName: string | null;

  @Column({ type: "varchar", length: 20, default: "member" })
  role: UserRole;

  @Column({ type: "varchar", length: 20, default: "active" })
  status: "active" | "inactive" | "pending";

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @ManyToOne(() => Organization, (org) => org.users, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;
}
