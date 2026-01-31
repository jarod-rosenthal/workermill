import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Set supportAdmin flag for platform owner
 * This grants access to cross-tenant diagnostic endpoints
 */
export class SetSupportAdminForJarod1705344000121 implements MigrationInterface {
  name = "SetSupportAdminForJarod1705344000121";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Set supportAdmin for the platform owner
    await queryRunner.query(`
      UPDATE users
      SET support_admin = true
      WHERE email IN ('jarod@workermill.com', 'user@example.com', 'jarod@therealjarod.com')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE users
      SET support_admin = false
      WHERE email IN ('jarod@workermill.com', 'user@example.com', 'jarod@therealjarod.com')
    `);
  }
}
