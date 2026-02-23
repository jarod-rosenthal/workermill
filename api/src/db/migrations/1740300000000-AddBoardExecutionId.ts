import { MigrationInterface, QueryRunner } from "typeorm";

export class AddBoardExecutionId1740300000000 implements MigrationInterface {
  name = "AddBoardExecutionId1740300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE worker_tasks ADD COLUMN IF NOT EXISTS board_execution_id VARCHAR(36)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_worker_tasks_board_exec_id ON worker_tasks (board_execution_id) WHERE board_execution_id IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_worker_tasks_board_exec_id`,
    );
    await queryRunner.query(
      `ALTER TABLE worker_tasks DROP COLUMN IF EXISTS board_execution_id`,
    );
  }
}
