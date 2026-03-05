import { MigrationInterface, QueryRunner } from "typeorm";

export class SetupEnterpriseOrgs1705344000093 implements MigrationInterface {
  name = "SetupEnterpriseOrgs1705344000093";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No-op: customer-specific data migration removed for open-source release
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
