import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserApiKeyOrgId1705344000033 implements MigrationInterface {
  name = "AddUserApiKeyOrgId1705344000033";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add org_id column if it doesn't exist
    await queryRunner.query(`
      ALTER TABLE user_api_keys
      ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE
    `);

    // For any existing keys without org_id, set it from the user's org
    await queryRunner.query(`
      UPDATE user_api_keys
      SET org_id = users.org_id
      FROM users
      WHERE user_api_keys.user_id = users.id
        AND user_api_keys.org_id IS NULL
        AND users.org_id IS NOT NULL
    `);

    // Make org_id NOT NULL after backfilling
    await queryRunner.query(`
      ALTER TABLE user_api_keys
      ALTER COLUMN org_id SET NOT NULL
    `);

    // Add index for org_id
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_user_api_keys_org_id
      ON user_api_keys(org_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_user_api_keys_org_id`);
    await queryRunner.query(`ALTER TABLE user_api_keys DROP COLUMN IF EXISTS org_id`);
  }
}
