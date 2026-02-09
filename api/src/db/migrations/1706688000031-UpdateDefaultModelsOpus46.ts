import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateDefaultModelsOpus461706688000031 implements MigrationInterface {
  name = "UpdateDefaultModelsOpus461706688000031";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Update all orgs' default_worker_model to claude-opus-4-6
    await queryRunner.query(`
      UPDATE organizations
      SET default_worker_model = 'claude-opus-4-6'
      WHERE default_worker_model IS NULL
         OR default_worker_model NOT IN ('claude-opus-4-6')
    `);

    // Update column default for new orgs
    await queryRunner.query(`
      ALTER TABLE organizations
      ALTER COLUMN default_worker_model SET DEFAULT 'claude-opus-4-6'
    `);

    // Update worker_tasks column default
    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ALTER COLUMN worker_model SET DEFAULT 'claude-opus-4-6'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      ALTER COLUMN default_worker_model SET DEFAULT 'claude-haiku-4-5-20251001'
    `);

    await queryRunner.query(`
      ALTER TABLE worker_tasks
      ALTER COLUMN worker_model SET DEFAULT 'claude-3-5-haiku-20241022'
    `);
  }
}
