import { MigrationInterface, QueryRunner } from "typeorm";
import bcrypt from "bcrypt";

export class HashOrgApiKeys1739750400002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add api_key_hash and api_key_prefix columns
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS api_key_hash VARCHAR(255),
      ADD COLUMN IF NOT EXISTS api_key_prefix VARCHAR(12)
    `);

    // Create index on api_key_prefix for fast lookups
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_organizations_api_key_prefix
      ON organizations (api_key_prefix)
      WHERE api_key_prefix IS NOT NULL
    `);

    // Read all orgs with non-null apiKey and hash them
    const orgs: { id: string; api_key: string }[] = await queryRunner.query(
      `SELECT id, api_key FROM organizations WHERE api_key IS NOT NULL`,
    );

    for (const org of orgs) {
      const hash = await bcrypt.hash(org.api_key, 10);
      const prefix = org.api_key.substring(0, 12);

      // Keep api_key for spawner use (ECS/local workers read it to authenticate back to API).
      // Auth middleware now uses hash-based lookup. Raw key can be moved to Secrets Manager later.
      await queryRunner.query(
        `UPDATE organizations SET api_key_hash = $1, api_key_prefix = $2 WHERE id = $3`,
        [hash, prefix, org.id],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Cannot reverse the hash — just drop the columns
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_organizations_api_key_prefix
    `);
    await queryRunner.query(`
      ALTER TABLE organizations
      DROP COLUMN IF EXISTS api_key_hash,
      DROP COLUMN IF EXISTS api_key_prefix
    `);
  }
}
