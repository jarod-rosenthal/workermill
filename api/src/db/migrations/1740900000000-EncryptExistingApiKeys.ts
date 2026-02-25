import { MigrationInterface, QueryRunner } from "typeorm";
import { encrypt, isEncrypted, isEncryptionActive } from "../../utils/encryption.js";

/**
 * One-time migration to encrypt existing plaintext apiKey values in the
 * organizations table. The OrganizationEncryptionSubscriber now encrypts
 * on INSERT/UPDATE, but existing rows created before the subscriber was
 * added need to be encrypted retroactively.
 *
 * This migration is a no-op if ENCRYPTION_KEY is not configured (no-op mode).
 */
export class EncryptExistingApiKeys1740900000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!isEncryptionActive()) {
      console.log(
        "[Migration] Skipping API key encryption — ENCRYPTION_KEY not configured",
      );
      return;
    }

    // Check which column name exists — older schemas use snake_case "api_key",
    // the original migration used camelCase "apiKey".
    const colCheck = (await queryRunner.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'organizations' AND column_name IN ('apiKey', 'api_key')`,
    )) as { column_name: string }[];

    if (colCheck.length === 0) {
      console.log(
        "[Migration] Skipping API key encryption — no apiKey/api_key column found",
      );
      return;
    }

    const col = colCheck[0].column_name; // "apiKey" or "api_key"
    const quoted = col === "api_key" ? "api_key" : `"apiKey"`;

    // Fetch all orgs with non-null apiKey
    const rows = (await queryRunner.query(
      `SELECT id, ${quoted} AS "apiKey" FROM organizations WHERE ${quoted} IS NOT NULL AND ${quoted} != ''`,
    )) as { id: string; apiKey: string }[];

    let encrypted = 0;
    let skipped = 0;

    for (const row of rows) {
      if (isEncrypted(row.apiKey)) {
        skipped++;
        continue;
      }

      const encryptedValue = encrypt(row.apiKey);
      await queryRunner.query(
        `UPDATE organizations SET ${quoted} = $1 WHERE id = $2`,
        [encryptedValue, row.id],
      );
      encrypted++;
    }

    console.log(
      `[Migration] Encrypted ${encrypted} API keys, skipped ${skipped} (already encrypted)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Decrypting API keys is not safe to automate in a down migration.
    // If rollback is needed, use a manual script with the ENCRYPTION_KEY.
    console.log(
      "[Migration] Down: API key decryption must be done manually if needed",
    );
    void queryRunner;
  }
}
