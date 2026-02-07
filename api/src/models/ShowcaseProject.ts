import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

export type ShowcaseCategory =
  | "saas"
  | "api"
  | "analytics"
  | "documentation"
  | "security"
  | "microservices"
  | "incident-management";

export interface ShowcaseBuildMetadata {
  storyCount: number;
  personasUsed: string[];
  iterationCount?: number;
  qualityScores?: {
    lint: string;
    types: string;
    tests: string;
    security: string;
  };
}

export interface ShowcaseStory {
  title: string;
  persona: string;
  status: "completed" | "in_progress" | "planned";
  cost?: string;
  duration?: string;
}

@Entity("showcase_projects")
export class ShowcaseProject {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 100 })
  name: string;

  @Column({ type: "varchar", length: 200 })
  tagline: string;

  @Column({ type: "text" })
  description: string;

  @Column({ type: "varchar", length: 200 })
  stack: string;

  @Column({ name: "story_count", type: "int" })
  storyCount: number;

  @Column({ type: "varchar", length: 20 })
  cost: string;

  @Column({ type: "varchar", length: 20 })
  duration: string;

  @Column({ name: "repo_url", type: "varchar", length: 500, nullable: true })
  repoUrl: string | null;

  @Column({ name: "live_url", type: "varchar", length: 500, nullable: true })
  liveUrl: string | null;

  @Column({ name: "task_log_url", type: "varchar", length: 500, nullable: true })
  taskLogUrl: string | null;

  @Column({ type: "varchar", length: 50 })
  category: ShowcaseCategory;

  @Column({ name: "is_featured", type: "boolean", default: false })
  isFeatured: boolean;

  @Column({ name: "display_order", type: "int", default: 0 })
  displayOrder: number;

  @Column({ name: "build_metadata", type: "jsonb", nullable: true })
  buildMetadata: ShowcaseBuildMetadata | null;

  @Column({ name: "stories", type: "jsonb", nullable: true })
  stories: ShowcaseStory[] | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
