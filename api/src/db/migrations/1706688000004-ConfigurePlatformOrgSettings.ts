import { MigrationInterface, QueryRunner } from "typeorm";

export class ConfigurePlatformOrgSettings1706688000004 implements MigrationInterface {
  name = "ConfigurePlatformOrgSettings1706688000004";

  private readonly PLATFORM_ORG_ID = "a0000000-0000-4000-8000-000000000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Generate API key for platform org if not set
    const result = await queryRunner.query(
      `SELECT api_key FROM organizations WHERE id = $1`,
      [this.PLATFORM_ORG_ID]
    );

    if (result.length > 0 && !result[0].api_key) {
      // Generate a new API key
      const apiKey = `org_${this.generateRandomHex(32)}`;
      await queryRunner.query(
        `UPDATE organizations SET api_key = $1 WHERE id = $2`,
        [apiKey, this.PLATFORM_ORG_ID]
      );
      console.log(`Generated API key for platform org: ${apiKey.substring(0, 15)}...`);
    }

    // Configure platform org settings for running support agents
    await queryRunner.query(`
      UPDATE organizations SET
        scm_provider = 'github',
        default_github_repo = 'jarod-rosenthal/workermill',
        system_enabled = true,
        primary_provider = 'anthropic',
        default_worker_model = 'claude-haiku-4-5-20251001',
        default_worker_persona = 'support_agent',
        updated_at = now()
      WHERE id = $1
    `, [this.PLATFORM_ORG_ID]);

    console.log("Platform org configured for running support agents");
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reset platform org to default settings (don't remove API key)
    await queryRunner.query(`
      UPDATE organizations SET
        scm_provider = 'github',
        default_github_repo = NULL,
        default_worker_persona = 'backend_developer',
        updated_at = now()
      WHERE id = $1
    `, [this.PLATFORM_ORG_ID]);
  }

  private generateRandomHex(length: number): string {
    const chars = "0123456789abcdef";
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  }
}
