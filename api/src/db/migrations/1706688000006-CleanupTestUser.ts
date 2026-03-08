import { MigrationInterface, QueryRunner } from "typeorm";

export class CleanupTestUser1706688000006 implements MigrationInterface {
  name = "CleanupTestUser1706688000006";
  public async up(queryRunner: QueryRunner): Promise<void> {
    // No-op: customer-specific data migration removed for open-source release
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
