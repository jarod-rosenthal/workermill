import { MigrationInterface, QueryRunner } from "typeorm";

export class SetSupportAdminForUser1705344000121 implements MigrationInterface {
  name = "SetSupportAdminForUser1705344000121";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No-op: customer-specific data migration removed for open-source release
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
