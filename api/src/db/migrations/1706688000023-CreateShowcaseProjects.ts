import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateShowcaseProjects1706688000023 implements MigrationInterface {
  name = "CreateShowcaseProjects1706688000023";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "showcase_projects" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar(100) NOT NULL,
        "tagline" varchar(200) NOT NULL,
        "description" text NOT NULL,
        "stack" varchar(200) NOT NULL,
        "story_count" int NOT NULL,
        "cost" varchar(20) NOT NULL,
        "duration" varchar(20) NOT NULL,
        "repo_url" varchar(500),
        "live_url" varchar(500),
        "task_log_url" varchar(500),
        "category" varchar(50) NOT NULL,
        "is_featured" boolean NOT NULL DEFAULT false,
        "display_order" int NOT NULL DEFAULT 0,
        "build_metadata" jsonb,
        "stories" jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_showcase_projects" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_showcase_projects_category" ON "showcase_projects" ("category")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_showcase_projects_display_order" ON "showcase_projects" ("display_order")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "showcase_projects"`);
  }
}
