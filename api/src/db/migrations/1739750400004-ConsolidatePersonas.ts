import { MigrationInterface, QueryRunner } from "typeorm";

export class ConsolidatePersonas1739750400004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Remap worker_tasks persona references for absorbed personas
    await queryRunner.query(`
      UPDATE worker_tasks SET worker_persona = 'backend_developer'
      WHERE worker_persona IN ('api_developer', 'database_administrator')
    `);

    await queryRunner.query(`
      UPDATE worker_tasks SET worker_persona = 'data_ml_engineer'
      WHERE worker_persona IN ('data_engineer', 'ml_engineer')
    `);

    await queryRunner.query(`
      UPDATE worker_tasks SET worker_persona = 'mobile_developer'
      WHERE worker_persona IN ('mobile_developer_android', 'mobile_developer_ios')
    `);

    // 2. Deactivate old system personas (don't delete — historical references exist)
    await queryRunner.query(`
      UPDATE personas SET enabled = false
      WHERE slug IN ('api_developer', 'database_administrator', 'data_engineer', 'ml_engineer', 'mobile_developer_android', 'mobile_developer_ios')
      AND org_id IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reactivate old personas
    await queryRunner.query(`
      UPDATE personas SET enabled = true
      WHERE slug IN ('api_developer', 'database_administrator', 'data_engineer', 'ml_engineer', 'mobile_developer_android', 'mobile_developer_ios')
      AND org_id IS NULL
    `);

    // Note: worker_tasks remapping is not reversed — it's a lossy operation
  }
}
