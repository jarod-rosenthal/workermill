import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Make task_id nullable in worker_contexts table
 *
 * This allows dashboard/human answers to be posted without an associated worker task.
 * When a human answers a worker's question from the dashboard, there is no taskId
 * because the answer doesn't come from a worker - it comes from a human operator.
 */
export class MakeWorkerContextTaskIdNullable1705344000029 implements MigrationInterface {
  name = "MakeWorkerContextTaskIdNullable1705344000029";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the NOT NULL constraint on task_id
    await queryRunner.query(`
      ALTER TABLE worker_contexts
      ALTER COLUMN task_id DROP NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Note: This will fail if there are rows with NULL task_id
    await queryRunner.query(`
      ALTER TABLE worker_contexts
      ALTER COLUMN task_id SET NOT NULL;
    `);
  }
}
