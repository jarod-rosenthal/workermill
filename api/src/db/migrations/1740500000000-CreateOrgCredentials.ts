import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateOrgCredentials1740500000000 implements MigrationInterface {
  name = "CreateOrgCredentials1740500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS org_credentials (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        credential_key VARCHAR(100) NOT NULL,
        encrypted_value TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT UQ_org_credentials_org_key UNIQUE(org_id, credential_key)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS IDX_org_credentials_org_id
      ON org_credentials(org_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS org_credentials`);
  }
}
