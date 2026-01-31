import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * One-time diagnostic: Find Brad's user and org info
 * READ-ONLY - no data changes
 */
export class DiagnoseBradUser1705344000122 implements MigrationInterface {
  name = "DiagnoseBradUser1705344000122";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Find Brad's user record
    const bradUser = await queryRunner.query(`
      SELECT
        u.id,
        u.email,
        u.role,
        u.org_id,
        u.cognito_id IS NOT NULL as has_cognito,
        u.created_at,
        o.name as org_name,
        o.slug as org_slug
      FROM users u
      LEFT JOIN organizations o ON o.id = u.org_id
      WHERE LOWER(u.email) = 'brad.hawkins@mevion.com'
    `);
    console.log('=== BRAD USER ===');
    console.log(JSON.stringify(bradUser, null, 2));

    // Find Mevion org
    const mevionOrg = await queryRunner.query(`
      SELECT id, name, slug, created_at
      FROM organizations
      WHERE LOWER(name) LIKE '%mevion%'
    `);
    console.log('=== MEVION ORG ===');
    console.log(JSON.stringify(mevionOrg, null, 2));

    // Find pending invite for Brad
    const bradInvite = await queryRunner.query(`
      SELECT
        oi.id,
        oi.email,
        oi.org_id,
        oi.role,
        oi.accepted,
        oi.expires_at,
        o.name as inviting_org_name
      FROM org_invites oi
      LEFT JOIN organizations o ON o.id = oi.org_id
      WHERE LOWER(oi.email) = 'brad.hawkins@mevion.com'
    `);
    console.log('=== BRAD INVITE ===');
    console.log(JSON.stringify(bradInvite, null, 2));

    // Find all Mevion members
    const mevionMembers = await queryRunner.query(`
      SELECT u.id, u.email, u.role, u.org_id
      FROM users u
      INNER JOIN organizations o ON o.id = u.org_id
      WHERE LOWER(o.name) LIKE '%mevion%'
    `);
    console.log('=== MEVION MEMBERS ===');
    console.log(JSON.stringify(mevionMembers, null, 2));

    // All pending Mevion invites
    const mevionInvites = await queryRunner.query(`
      SELECT oi.email, oi.role, oi.accepted, oi.expires_at
      FROM org_invites oi
      INNER JOIN organizations o ON o.id = oi.org_id
      WHERE LOWER(o.name) LIKE '%mevion%'
    `);
    console.log('=== MEVION PENDING INVITES ===');
    console.log(JSON.stringify(mevionInvites, null, 2));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Read-only, nothing to undo
  }
}
