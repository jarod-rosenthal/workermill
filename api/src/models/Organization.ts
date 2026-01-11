import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from "typeorm";
import { User } from "./User.js";
import { WorkerTask } from "./WorkerTask.js";

@Entity("organizations")
export class Organization {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 255 })
  name: string;

  @Column({ type: "varchar", length: 50, default: "free" })
  plan: string;

  @Column({ name: "api_key", type: "varchar", length: 255, nullable: true })
  apiKey: string | null;

  @Column({ name: "jira_webhook_secret", type: "varchar", length: 255, nullable: true })
  jiraWebhookSecret: string | null;

  @Column({ name: "default_github_repo", type: "varchar", length: 255, nullable: true })
  defaultGithubRepo: string | null;

  @Column({ name: "system_enabled", type: "boolean", default: true })
  systemEnabled: boolean;

  @Column({ name: "watcher_enabled", type: "boolean", default: false })
  watcherEnabled: boolean;

  @Column({ name: "orchestrator_running", type: "boolean", default: false })
  orchestratorRunning: boolean;

  @Column({ name: "manager_enabled", type: "boolean", default: true })
  managerEnabled: boolean;

  @Column({ name: "manager_model_id", type: "varchar", length: 100, default: "claude-sonnet-4-20250514" })
  managerModelId: string;

  @Column({ name: "counters_reset_at", type: "timestamp", nullable: true })
  countersResetAt: Date | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @OneToMany(() => User, (user) => user.organization)
  users: User[];

  @OneToMany(() => WorkerTask, (task) => task.organization)
  tasks: WorkerTask[];
}
