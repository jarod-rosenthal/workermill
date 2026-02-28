import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMaxCiFixRetries1741900000000 implements MigrationInterface {
  name = "AddMaxCiFixRetries1741900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS max_ci_fix_retries INT DEFAULT 3 NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS max_ci_fix_retries
    `);
  }
}
