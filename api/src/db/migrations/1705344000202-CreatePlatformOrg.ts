import { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePlatformOrg1705344000202 implements MigrationInterface {
  name = "CreatePlatformOrg1705344000202";

  // Fixed platform org ID for consistency across environments
  private readonly PLATFORM_ORG_ID = "a0000000-0000-0000-0000-000000000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if platform org already exists
    const existingOrg = await queryRunner.query(`
      SELECT id FROM organizations WHERE id = $1 OR slug = 'workermill-platform'
    `, [this.PLATFORM_ORG_ID]);

    if (existingOrg.length === 0) {
      // Create the platform org (WorkerMill Platform)
      await queryRunner.query(`
        INSERT INTO organizations (
          id, name, slug, plan, is_platform_org,
          max_concurrent_workers, default_worker_model,
          created_at, updated_at
        ) VALUES (
          $1, 'WorkerMill Platform', 'workermill-platform', 'enterprise', true,
          10, 'claude-sonnet-4-5-20250929', now(), now()
        )
      `, [this.PLATFORM_ORG_ID]);
    } else {
      // Update existing org to be platform org
      await queryRunner.query(`
        UPDATE organizations SET
          is_platform_org = true,
          plan = 'enterprise',
          max_concurrent_workers = 10
        WHERE id = $1 OR slug = 'workermill-platform'
      `, [this.PLATFORM_ORG_ID]);
    }

    // Find jarod's user and configure as platform admin
    const jarodUsers = await queryRunner.query(`
      SELECT id FROM users WHERE LOWER(email) = 'admin@localhost'
    `);

    if (jarodUsers.length > 0) {
      const userId = jarodUsers[0].id;

      // Ensure support admin flag is set
      await queryRunner.query(`
        UPDATE users SET support_admin = true WHERE id = $1
      `, [userId]);

      // Add to platform org via user_organizations junction table
      // Keep existing org memberships; add platform org as non-default
      await queryRunner.query(`
        INSERT INTO user_organizations (id, user_id, org_id, role, is_default, created_at, updated_at)
        VALUES (gen_random_uuid(), $1, $2, 'owner', false, now(), now())
        ON CONFLICT (user_id, org_id) DO UPDATE SET role = 'owner'
      `, [userId, this.PLATFORM_ORG_ID]);

      // Log the result
      console.log(`Platform org created and admin@localhost added as owner`);
    } else {
      console.log(`Warning: admin@localhost not found - platform org created without admin`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove user_organizations entries for platform org
    await queryRunner.query(`
      DELETE FROM user_organizations WHERE org_id = $1
    `, [this.PLATFORM_ORG_ID]);

    // Delete the platform org
    await queryRunner.query(`
      DELETE FROM organizations WHERE id = $1
    `, [this.PLATFORM_ORG_ID]);
  }
}
