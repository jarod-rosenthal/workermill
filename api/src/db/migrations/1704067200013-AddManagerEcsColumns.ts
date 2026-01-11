import { MigrationInterface, QueryRunner } from "typeorm";

export class AddManagerEcsColumns1704067200013 implements MigrationInterface {
  name = "AddManagerEcsColumns1704067200013";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add Manager ECS task tracking columns for review workflow
    await queryRunner.query(`
      ALTER TABLE "worker_tasks"
      ADD COLUMN IF NOT EXISTS "manager_ecs_task_arn" varchar(500)
    `);

    await queryRunner.query(`
      ALTER TABLE "worker_tasks"
      ADD COLUMN IF NOT EXISTS "manager_ecs_task_id" varchar(100)
    `);

    // Add Manager log analysis tracking for manager workflow
    await queryRunner.query(`
      ALTER TABLE "worker_tasks"
      ADD COLUMN IF NOT EXISTS "manager_analysis_done" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "worker_tasks" DROP COLUMN IF EXISTS "manager_analysis_done"`);
    await queryRunner.query(`ALTER TABLE "worker_tasks" DROP COLUMN IF EXISTS "manager_ecs_task_id"`);
    await queryRunner.query(`ALTER TABLE "worker_tasks" DROP COLUMN IF EXISTS "manager_ecs_task_arn"`);
  }
}
