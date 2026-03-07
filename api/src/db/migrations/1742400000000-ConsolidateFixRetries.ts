import { MigrationInterface, QueryRunner } from "typeorm";

export class ConsolidateFixRetries1742400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add new column with default from maxCiFixRetries (the one that was actually working)
    await queryRunner.query(`
      ALTER TABLE organizations ADD COLUMN IF NOT EXISTS max_fix_retries INT NOT NULL DEFAULT 3
    `);
    // Copy the higher of the two existing values (prefer the value the user actually set)
    await queryRunner.query(`
      UPDATE organizations SET max_fix_retries = GREATEST(max_ci_fix_retries, 3)
    `);
    // Drop old columns
    await queryRunner.query(`ALTER TABLE organizations DROP COLUMN IF EXISTS quality_gate_max_retries`);
    await queryRunner.query(`ALTER TABLE organizations DROP COLUMN IF EXISTS max_ci_fix_retries`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE organizations ADD COLUMN quality_gate_max_retries INT NOT NULL DEFAULT 5`);
    await queryRunner.query(`ALTER TABLE organizations ADD COLUMN max_ci_fix_retries INT NOT NULL DEFAULT 3`);
    await queryRunner.query(`UPDATE organizations SET quality_gate_max_retries = max_fix_retries, max_ci_fix_retries = max_fix_retries`);
    await queryRunner.query(`ALTER TABLE organizations DROP COLUMN max_fix_retries`);
  }
}
