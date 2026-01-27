import { MigrationInterface, QueryRunner } from "typeorm";

export class CleanupTestUsers1705344000061 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Delete all users except admin@localhost
    await queryRunner.query(`
      DELETE FROM users
      WHERE LOWER(email) != 'admin@localhost'
    `);

    // Delete all pending invites
    await queryRunner.query(`
      DELETE FROM org_invites
    `);

    // Log remaining users
    const remaining = await queryRunner.query(`SELECT email FROM users`);
    console.log("Remaining users after cleanup:", remaining);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Cannot undo user deletion
    console.log("Warning: User cleanup cannot be undone");
  }
}
