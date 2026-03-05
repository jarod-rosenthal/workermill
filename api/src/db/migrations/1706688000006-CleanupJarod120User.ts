import { MigrationInterface, QueryRunner } from "typeorm";

export class CleanupJarod120User1706688000006 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // No-op: customer-specific data migration removed for open-source release
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op
  }
}
