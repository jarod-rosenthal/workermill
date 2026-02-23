import { MigrationInterface, QueryRunner } from "typeorm";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { encrypt } from "../../utils/encryption.js";

/**
 * One-time data migration: read all per-org secrets from AWS Secrets Manager
 * and insert them into the new org_credentials table (encrypted).
 *
 * Idempotent: uses ON CONFLICT DO NOTHING so it is safe to re-run.
 *
 * Keys to migrate per org:
 *   providers/anthropic, providers/openai, providers/google,
 *   github-token, github-reviewer-token, gitlab-token, bitbucket-token,
 *   jira-credentials, linear-credentials, teams-webhook, slack-webhook,
 *   oncallshift-credentials, aws-credentials, aws-role-config,
 *   gcp-credentials, azure-credentials
 */
export class MigrateSecretsManagerToDb1740500000001
  implements MigrationInterface
{
  name = "MigrateSecretsManagerToDb1740500000001";

  private readonly SECRET_KEYS = [
    "providers/anthropic",
    "providers/openai",
    "providers/google",
    "github-token",
    "github-reviewer-token",
    "gitlab-token",
    "bitbucket-token",
    "jira-credentials",
    "linear-credentials",
    "teams-webhook",
    "slack-webhook",
    "oncallshift-credentials",
    "aws-credentials",
    "aws-role-config",
    "gcp-credentials",
    "azure-credentials",
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const env = process.env.NODE_ENV === "production" ? "prod" : "dev";
    const region = process.env.AWS_REGION || "us-east-1";

    let smClient: SecretsManagerClient;
    try {
      smClient = new SecretsManagerClient({ region });
    } catch {
      console.log(
        "[MigrateSecretsManagerToDb] Cannot create SM client — skipping (local dev?)",
      );
      return;
    }

    // Get all org IDs
    const orgs = (await queryRunner.query(
      `SELECT id FROM organizations`,
    )) as { id: string }[];

    console.log(
      `[MigrateSecretsManagerToDb] Migrating secrets for ${orgs.length} orgs...`,
    );

    let totalMigrated = 0;
    let totalSkipped = 0;

    for (const org of orgs) {
      const basePath = `workermill/${env}/orgs/${org.id}`;
      let orgMigrated = 0;

      for (const key of this.SECRET_KEYS) {
        // Try both root path and integrations/ path
        const smPaths = [
          `${basePath}/${key}`,
          `${basePath}/integrations/${key}`,
        ];

        let value: string | null = null;
        for (const smPath of smPaths) {
          try {
            const result = await smClient.send(
              new GetSecretValueCommand({ SecretId: smPath }),
            );
            if (result.SecretString) {
              value = result.SecretString;
              break;
            }
          } catch {
            // Not found at this path
          }
        }

        if (!value) continue;

        // Encrypt and insert with ON CONFLICT DO NOTHING
        const encryptedValue = encrypt(value);
        await queryRunner.query(
          `INSERT INTO org_credentials (org_id, credential_key, encrypted_value)
           VALUES ($1, $2, $3)
           ON CONFLICT (org_id, credential_key) DO NOTHING`,
          [org.id, key, encryptedValue],
        );

        orgMigrated++;
      }

      if (orgMigrated > 0) {
        console.log(
          `[MigrateSecretsManagerToDb]   org ${org.id}: migrated ${orgMigrated} secrets`,
        );
        totalMigrated += orgMigrated;
      } else {
        totalSkipped++;
      }
    }

    // Migrate platform-wide secrets under the platform org
    const platformOrgs = (await queryRunner.query(
      `SELECT id FROM organizations WHERE is_platform_org = true LIMIT 1`,
    )) as { id: string }[];

    if (platformOrgs.length > 0) {
      const platformOrgId = platformOrgs[0].id;
      const platformKeys = ["manager-github-token"];

      for (const key of platformKeys) {
        try {
          const result = await smClient.send(
            new GetSecretValueCommand({
              SecretId: `workermill/${env}/${key}`,
            }),
          );
          if (result.SecretString) {
            const encryptedValue = encrypt(result.SecretString);
            await queryRunner.query(
              `INSERT INTO org_credentials (org_id, credential_key, encrypted_value)
               VALUES ($1, $2, $3)
               ON CONFLICT (org_id, credential_key) DO NOTHING`,
              [platformOrgId, key, encryptedValue],
            );
            totalMigrated++;
            console.log(
              `[MigrateSecretsManagerToDb]   platform secret "${key}" migrated under platform org ${platformOrgId}`,
            );
          }
        } catch {
          // Platform secret not found — OK
        }
      }
    }

    console.log(
      `[MigrateSecretsManagerToDb] Done. Migrated ${totalMigrated} secrets across ${orgs.length - totalSkipped} orgs (${totalSkipped} orgs had no SM secrets).`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Data migration — down just truncates the table (secrets still in SM)
    await queryRunner.query(`DELETE FROM org_credentials`);
  }
}
