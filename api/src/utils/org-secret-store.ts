/**
 * Org Secret Store — DB-only credential access layer.
 *
 * Thin wrapper around the org_credentials table. Depends only on
 * connection.ts + OrgCredential model, so it can be imported from
 * both config/index.ts and helpers.ts without circular dependencies.
 */

import { AppDataSource } from "../db/connection.js";
import { OrgCredential } from "../models/OrgCredential.js";
import { logger } from "./logger.js";

/**
 * Get a secret from the org_credentials table.
 * The subscriber auto-decrypts on SELECT.
 *
 * @returns Decrypted plaintext value, or null if not found.
 */
export async function getOrgSecretFromDb(
  orgId: string,
  credentialKey: string,
): Promise<string | null> {
  try {
    const repo = AppDataSource.getRepository(OrgCredential);
    const row = await repo.findOne({
      where: { orgId, credentialKey },
    });
    return row?.encryptedValue ?? null;
  } catch (error) {
    logger.error("Failed to read org secret from DB", {
      orgId,
      credentialKey,
      error,
    });
    return null;
  }
}

/**
 * Save (upsert) a secret into the org_credentials table.
 * The subscriber auto-encrypts on INSERT/UPDATE.
 */
export async function saveOrgSecretToDb(
  orgId: string,
  credentialKey: string,
  value: string,
): Promise<void> {
  const repo = AppDataSource.getRepository(OrgCredential);

  const existing = await repo.findOne({
    where: { orgId, credentialKey },
  });

  if (existing) {
    existing.encryptedValue = value;
    await repo.save(existing);
  } else {
    const cred = repo.create({
      orgId,
      credentialKey,
      encryptedValue: value,
    });
    await repo.save(cred);
  }
}

/**
 * Delete a secret from the org_credentials table.
 */
export async function deleteOrgSecretFromDb(
  orgId: string,
  credentialKey: string,
): Promise<void> {
  const repo = AppDataSource.getRepository(OrgCredential);
  await repo.delete({ orgId, credentialKey });
}
