import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * DEPRECATED: This migration was replaced by MoveUsersToBradOrg1705344000127.
 * Kept as no-op to maintain migration history.
 */
export class MigrateMevionUsers1705344000126 implements MigrationInterface {
  name = "MigrateMevionUsers1705344000126";

  public async up(_queryRunner: QueryRunner): Promise<void> {
    console.log(
      "SKIP: MigrateMevionUsers1705344000126 - replaced by MoveUsersToBradOrg1705344000127"
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
