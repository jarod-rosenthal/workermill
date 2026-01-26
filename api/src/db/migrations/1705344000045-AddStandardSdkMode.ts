import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStandardSdkMode1705344000045 implements MigrationInterface {
  name = "AddStandardSdkMode1705344000045";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add standard_sdk_mode column to worker_tasks
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS standard_sdk_mode BOOLEAN NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      DROP COLUMN IF EXISTS standard_sdk_mode
    `);
  }
}
