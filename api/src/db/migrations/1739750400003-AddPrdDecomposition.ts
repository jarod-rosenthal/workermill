import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPrdDecomposition1739750400003 implements MigrationInterface {
  name = "AddPrdDecomposition1739750400003";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create kb_card_dependencies table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kb_card_dependencies" (
        "card_id" uuid NOT NULL,
        "depends_on_card_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kb_card_dependencies" PRIMARY KEY ("card_id", "depends_on_card_id"),
        CONSTRAINT "FK_kb_card_deps_card" FOREIGN KEY ("card_id") REFERENCES "kb_cards"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_kb_card_deps_depends_on" FOREIGN KEY ("depends_on_card_id") REFERENCES "kb_cards"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_kb_card_deps_no_self" CHECK ("card_id" != "depends_on_card_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_kb_card_deps_depends_on" ON "kb_card_dependencies" ("depends_on_card_id")`,
    );

    // 2. Add PRD columns to kb_boards
    await queryRunner.query(`
      ALTER TABLE "kb_boards"
      ADD COLUMN IF NOT EXISTS "prd_content" text,
      ADD COLUMN IF NOT EXISTS "prd_source" varchar(20),
      ADD COLUMN IF NOT EXISTS "github_repo" varchar(255)
    `);

    // 3. Add prd_auto_run to organizations
    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "prd_auto_run" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organizations"
      DROP COLUMN IF EXISTS "prd_auto_run"
    `);
    await queryRunner.query(`
      ALTER TABLE "kb_boards"
      DROP COLUMN IF EXISTS "github_repo",
      DROP COLUMN IF EXISTS "prd_source",
      DROP COLUMN IF EXISTS "prd_content"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_kb_card_deps_depends_on"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kb_card_dependencies"`);
  }
}
