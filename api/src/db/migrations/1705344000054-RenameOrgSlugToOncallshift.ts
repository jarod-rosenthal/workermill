import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * One-time data migration (already applied, converted to no-op)
 */
export class RenameOrgSlugToOncallshift1705344000054 implements MigrationInterface {
  name = "RenameOrgSlugToOncallshift1705344000054";

  public async up(_queryRunner: QueryRunner): Promise<void> {
    // no-op: one-time data migration already applied
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // no-op
  }
}
