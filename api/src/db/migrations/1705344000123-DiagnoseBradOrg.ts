import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * One-time diagnostic: Who else is in Brad's personal org?
 * READ-ONLY - no data changes
 */
export class DiagnoseBradOrg1705344000123 implements MigrationInterface {
  name = "DiagnoseBradOrg1705344000123";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Brad's personal org ID
    const bradOrgId = '0e40e770-4769-437f-b050-1dbaf3b42da8';

    // All users in Brad's personal org
    const usersInBradOrg = await queryRunner.query(`
      SELECT u.id, u.email, u.role, u.created_at
      FROM users u
      WHERE u.org_id = $1
    `, [bradOrgId]);
    console.log('=== USERS IN BRAD ORG ===');
    console.log(JSON.stringify(usersInBradOrg, null, 2));

    // Check if Brad's org has any tasks
    const tasksInBradOrg = await queryRunner.query(`
      SELECT COUNT(*) as task_count
      FROM worker_tasks wt
      WHERE wt.org_id = $1
    `, [bradOrgId]);
    console.log('=== TASKS IN BRAD ORG ===');
    console.log(JSON.stringify(tasksInBradOrg, null, 2));

    // Check for any secrets for Brad's org in naming pattern
    console.log('=== BRAD ORG SECRETS PATH ===');
    console.log(`workermill/dev/orgs/${bradOrgId}/`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Read-only
  }
}
