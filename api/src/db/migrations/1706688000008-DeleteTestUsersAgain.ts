import { MigrationInterface, QueryRunner } from "typeorm";

export class DeleteTestUsersAgain1706688000008 implements MigrationInterface {
  name = "DeleteTestUsersAgain1706688000008";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No-op: customer-specific data migration removed for open-source release
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
