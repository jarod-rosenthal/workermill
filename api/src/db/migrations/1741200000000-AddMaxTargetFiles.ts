import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMaxTargetFiles1741200000000 implements MigrationInterface {
  name = "AddMaxTargetFiles1741200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS max_target_files INTEGER NOT NULL DEFAULT 5
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS max_target_files
    `);
  }
}
