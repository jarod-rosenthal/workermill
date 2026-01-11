import { MigrationInterface, QueryRunner } from "typeorm";

export class GenerateOrgApiKeys1704067200007 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Generate API keys for all organizations that don't have one
    // Use uuid_generate_v4() which is already available (used in other tables)
    // Generate multiple UUIDs and concatenate them for a long key
    await queryRunner.query(`
      UPDATE organizations
      SET api_key = 'wm_' || REPLACE(uuid_generate_v4()::text || uuid_generate_v4()::text, '-', '')
      WHERE api_key IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Don't remove API keys on downgrade - they may be in use
  }
}
