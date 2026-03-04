import { MigrationInterface, QueryRunner } from "typeorm";

export class FixMevionUsersAndCleanupOrgs1706688000005 implements MigrationInterface {
  name = "FixMevionUsersAndCleanupOrgs1706688000005";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No-op: customer-specific data migration removed for open-source release
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
