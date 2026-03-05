import { MigrationInterface, QueryRunner } from "typeorm";

export class ConfigurePlatformOrgSettings1706688000004 implements MigrationInterface {
  name = "ConfigurePlatformOrgSettings1706688000004";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No-op: customer-specific data migration removed for open-source release
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
