import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { User } from "./User.js";
import { Organization } from "./Organization.js";

export type PushPlatform = "ios" | "android";

@Entity("push_subscriptions")
export class PushSubscription {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ name: "expo_push_token", type: "varchar", length: 255, unique: true })
  expoPushToken: string;

  @Column({ type: "varchar", length: 10 })
  platform: PushPlatform;

  @Column({ name: "device_name", type: "varchar", length: 255, nullable: true })
  deviceName: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user: User;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;
}