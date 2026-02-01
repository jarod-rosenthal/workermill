import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDefaultBitbucketRepo1706688000010 implements MigrationInterface {
  name = "AddDefaultBitbucketRepo1706688000010";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add separate default repo fields for each SCM provider
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS default_bitbucket_repo VARCHAR(255) NULL
    `);

    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS default_gitlab_repo VARCHAR(255) NULL
    `);

    // Migrate existing defaultGithubRepo to the appropriate provider-specific field
    // based on the organization's current scmProvider setting
    await queryRunner.query(`
      UPDATE organizations
      SET default_bitbucket_repo = default_github_repo
      WHERE scm_provider = 'bitbucket' AND default_github_repo IS NOT NULL
    `);

    await queryRunner.query(`
      UPDATE organizations
      SET default_gitlab_repo = default_github_repo
      WHERE scm_provider = 'gitlab' AND default_github_repo IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations DROP COLUMN IF EXISTS default_bitbucket_repo
    `);

    await queryRunner.query(`
      ALTER TABLE organizations DROP COLUMN IF EXISTS default_gitlab_repo
    `);
  }
}
