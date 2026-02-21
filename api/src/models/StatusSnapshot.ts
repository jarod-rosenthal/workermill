import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

export type StatusComponent =
  | "api"
  | "database"
  | "taskProcessing"
  | "agentNetwork";

export type ComponentStatus = "operational" | "degraded" | "outage";

@Entity("status_snapshots")
@Index(["component", "timestamp"])
export class StatusSnapshot {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "timestamptz" })
  timestamp: Date;

  @Column({ type: "varchar", length: 50 })
  component: StatusComponent;

  @Column({ type: "varchar", length: 20 })
  status: ComponentStatus;

  @Column({ name: "response_time_ms", type: "int", nullable: true })
  responseTimeMs: number | null;

  @Column({ type: "text", nullable: true })
  message: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;
}
