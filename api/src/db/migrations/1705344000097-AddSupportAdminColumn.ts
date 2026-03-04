import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add support_admin boolean column to users table
 * This flag grants access to the Support Admin dashboard
 * Only support admins can view all tickets from all tenants
 */
export class AddSupportAdminColumn1705344000097 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add support_admin column with default false
    await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS support_admin BOOLEAN NOT NULL DEFAULT FALSE
    `);

    // Set the seed/admin user as support admin
    const adminEmail = process.env.SEED_EMAIL || "admin@localhost";
    await queryRunner.query(`
      UPDATE users
      SET support_admin = TRUE
      WHERE email = $1
    `, [adminEmail]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
      DROP COLUMN IF EXISTS support_admin
    `);
  }
}
