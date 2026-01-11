import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1704067200000 implements MigrationInterface {
  name = "InitialSchema1704067200000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable UUID extension
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // Organizations table
    await queryRunner.query(`
      CREATE TABLE "organizations" (
        "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "name" VARCHAR(255) NOT NULL,
        "plan" VARCHAR(50) NOT NULL DEFAULT 'free',
        "api_key" VARCHAR(255) UNIQUE,
        "jira_webhook_secret" VARCHAR(255),
        "default_github_repo" VARCHAR(255),
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Users table
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "org_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "cognito_id" VARCHAR(255) UNIQUE NOT NULL,
        "email" VARCHAR(255) NOT NULL,
        "full_name" VARCHAR(255) NOT NULL,
        "role" VARCHAR(50) NOT NULL DEFAULT 'member',
        "status" VARCHAR(50) NOT NULL DEFAULT 'active',
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Worker tasks table
    await queryRunner.query(`
      CREATE TABLE "worker_tasks" (
        "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "org_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "jira_issue_key" VARCHAR(50) NOT NULL,
        "summary" VARCHAR(500) NOT NULL,
        "description" TEXT,
        "worker_persona" VARCHAR(50) NOT NULL,
        "worker_model" VARCHAR(100) NOT NULL DEFAULT 'claude-sonnet-4-20250514',
        "github_repo" VARCHAR(255),
        "status" VARCHAR(50) NOT NULL DEFAULT 'queued',
        "ecs_task_arn" VARCHAR(500),
        "ecs_task_id" VARCHAR(100),
        "error_message" TEXT,
        "retry_count" INTEGER NOT NULL DEFAULT 0,
        "max_retries" INTEGER NOT NULL DEFAULT 3,
        "started_at" TIMESTAMP WITH TIME ZONE,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "duration_seconds" INTEGER,
        "tokens_input" INTEGER DEFAULT 0,
        "tokens_output" INTEGER DEFAULT 0,
        "estimated_cost" DECIMAL(10, 4) DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Indexes
    await queryRunner.query(`
      CREATE INDEX "idx_users_org_id" ON "users"("org_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_users_cognito_id" ON "users"("cognito_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_worker_tasks_org_id" ON "worker_tasks"("org_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_worker_tasks_status" ON "worker_tasks"("status")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_worker_tasks_jira_key" ON "worker_tasks"("jira_issue_key")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_worker_tasks_created" ON "worker_tasks"("created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "worker_tasks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "organizations"`);
  }
}
