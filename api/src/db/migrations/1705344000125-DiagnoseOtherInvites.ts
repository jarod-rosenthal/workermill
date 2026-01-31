import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Diagnose the other pending invites - areid and tshelley
 */
export class DiagnoseOtherInvites1705344000125 implements MigrationInterface {
  name = "DiagnoseOtherInvites1705344000125";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const emails = ['redacted@example.com', 'redacted@example.com'];

    for (const email of emails) {
      console.log(`\n=== CHECKING ${email} ===`);

      // Check if user exists
      const user = await queryRunner.query(`
        SELECT u.id, u.email, u.org_id, u.role, u.cognito_id IS NOT NULL as has_cognito,
               o.name as org_name, o.slug as org_slug
        FROM users u
        LEFT JOIN organizations o ON o.id = u.org_id
        WHERE LOWER(u.email) = LOWER($1)
      `, [email]);

      if (user.length > 0) {
        console.log('USER EXISTS:');
        console.log(JSON.stringify(user[0], null, 2));
      } else {
        console.log('USER DOES NOT EXIST - invite not yet accepted');
      }

      // Check invite
      const invite = await queryRunner.query(`
        SELECT oi.id, oi.org_id, oi.role, oi.accepted, oi.expires_at,
               o.name as inviting_org
        FROM org_invites oi
        LEFT JOIN organizations o ON o.id = oi.org_id
        WHERE LOWER(oi.email) = LOWER($1)
      `, [email]);

      if (invite.length > 0) {
        console.log('INVITE:');
        console.log(JSON.stringify(invite[0], null, 2));
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {}
}
