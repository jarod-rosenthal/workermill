import { MigrationInterface, QueryRunner } from "typeorm";

export class AddGithubRepoToKbCards1706688000049 implements MigrationInterface {
  name = "AddGithubRepoToKbCards1706688000049";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kb_cards"
      ADD COLUMN IF NOT EXISTS "github_repo" varchar(255)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "kb_cards" DROP COLUMN IF EXISTS "github_repo"`);
  }
}
