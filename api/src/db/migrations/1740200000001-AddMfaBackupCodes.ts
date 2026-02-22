import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMfaBackupCodes1740200000001 implements MigrationInterface {
  name = "AddMfaBackupCodes1740200000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_backup_codes JSONB DEFAULT '[]';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users DROP COLUMN IF EXISTS mfa_backup_codes;
    `);
  }
}
