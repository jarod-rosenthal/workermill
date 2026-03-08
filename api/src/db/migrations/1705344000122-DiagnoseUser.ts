import { MigrationInterface, QueryRunner } from "typeorm";

export class DiagnoseUser1705344000122 implements MigrationInterface {
  name = "DiagnoseUser1705344000122";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No-op: customer-specific data migration removed for open-source release
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
