import { MigrationInterface, QueryRunner } from "typeorm";

export class AddBudgetLimitColumns1705344000075 implements MigrationInterface {
  name = "AddBudgetLimitColumns1705344000075";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add daily budget limit column
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS daily_budget_limit_usd DECIMAL(10, 2) DEFAULT NULL
    `);

    // Add weekly budget limit column
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS weekly_budget_limit_usd DECIMAL(10, 2) DEFAULT NULL
    `);

    // Add monthly budget limit column
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS monthly_budget_limit_usd DECIMAL(10, 2) DEFAULT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS monthly_budget_limit_usd
    `);
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS weekly_budget_limit_usd
    `);
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS daily_budget_limit_usd
    `);
  }
}
