import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * One-time data migration (already applied, converted to no-op)
 */
export class FixOncallshiftRename1705344000059 implements MigrationInterface {
  name = "FixOncallshiftRename1705344000059";

  public async up(_queryRunner: QueryRunner): Promise<void> {
    // no-op: one-time data migration already applied
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // no-op
  }
}
