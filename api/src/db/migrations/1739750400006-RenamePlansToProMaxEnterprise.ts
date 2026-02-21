import { MigrationInterface, QueryRunner } from "typeorm";

export class RenamePlansToProMaxEnterprise1739750400006 implements MigrationInterface {
  name = "RenamePlansToProMaxEnterprise1739750400006";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Rename plans: free→pro, pro→max (order matters to avoid collision)
    // Step 1: Rename existing 'pro' to 'max' FIRST
    await queryRunner.query(`UPDATE organizations SET plan = 'max' WHERE plan = 'pro'`);
    // Step 2: Rename existing 'free' to 'pro'
    await queryRunner.query(`UPDATE organizations SET plan = 'pro' WHERE plan = 'free'`);

    // Update default column value
    await queryRunner.query(`ALTER TABLE organizations ALTER COLUMN plan SET DEFAULT 'pro'`);

    // Backfill limits for new Pro orgs (formerly free) that have default/low values
    await queryRunner.query(`
      UPDATE organizations
      SET max_concurrent_workers = 1, max_parallel_experts = 3, log_retention_days = 14
      WHERE plan = 'pro' AND max_concurrent_workers <= 1
    `);

    // Backfill limits for new Max orgs (formerly pro) that have default values
    await queryRunner.query(`
      UPDATE organizations
      SET max_concurrent_workers = 3, max_parallel_experts = 7
      WHERE plan = 'max' AND max_concurrent_workers <= 5
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse: rename max→pro, pro→free
    await queryRunner.query(`UPDATE organizations SET plan = 'free' WHERE plan = 'pro'`);
    await queryRunner.query(`UPDATE organizations SET plan = 'pro' WHERE plan = 'max'`);
    await queryRunner.query(`ALTER TABLE organizations ALTER COLUMN plan SET DEFAULT 'free'`);
  }
}
