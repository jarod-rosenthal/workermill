import { MigrationInterface, QueryRunner } from "typeorm";

export class MakeUserOrgIdNullable1705344000019 implements MigrationInterface {
  name = "MakeUserOrgIdNullable1705344000019";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Make org_id nullable to support users pending org setup
    await queryRunner.query(`
      ALTER TABLE users
      ALTER COLUMN org_id DROP NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Note: This will fail if any users have null org_id
    await queryRunner.query(`
      ALTER TABLE users
      ALTER COLUMN org_id SET NOT NULL
    `);
  }
}
