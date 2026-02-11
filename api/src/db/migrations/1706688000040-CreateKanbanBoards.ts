import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateKanbanBoards1706688000040 implements MigrationInterface {
  name = "CreateKanbanBoards1706688000040";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // kb_boards
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kb_boards" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "org_id" uuid NOT NULL,
        "name" varchar(200) NOT NULL,
        "description" text,
        "position" int NOT NULL DEFAULT 0,
        "template" varchar(50),
        "created_by" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kb_boards" PRIMARY KEY ("id"),
        CONSTRAINT "FK_kb_boards_org" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_kb_boards_user" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_kb_boards_org_id" ON "kb_boards" ("org_id")`);

    // kb_columns
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kb_columns" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "board_id" uuid NOT NULL,
        "name" varchar(100) NOT NULL,
        "position" int NOT NULL DEFAULT 0,
        "color" varchar(20),
        "wip_limit" int,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kb_columns" PRIMARY KEY ("id"),
        CONSTRAINT "FK_kb_columns_board" FOREIGN KEY ("board_id") REFERENCES "kb_boards"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_kb_columns_board_id" ON "kb_columns" ("board_id")`);

    // kb_cards
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kb_cards" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "board_id" uuid NOT NULL,
        "column_id" uuid NOT NULL,
        "title" varchar(500) NOT NULL,
        "description" text,
        "position" int NOT NULL DEFAULT 0,
        "priority" varchar(20),
        "due_date" timestamptz,
        "assignee_id" uuid,
        "cover_color" varchar(20),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kb_cards" PRIMARY KEY ("id"),
        CONSTRAINT "FK_kb_cards_board" FOREIGN KEY ("board_id") REFERENCES "kb_boards"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_kb_cards_column" FOREIGN KEY ("column_id") REFERENCES "kb_columns"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_kb_cards_assignee" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_kb_cards_board_id" ON "kb_cards" ("board_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_kb_cards_column_id" ON "kb_cards" ("column_id")`);

    // kb_labels
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kb_labels" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "org_id" uuid NOT NULL,
        "name" varchar(100) NOT NULL,
        "color" varchar(20) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kb_labels" PRIMARY KEY ("id"),
        CONSTRAINT "FK_kb_labels_org" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_kb_labels_org_id" ON "kb_labels" ("org_id")`);

    // kb_card_labels (composite PK)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kb_card_labels" (
        "card_id" uuid NOT NULL,
        "label_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kb_card_labels" PRIMARY KEY ("card_id", "label_id"),
        CONSTRAINT "FK_kb_card_labels_card" FOREIGN KEY ("card_id") REFERENCES "kb_cards"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_kb_card_labels_label" FOREIGN KEY ("label_id") REFERENCES "kb_labels"("id") ON DELETE CASCADE
      )
    `);

    // kb_comments
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kb_comments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "card_id" uuid NOT NULL,
        "author_id" uuid,
        "content" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kb_comments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_kb_comments_card" FOREIGN KEY ("card_id") REFERENCES "kb_cards"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_kb_comments_author" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_kb_comments_card_id" ON "kb_comments" ("card_id")`);

    // kb_checklist_items
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kb_checklist_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "card_id" uuid NOT NULL,
        "title" varchar(500) NOT NULL,
        "is_completed" boolean NOT NULL DEFAULT false,
        "position" int NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kb_checklist_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_kb_checklist_card" FOREIGN KEY ("card_id") REFERENCES "kb_cards"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_kb_checklist_card_id" ON "kb_checklist_items" ("card_id")`);

    // kb_activities
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kb_activities" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "board_id" uuid NOT NULL,
        "user_id" uuid,
        "action" varchar(50) NOT NULL,
        "entity_type" varchar(50) NOT NULL,
        "entity_id" uuid,
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kb_activities" PRIMARY KEY ("id"),
        CONSTRAINT "FK_kb_activities_board" FOREIGN KEY ("board_id") REFERENCES "kb_boards"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_kb_activities_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_kb_activities_board_id" ON "kb_activities" ("board_id")`);

    // kb_starred_boards (composite PK)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kb_starred_boards" (
        "user_id" uuid NOT NULL,
        "board_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kb_starred_boards" PRIMARY KEY ("user_id", "board_id"),
        CONSTRAINT "FK_kb_starred_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_kb_starred_board" FOREIGN KEY ("board_id") REFERENCES "kb_boards"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "kb_starred_boards"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kb_activities"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kb_checklist_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kb_comments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kb_card_labels"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kb_labels"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kb_cards"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kb_columns"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kb_boards"`);
  }
}
