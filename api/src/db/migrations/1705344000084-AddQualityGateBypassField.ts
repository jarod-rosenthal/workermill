import { MigrationInterface, QueryRunner } from "typeorm";

export class AddQualityGateBypassField1705344000084 implements MigrationInterface {
  name = "AddQualityGateBypassField1705344000084";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add quality_gate_bypass column to worker_tasks table
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ADD COLUMN IF NOT EXISTS quality_gate_bypass BOOLEAN DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      DROP COLUMN IF EXISTS quality_gate_bypass
    `);
  }
}
