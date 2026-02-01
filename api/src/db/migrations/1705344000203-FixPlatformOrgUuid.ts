import { MigrationInterface, QueryRunner } from "typeorm";

export class FixPlatformOrgUuid1705344000203 implements MigrationInterface {
  name = "FixPlatformOrgUuid1705344000203";

  // Old invalid UUID (doesn't pass express-validator isUUID check)
  private readonly OLD_PLATFORM_ORG_ID = "a0000000-0000-0000-0000-000000000001";
  // New valid UUID v4 format (version 4, variant 1)
  private readonly NEW_PLATFORM_ORG_ID = "a0000000-0000-4000-8000-000000000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if old platform org exists
    const existingOrg = await queryRunner.query(`
      SELECT id, name, slug, plan, max_concurrent_workers, default_worker_model
      FROM organizations WHERE id = $1
    `, [this.OLD_PLATFORM_ORG_ID]);

    if (existingOrg.length > 0) {
      console.log("Fixing platform org UUID from invalid to valid format...");
      const oldOrg = existingOrg[0];

      // Step 1: Clear is_platform_org on old org (to avoid unique constraint violation)
      await queryRunner.query(`
        UPDATE organizations SET is_platform_org = false WHERE id = $1
      `, [this.OLD_PLATFORM_ORG_ID]);

      // Step 2: Create new org with valid UUID (copying settings from old)
      await queryRunner.query(`
        INSERT INTO organizations (
          id, name, slug, plan, is_platform_org,
          max_concurrent_workers, default_worker_model,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, true, $5, $6, now(), now()
        )
        ON CONFLICT (id) DO NOTHING
      `, [
        this.NEW_PLATFORM_ORG_ID,
        oldOrg.name,
        oldOrg.slug + '-old', // Temp slug to avoid conflict
        oldOrg.plan,
        oldOrg.max_concurrent_workers,
        oldOrg.default_worker_model
      ]);

      // Step 3: Update user_organizations to point to new org
      await queryRunner.query(`
        UPDATE user_organizations SET org_id = $1 WHERE org_id = $2
      `, [this.NEW_PLATFORM_ORG_ID, this.OLD_PLATFORM_ORG_ID]);

      // Step 4: Delete old org
      await queryRunner.query(`
        DELETE FROM organizations WHERE id = $1
      `, [this.OLD_PLATFORM_ORG_ID]);

      // Step 5: Update new org to have correct slug
      await queryRunner.query(`
        UPDATE organizations SET slug = $1 WHERE id = $2
      `, [oldOrg.slug, this.NEW_PLATFORM_ORG_ID]);

      console.log("Platform org UUID fixed successfully");
    } else {
      console.log("Old platform org UUID not found, checking for new UUID...");

      // Check if new UUID already exists
      const newOrg = await queryRunner.query(`
        SELECT id FROM organizations WHERE id = $1 OR slug = 'workermill-platform'
      `, [this.NEW_PLATFORM_ORG_ID]);

      if (newOrg.length === 0) {
        // Create the platform org with the correct UUID
        await queryRunner.query(`
          INSERT INTO organizations (
            id, name, slug, plan, is_platform_org,
            max_concurrent_workers, default_worker_model,
            created_at, updated_at
          ) VALUES (
            $1, 'WorkerMill Platform', 'workermill-platform', 'enterprise', true,
            10, 'claude-sonnet-4-5-20250929', now(), now()
          )
        `, [this.NEW_PLATFORM_ORG_ID]);

        // Add jarod as owner
        const jarodUsers = await queryRunner.query(`
          SELECT id FROM users WHERE LOWER(email) = 'admin@localhost'
        `);

        if (jarodUsers.length > 0) {
          const userId = jarodUsers[0].id;
          await queryRunner.query(`
            UPDATE users SET support_admin = true WHERE id = $1
          `, [userId]);

          await queryRunner.query(`
            INSERT INTO user_organizations (id, user_id, org_id, role, is_default, created_at, updated_at)
            VALUES (gen_random_uuid(), $1, $2, 'owner', false, now(), now())
            ON CONFLICT (user_id, org_id) DO UPDATE SET role = 'owner'
          `, [userId, this.NEW_PLATFORM_ORG_ID]);
        }

        console.log("Platform org created with correct UUID");
      } else {
        console.log("Platform org already exists with correct UUID");
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert to old UUID if needed
    await queryRunner.query(`
      UPDATE user_organizations SET org_id = $1 WHERE org_id = $2
    `, [this.OLD_PLATFORM_ORG_ID, this.NEW_PLATFORM_ORG_ID]);

    await queryRunner.query(`
      UPDATE organizations SET id = $1 WHERE id = $2
    `, [this.OLD_PLATFORM_ORG_ID, this.NEW_PLATFORM_ORG_ID]);
  }
}
