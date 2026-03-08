import { MigrationInterface, QueryRunner } from "typeorm";

export class DeleteJarodTestUsersAgain1706688000008 implements MigrationInterface {
  name = "DeleteJarodTestUsersAgain1706688000008";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No-op: customer-specific data migration removed for open-source release
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
