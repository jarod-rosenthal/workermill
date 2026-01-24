import { MigrationInterface, QueryRunner } from "typeorm";

export class ExtendUserEmailPreferences1705344000028 implements MigrationInterface {
  name = "ExtendUserEmailPreferences1705344000028";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Update existing user preferences to include email section with defaults
    // Only update users that don't already have email preferences
    await queryRunner.query(`
      UPDATE users
      SET preferences = preferences || '{"email": {"taskCompleted": true, "taskFailed": true, "costAlerts": true, "prCreated": false, "frequency": "immediate"}}'::jsonb
      WHERE preferences->>'email' IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove email preferences from all users
    await queryRunner.query(`
      UPDATE users
      SET preferences = preferences - 'email'
      WHERE preferences ? 'email'
    `);
  }
}
