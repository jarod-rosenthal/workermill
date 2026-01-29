import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSiemIntegration1705344000089 implements MigrationInterface {
  name = "AddSiemIntegration1705344000089";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add SIEM integration columns
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS siem_enabled BOOLEAN NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS siem_provider VARCHAR(50) NULL
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS siem_webhook_url VARCHAR(500) NULL
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS siem_webhook_secret VARCHAR(255) NULL
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS siem_event_filters JSONB NOT NULL DEFAULT '{}'
    `);

    // Add data residency columns
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS data_region VARCHAR(20) NOT NULL DEFAULT 'us-east-1'
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS data_residency_mode VARCHAR(20) NOT NULL DEFAULT 'standard'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS data_residency_mode
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS data_region
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS siem_event_filters
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS siem_webhook_secret
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS siem_webhook_url
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS siem_provider
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS siem_enabled
    `);
  }
}
