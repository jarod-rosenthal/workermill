import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { User } from "./User.js";

@Entity("user_api_keys")
export class UserApiKey {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ type: "varchar", length: 255 })
  name: string;

  @Column({ name: "key_hash", type: "varchar", length: 255 })
  keyHash: string;

  @Column({ name: "key_prefix", type: "varchar", length: 12 })
  keyPrefix: string;

  @Column({ type: "jsonb", default: '["*"]' })
  scopes: string[];

  @Column({ name: "last_used_at", type: "timestamp", nullable: true })
  lastUsedAt: Date | null;

  @Column({ name: "expires_at", type: "timestamp", nullable: true })
  expiresAt: Date | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user: User;
}
