import { MigrationInterface, QueryRunner } from "typeorm";

export class DiagnoseBradOrg1705344000123 implements MigrationInterface {
  name = "DiagnoseBradOrg1705344000123";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No-op: customer-specific data migration removed for open-source release
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
