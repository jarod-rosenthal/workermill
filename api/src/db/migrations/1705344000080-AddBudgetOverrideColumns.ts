import { MigrationInterface, QueryRunner } from "typeorm";

export class AddBudgetOverrideColumns1705344000080 implements MigrationInterface {
  name = "AddBudgetOverrideColumns1705344000080";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add budget override until column
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS budget_override_until TIMESTAMP DEFAULT NULL
    `);

    // Add budget override reason column
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS budget_override_reason TEXT DEFAULT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS budget_override_reason
    `);
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS budget_override_until
    `);
  }
}
