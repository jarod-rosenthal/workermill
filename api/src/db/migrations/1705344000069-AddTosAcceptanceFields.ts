import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTosAcceptanceFields1705344000069 implements MigrationInterface {
  name = "AddTosAcceptanceFields1705344000069";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS tos_accepted_at TIMESTAMP;
    `);

    await queryRunner.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS tos_version VARCHAR(20);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users DROP COLUMN IF EXISTS tos_version;
    `);

    await queryRunner.query(`
      ALTER TABLE users DROP COLUMN IF EXISTS tos_accepted_at;
    `);
  }
}
