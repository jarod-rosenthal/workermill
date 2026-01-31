import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add Jarod to Brad's org for investigation
 */
export class AddJarodToBradOrg1705344000124 implements MigrationInterface {
  name = "AddJarodToBradOrg1705344000124";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const bradOrgId = '00000000-4769-437f-b050-1dbaf3b42da8';

    // Find Jarod's user ID (try multiple emails)
    const jarod = await queryRunner.query(`
      SELECT id, email FROM users
      WHERE email IN ('admin@localhost', 'jarod@workermill.com', 'user@example.com', 'jarod@therealjarod.com')
      LIMIT 1
    `);

    if (jarod.length === 0) {
      console.log('ERROR: Could not find Jarod user');
      return;
    }

    const jarodId = jarod[0].id;
    console.log(`Adding ${jarod[0].email} (${jarodId}) to Brad's org`);

    // Create UserOrganization record (don't change Jarod's default org)
    await queryRunner.query(`
      INSERT INTO user_organizations (id, user_id, org_id, role, is_default, joined_at, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, $2, 'admin', false, NOW(), NOW(), NOW())
      ON CONFLICT (user_id, org_id) DO NOTHING
    `, [jarodId, bradOrgId]);

    console.log('Added Jarod to Brad org as admin (non-default)');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove from Brad's org
    const bradOrgId = '00000000-4769-437f-b050-1dbaf3b42da8';
    await queryRunner.query(`
      DELETE FROM user_organizations
      WHERE org_id = $1
        AND user_id IN (SELECT id FROM users WHERE email IN ('admin@localhost', 'jarod@workermill.com', 'user@example.com', 'jarod@therealjarod.com'))
    `, [bradOrgId]);
  }
}
