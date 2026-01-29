import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAzureTenantIdToOrganization1705344000072 implements MigrationInterface {
  name = "AddAzureTenantIdToOrganization1705344000072";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add azure_tenant_id column to organizations table
    await queryRunner.query(`
      ALTER TABLE "organizations"
      ADD COLUMN IF NOT EXISTS "azure_tenant_id" varchar(36) UNIQUE
    `);

    // Create index for faster lookups by Azure tenant ID
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_organizations_azure_tenant_id"
      ON "organizations" ("azure_tenant_id")
      WHERE "azure_tenant_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_organizations_azure_tenant_id"`);
    await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "azure_tenant_id"`);
  }
}
