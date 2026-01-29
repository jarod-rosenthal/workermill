import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSonarQubeIntegration1705344000085 implements MigrationInterface {
  name = "AddSonarQubeIntegration1705344000085";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add SonarQube integration fields to organizations table
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS sonarqube_url VARCHAR(500),
      ADD COLUMN IF NOT EXISTS sonarqube_token VARCHAR(255)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS sonarqube_url,
      DROP COLUMN IF EXISTS sonarqube_token
    `);
  }
}
