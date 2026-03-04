import { MigrationInterface, QueryRunner } from "typeorm";

export class DiagnoseOtherInvites1705344000125 implements MigrationInterface {
  name = "DiagnoseOtherInvites1705344000125";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No-op: customer-specific data migration removed for open-source release
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
