import { MigrationInterface, QueryRunner } from "typeorm";

export class DeleteTestInvite1706688000002 implements MigrationInterface {
  name = "DeleteTestInvite1706688000002";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No-op: customer-specific data migration removed for open-source release
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
