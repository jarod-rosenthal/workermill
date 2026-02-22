import { MigrationInterface, QueryRunner } from "typeorm";

export class ChangeMaxPerStoryRevisionsDefault1740200000003 implements MigrationInterface {
  name = "ChangeMaxPerStoryRevisionsDefault1740200000003";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE organizations ALTER COLUMN max_per_story_revisions SET DEFAULT 1`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE organizations ALTER COLUMN max_per_story_revisions SET DEFAULT 2`,
    );
  }
}
