import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * One-time data migration (already applied, converted to no-op)
 */
export class BackfillOncallshiftQualityMetrics1705344000071 implements MigrationInterface {
  public async up(_queryRunner: QueryRunner): Promise<void> {
    // no-op: one-time data migration already applied
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // no-op
  }
}
