import { MigrationInterface, QueryRunner } from "typeorm";

export class DeleteJarodTestUsers1706688000007 implements MigrationInterface {
  name = "DeleteJarodTestUsers1706688000007";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No-op: customer-specific data migration removed for open-source release
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
