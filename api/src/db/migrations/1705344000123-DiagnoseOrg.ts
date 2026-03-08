import { MigrationInterface, QueryRunner } from "typeorm";

export class DiagnoseOrg1705344000123 implements MigrationInterface {
  name = "DiagnoseOrg1705344000123";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No-op: customer-specific data migration removed for open-source release
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
