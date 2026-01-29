import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCmekSupport1705344000091 implements MigrationInterface {
  name = "AddCmekSupport1705344000091";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add CMEK (Customer-Managed Encryption Keys) columns
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS cmek_enabled BOOLEAN NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS cmek_key_arn VARCHAR(500) NULL
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS cmek_key_alias VARCHAR(255) NULL
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS cmek_key_region VARCHAR(20) NULL
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS cmek_last_rotation TIMESTAMP NULL
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS cmek_rotation_schedule_days INT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS cmek_rotation_schedule_days
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS cmek_last_rotation
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS cmek_key_region
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS cmek_key_alias
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS cmek_key_arn
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS cmek_enabled
    `);
  }
}
