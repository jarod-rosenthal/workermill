import { MigrationInterface, QueryRunner } from "typeorm";

export class CleanupTestUsers1705344000061 implements MigrationInterface {
  public async up(_queryRunner: QueryRunner): Promise<void> {
    // No-op: customer-specific data migration removed for open-source release
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
