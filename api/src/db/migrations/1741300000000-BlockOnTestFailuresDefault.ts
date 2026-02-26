import { MigrationInterface, QueryRunner } from "typeorm";

export class BlockOnTestFailuresDefault1741300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Change the column default to true
    await queryRunner.query(`
      ALTER TABLE organizations ALTER COLUMN block_on_test_failures SET DEFAULT true
    `);

    // Update existing orgs that have the old default
    await queryRunner.query(`
      UPDATE organizations SET block_on_test_failures = true WHERE block_on_test_failures = false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE organizations ALTER COLUMN block_on_test_failures SET DEFAULT false
    `);
  }
}
