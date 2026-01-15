import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOrgInvites1704067200021 implements MigrationInterface {
  name = "AddOrgInvites1704067200021";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "org_invites" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "email" varchar(255) NOT NULL,
        "role" varchar(50) NOT NULL DEFAULT 'member',
        "token" varchar(255) NOT NULL UNIQUE,
        "expires_at" timestamp NOT NULL,
        "accepted" boolean NOT NULL DEFAULT false,
        "invited_by" uuid,
        "created_at" timestamp NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_org_invites_org_id" ON "org_invites" ("org_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_org_invites_email" ON "org_invites" ("email")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_org_invites_token" ON "org_invites" ("token")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "org_invites"`);
  }
}
