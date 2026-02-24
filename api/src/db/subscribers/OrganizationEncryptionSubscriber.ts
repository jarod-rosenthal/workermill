/**
 * TypeORM Entity Subscriber that transparently encrypts/decrypts
 * sensitive token fields on the Organization entity.
 *
 * Encrypts before INSERT/UPDATE, decrypts after SELECT.
 * This ensures tokens are encrypted at rest in PostgreSQL.
 *
 * Fields encrypted:
 *   - sonarqubeToken, coderabbitApiKey, deepsourceToken
 *   - qualityWebhookSecret, siemWebhookSecret
 *   - jiraWebhookSecret, githubWebhookSecret, gitlabWebhookSecret, bitbucketWebhookSecret
 *   - slackWebhookUrl
 */

import {
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  UpdateEvent,
  LoadEvent,
} from "typeorm";
import { Organization } from "../../models/Organization.js";
import { encrypt, decrypt } from "../../utils/encryption.js";

/**
 * All Organization fields that contain sensitive tokens/secrets.
 * These are encrypted at rest in the database.
 */
const SENSITIVE_FIELDS: (keyof Organization)[] = [
  "apiKey",
  "sonarqubeToken",
  "coderabbitApiKey",
  "deepsourceToken",
  "qualityWebhookSecret",
  "siemWebhookSecret",
  "jiraWebhookSecret",
  "githubWebhookSecret",
  "gitlabWebhookSecret",
  "bitbucketWebhookSecret",
  "slackWebhookUrl",
];

/**
 * Encrypt all sensitive fields on the entity.
 * Skips null/undefined/empty values.
 * The encrypt() function handles double-encryption prevention internally.
 */
function encryptSensitiveFields(entity: Organization): void {
  for (const field of SENSITIVE_FIELDS) {
    const value = entity[field] as string | null | undefined;
    if (value && typeof value === "string") {
      (entity as unknown as Record<string, unknown>)[field] = encrypt(value);
    }
  }
}

/**
 * Decrypt all sensitive fields on the entity.
 * Skips null/undefined/empty values.
 * The decrypt() function handles plaintext gracefully (returns as-is).
 */
function decryptSensitiveFields(entity: Organization): void {
  for (const field of SENSITIVE_FIELDS) {
    const value = entity[field] as string | null | undefined;
    if (value && typeof value === "string") {
      (entity as unknown as Record<string, unknown>)[field] = decrypt(value);
    }
  }
}

@EventSubscriber()
export class OrganizationEncryptionSubscriber
  implements EntitySubscriberInterface<Organization>
{
  listenTo() {
    return Organization;
  }

  /**
   * Decrypt sensitive fields after loading from the database.
   */
  afterLoad(entity: Organization, _event?: LoadEvent<Organization>): void {
    decryptSensitiveFields(entity);
  }

  /**
   * Encrypt sensitive fields before inserting into the database.
   */
  beforeInsert(event: InsertEvent<Organization>): void {
    encryptSensitiveFields(event.entity);
  }

  /**
   * Encrypt sensitive fields before updating in the database.
   */
  beforeUpdate(event: UpdateEvent<Organization>): void {
    if (event.entity) {
      encryptSensitiveFields(event.entity as Organization);
    }
  }
}
