import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrateEnterpriseUsers1705344000126 implements MigrationInterface {
  name = "MigrateEnterpriseUsers1705344000126";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No-op: customer-specific data migration removed for open-source release
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
