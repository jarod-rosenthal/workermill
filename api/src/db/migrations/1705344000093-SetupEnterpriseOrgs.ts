import { MigrationInterface, QueryRunner } from "typeorm";
import { randomBytes } from "crypto";

/**
 * Set up AI Sewer and Mevion as Enterprise organizations with proper configuration
 */
export class SetupEnterpriseOrgs1705344000093 implements MigrationInterface {
  name = "SetupEnterpriseOrgs1705344000093";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Helper to generate slug from name
    const generateSlug = (name: string): string => {
      return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    };

    // Helper to generate API key
    const generateApiKey = (): string => {
      return randomBytes(32).toString("hex");
    };

    // Enterprise plan quotas
    const enterpriseQuota = 999999; // Effectively unlimited

    // Update AI Sewer
    await queryRunner.query(`
      UPDATE organizations
      SET
        slug = $1,
        plan = 'enterprise',
        task_quota = $2,
        api_key = COALESCE(api_key, $3),
        max_concurrent_workers = 10,
        default_worker_model = COALESCE(default_worker_model, 'claude-sonnet-4'),
        default_worker_persona = COALESCE(default_worker_persona, 'backend_developer'),
        log_retention_days = 90,
        task_retention_days = 365
      WHERE name = 'AI Sewer' AND (slug IS NULL OR plan != 'enterprise')
    `, [generateSlug("AI Sewer"), enterpriseQuota, generateApiKey()]);

    // Update Mevion
    await queryRunner.query(`
      UPDATE organizations
      SET
        slug = $1,
        plan = 'enterprise',
        task_quota = $2,
        api_key = COALESCE(api_key, $3),
        max_concurrent_workers = 10,
        default_worker_model = COALESCE(default_worker_model, 'claude-sonnet-4'),
        default_worker_persona = COALESCE(default_worker_persona, 'backend_developer'),
        log_retention_days = 90,
        task_retention_days = 365
      WHERE name = 'Mevion' AND (slug IS NULL OR plan != 'enterprise')
    `, [generateSlug("Mevion"), enterpriseQuota, generateApiKey()]);

    // Log what was updated
    const aiSewer = await queryRunner.query(`SELECT id, name, slug, plan FROM organizations WHERE name = 'AI Sewer'`);
    const mevion = await queryRunner.query(`SELECT id, name, slug, plan FROM organizations WHERE name = 'Mevion'`);

    console.log("Updated AI Sewer:", aiSewer);
    console.log("Updated Mevion:", mevion);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert to free plan (but keep slug and API key)
    await queryRunner.query(`
      UPDATE organizations
      SET plan = 'free', task_quota = 10
      WHERE name IN ('AI Sewer', 'Mevion')
    `);
  }
}
