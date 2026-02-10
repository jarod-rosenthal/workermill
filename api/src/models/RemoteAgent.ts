import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

export type RemoteAgentStatus = "online" | "offline";

@Entity("remote_agents")
export class RemoteAgent {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ name: "agent_id", type: "varchar", length: 100 })
  agentId: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  hostname: string | null;

  @Column({ type: "varchar", length: 50, nullable: true })
  platform: string | null;

  @Column({ name: "node_version", type: "varchar", length: 20, nullable: true })
  nodeVersion: string | null;

  @Column({ name: "docker_version", type: "varchar", length: 50, nullable: true })
  dockerVersion: string | null;

  @Column({ name: "claude_version", type: "varchar", length: 50, nullable: true })
  claudeVersion: string | null;

  @Column({ name: "agent_version", type: "varchar", length: 20, nullable: true })
  agentVersion: string | null;

  @Column({ name: "max_workers", type: "int", default: 2 })
  maxWorkers: number;

  @Column({ name: "active_tasks", type: "int", default: 0 })
  activeTasks: number;

  @Column({ type: "varchar", length: 20, default: "online" })
  status: RemoteAgentStatus;

  @Column({ name: "last_heartbeat_at", type: "timestamptz" })
  lastHeartbeatAt: Date;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
