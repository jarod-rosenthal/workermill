import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPerTaskCostCeiling1705344000079 implements MigrationInterface {
  name = "AddPerTaskCostCeiling1705344000079";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add per-task cost ceiling column
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS per_task_cost_ceiling_usd DECIMAL(10, 2) DEFAULT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS per_task_cost_ceiling_usd
    `);
  }
}
