import { MigrationInterface, QueryRunner } from "typeorm";

export class AddJarodToBradOrg1705344000124 implements MigrationInterface {
  name = "AddJarodToBradOrg1705344000124";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No-op: customer-specific data migration removed for open-source release
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
