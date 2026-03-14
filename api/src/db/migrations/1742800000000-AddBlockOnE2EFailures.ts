import { MigrationInterface, QueryRunner } from "typeorm";

export class AddBlockOnE2EFailures1742800000000 implements MigrationInterface {
  name = "AddBlockOnE2EFailures1742800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS block_on_e2e_failures BOOLEAN DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS block_on_e2e_failures
    `);
  }
}
