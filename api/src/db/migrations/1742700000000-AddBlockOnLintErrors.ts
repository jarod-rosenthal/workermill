import { MigrationInterface, QueryRunner } from "typeorm";

export class AddBlockOnLintErrors1742700000000 implements MigrationInterface {
  name = "AddBlockOnLintErrors1742700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS block_on_lint_errors BOOLEAN DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS block_on_lint_errors
    `);
  }
}
