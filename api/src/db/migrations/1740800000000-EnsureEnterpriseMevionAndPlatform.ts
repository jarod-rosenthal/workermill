import { MigrationInterface, QueryRunner } from "typeorm";

export class EnsureEnterpriseMevionAndPlatform1740800000000
  implements MigrationInterface
{
  name = "EnsureEnterpriseMevionAndPlatform1740800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // No-op: customer-specific data migration removed for open-source release
  }

  public async down(): Promise<void> {
    // No-op
  }
}
