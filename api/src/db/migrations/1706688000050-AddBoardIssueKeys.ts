import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Derive a short prefix from a board name for use as an issue key prefix.
 * - Multi-word: first letter of each word, uppercase ("CalMill" -> "CM", "TaskPulse Dashboard" -> "TPD")
 * - Single word: first 2-3 chars uppercase ("Bugs" -> "BUG")
 * - camelCase is split on boundaries ("camelCase" -> "CC")
 */
function derivePrefix(name: string): string {
  // Split on spaces, hyphens, underscores, and camelCase boundaries
  const words = name
    .replace(/([a-z])([A-Z])/g, "$1 $2") // camelCase split
    .split(/[\s\-_]+/)
    .filter((w) => w.length > 0);

  if (words.length >= 2) {
    // Multi-word: first letter of each word
    return words
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  }

  // Single word: first 2-3 chars
  const word = words[0] || "BD";
  if (word.length <= 3) {
    return word.toUpperCase();
  }
  return word.substring(0, 3).toUpperCase();
}

export class AddBoardIssueKeys1706688000050 implements MigrationInterface {
  name = "AddBoardIssueKeys1706688000050";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add prefix and next_card_number columns to kb_boards
    await queryRunner.query(`
      ALTER TABLE "kb_boards"
      ADD COLUMN IF NOT EXISTS "prefix" varchar(10),
      ADD COLUMN IF NOT EXISTS "next_card_number" int NOT NULL DEFAULT 1
    `);

    // 2. Add card_number column to kb_cards
    await queryRunner.query(`
      ALTER TABLE "kb_cards"
      ADD COLUMN IF NOT EXISTS "card_number" int
    `);

    // 3. Backfill prefixes for existing boards
    const boards: Array<{ id: string; org_id: string; name: string }> =
      await queryRunner.query(`
        SELECT "id", "org_id", "name" FROM "kb_boards" WHERE "prefix" IS NULL
      `);

    // Track used prefixes per org to handle collisions
    const usedPrefixesByOrg = new Map<string, Set<string>>();

    // Also load any already-set prefixes (in case of partial re-run)
    const existingPrefixes: Array<{ org_id: string; prefix: string }> =
      await queryRunner.query(`
        SELECT "org_id", "prefix" FROM "kb_boards" WHERE "prefix" IS NOT NULL
      `);
    for (const row of existingPrefixes) {
      if (!usedPrefixesByOrg.has(row.org_id)) {
        usedPrefixesByOrg.set(row.org_id, new Set());
      }
      usedPrefixesByOrg.get(row.org_id)!.add(row.prefix);
    }

    for (const board of boards) {
      if (!usedPrefixesByOrg.has(board.org_id)) {
        usedPrefixesByOrg.set(board.org_id, new Set());
      }
      const usedInOrg = usedPrefixesByOrg.get(board.org_id)!;

      let prefix = derivePrefix(board.name);

      // Handle per-org collisions by appending digits
      if (usedInOrg.has(prefix)) {
        let counter = 2;
        while (usedInOrg.has(`${prefix}${counter}`)) {
          counter++;
        }
        prefix = `${prefix}${counter}`;
      }

      usedInOrg.add(prefix);

      await queryRunner.query(
        `UPDATE "kb_boards" SET "prefix" = $1 WHERE "id" = $2`,
        [prefix, board.id],
      );
    }

    // 4. Make prefix NOT NULL after backfill
    await queryRunner.query(`
      ALTER TABLE "kb_boards"
      ALTER COLUMN "prefix" SET NOT NULL
    `);

    // 5. Add unique index on (org_id, prefix)
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_kb_boards_org_prefix"
      ON "kb_boards" ("org_id", "prefix")
    `);

    // 6. Backfill card_number for existing cards using ROW_NUMBER() ordered by created_at per board
    await queryRunner.query(`
      UPDATE "kb_cards" AS c
      SET "card_number" = sub.rn
      FROM (
        SELECT "id", ROW_NUMBER() OVER (PARTITION BY "board_id" ORDER BY "created_at" ASC) AS rn
        FROM "kb_cards"
        WHERE "card_number" IS NULL
      ) AS sub
      WHERE c."id" = sub."id"
    `);

    // 7. Update next_card_number on each board to MAX(card_number) + 1
    await queryRunner.query(`
      UPDATE "kb_boards" AS b
      SET "next_card_number" = sub.next_num
      FROM (
        SELECT "board_id", COALESCE(MAX("card_number"), 0) + 1 AS next_num
        FROM "kb_cards"
        GROUP BY "board_id"
      ) AS sub
      WHERE b."id" = sub."board_id"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_kb_boards_org_prefix"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kb_cards" DROP COLUMN IF EXISTS "card_number"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kb_boards" DROP COLUMN IF EXISTS "next_card_number"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kb_boards" DROP COLUMN IF EXISTS "prefix"`,
    );
  }
}
