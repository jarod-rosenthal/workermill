import { MigrationInterface, QueryRunner } from "typeorm";

export class AddGithubAppInstallationId1741400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS github_app_installation_id INTEGER
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations DROP COLUMN IF EXISTS github_app_installation_id
    `);
  }
}
