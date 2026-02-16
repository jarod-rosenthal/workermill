import { MigrationInterface, QueryRunner } from "typeorm";

export class ConsolidatePlansToThreeTiers1706688000047 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Map legacy plans to pro
    await queryRunner.query(`
      UPDATE organizations
      SET plan = 'pro'
      WHERE plan IN ('starter', 'team', 'business')
    `);

    // Update plan-based defaults for free orgs
    await queryRunner.query(`
      UPDATE organizations
      SET "log_retention_days" = 14,
          "max_concurrent_workers" = 1,
          "max_parallel_experts" = 3
      WHERE plan = 'free'
    `);

    // Update plan-based defaults for pro orgs (use GREATEST to not downgrade)
    await queryRunner.query(`
      UPDATE organizations
      SET "log_retention_days" = GREATEST("log_retention_days", 90),
          "max_concurrent_workers" = GREATEST("max_concurrent_workers", 5)
      WHERE plan = 'pro'
    `);

    // Enterprise orgs get unlimited log retention
    await queryRunner.query(`
      UPDATE organizations
      SET "log_retention_days" = -1
      WHERE plan = 'enterprise'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    console.warn("Cannot reverse plan consolidation — manual intervention required");
  }
}
