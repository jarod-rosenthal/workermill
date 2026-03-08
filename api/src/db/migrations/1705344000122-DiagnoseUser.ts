import { MigrationInterface, QueryRunner } from "typeorm";

export class DiagnoseBradUser1705344000122 implements MigrationInterface {
  name = "DiagnoseBradUser1705344000122";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No-op: customer-specific data migration removed for open-source release
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
