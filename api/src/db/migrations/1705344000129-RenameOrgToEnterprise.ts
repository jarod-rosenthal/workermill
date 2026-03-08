import { MigrationInterface, QueryRunner } from "typeorm";

export class RenameOrgToEnterprise1705344000129 implements MigrationInterface {
  name = "RenameOrgToEnterprise1705344000129";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No-op: customer-specific data migration removed for open-source release
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
