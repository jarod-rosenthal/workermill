import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * NO-OP migration placeholder for token encryption at rest.
 *
 * Actual encryption of existing plaintext tokens will happen transparently:
 * - The OrganizationEncryptionSubscriber encrypts tokens on every save
 * - Existing plaintext tokens are handled gracefully by the decrypt function
 *   (if a value doesn't match the encrypted format, it's returned as-is)
 * - Over time, as orgs update their settings, tokens will be encrypted
 *
 * A one-time script can be used to encrypt all existing tokens when
 * ENCRYPTION_KEY is first configured. This avoids the migration needing
 * the encryption key at migration time.
 */
export class EncryptExistingTokens1740200000002 implements MigrationInterface {
  name = "EncryptExistingTokens1740200000002";

  public async up(_queryRunner: QueryRunner): Promise<void> {
    // NO-OP: Token encryption is handled by TypeORM subscribers.
    // Existing plaintext tokens remain readable and will be encrypted
    // on next save. See OrganizationEncryptionSubscriber.
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // NO-OP: Nothing to reverse.
  }
}
