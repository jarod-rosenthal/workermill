import { MigrationInterface, QueryRunner } from "typeorm";

export class AddBlockerWaitTimeoutMinutes1742000000000 implements MigrationInterface {
  name = "AddBlockerWaitTimeoutMinutes1742000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS blocker_wait_timeout_minutes INT DEFAULT 20 NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS blocker_wait_timeout_minutes
    `);
  }
}
