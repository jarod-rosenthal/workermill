import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserToOrg1705344000124 implements MigrationInterface {
  name = "AddUserToOrg1705344000124";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No-op: customer-specific data migration removed for open-source release
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
