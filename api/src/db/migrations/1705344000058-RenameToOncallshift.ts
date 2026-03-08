import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * One-time data migration (already applied, converted to no-op)
 */
export class RenameToOncallshift1705344000058 implements MigrationInterface {
  name = "RenameToOncallshift1705344000058";

  public async up(_queryRunner: QueryRunner): Promise<void> {
    // no-op: one-time data migration already applied
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // no-op
  }
}
