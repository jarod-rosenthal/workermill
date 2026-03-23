/**
 * External ID Generator Service
 *
 * Generates and manages cryptographically secure external IDs for AWS cross-account role assumption.
 * External IDs prevent confused deputy attacks when customers grant WorkerMill access to their AWS accounts.
 *
 * Format: workermill-{orgId}-{random32hex}
 * Example: workermill-org_abc123-f47ac10b58cc4372a5670e02b2c3d479
 */

import { randomBytes } from "crypto";
import {
  getOrgSecretFromDb,
  saveOrgSecretToDb,
} from "../utils/org-secret-store.js";
import { logger } from "../utils/logger.js";

/**
 * Generate a new external ID for an organization
 */
export function generateExternalId(orgId: string): string {
  const randomPart = randomBytes(16).toString("hex"); // 32 hex chars
  return `workermill-${orgId}-${randomPart}`;
}

/**
 * AWS Role Configuration stored in Secrets Manager
 */
export interface AwsRoleConfig {
  roleArn: string;
  externalId: string;
  region: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Get or generate the external ID for an organization
 * If no external ID exists, generates a new one and stores it
 */
export async function getOrCreateExternalId(orgId: string): Promise<string> {
  const existingStr = await getOrgSecretFromDb(orgId, "aws-role-config");
  if (existingStr) {
    try {
      const existing = JSON.parse(existingStr) as AwsRoleConfig;
      if (existing.externalId) {
        return existing.externalId;
      }
    } catch (err) {
      console.error("[external-id] corrupted AWS role config, regenerating:", err instanceof Error ? err.message : err);
    }
  }

  // Generate new external ID
  const externalId = generateExternalId(orgId);
  const newConfig: Partial<AwsRoleConfig> = {
    externalId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await saveOrgSecretToDb(orgId, "aws-role-config", JSON.stringify(newConfig));

  logger.info("Generated new external ID for org", { orgId });
  return externalId;
}

/**
 * Get the AWS role configuration for an organization
 */
export async function getAwsRoleConfig(
  orgId: string,
): Promise<AwsRoleConfig | null> {
  const raw = await getOrgSecretFromDb(orgId, "aws-role-config");
  if (!raw) return null;

  try {
    return JSON.parse(raw) as AwsRoleConfig;
  } catch {
    logger.error("Failed to parse AWS role config", { orgId });
    return null;
  }
}

/**
 * Save the AWS role configuration for an organization
 */
export async function saveAwsRoleConfig(
  orgId: string,
  roleArn: string,
  region: string,
): Promise<AwsRoleConfig> {
  // Get existing external ID or create new one
  const externalId = await getOrCreateExternalId(orgId);

  const roleConfig: AwsRoleConfig = {
    roleArn,
    externalId,
    region,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Check if config already exists to preserve createdAt
  try {
    const existing = await getAwsRoleConfig(orgId);
    if (existing) {
      roleConfig.createdAt = existing.createdAt;
      roleConfig.externalId = existing.externalId; // Never change external ID once set
    }
  } catch {
    // Ignore errors, will use new timestamps
  }

  await saveOrgSecretToDb(
    orgId,
    "aws-role-config",
    JSON.stringify(roleConfig),
  );

  logger.info("Saved AWS role config for org", { orgId, roleArn, region });
  return roleConfig;
}

/**
 * Validate an AWS role ARN format
 * Format: arn:aws:iam::{account}:role/{role-name}
 */
export function isValidAwsRoleArn(arn: string): boolean {
  const roleArnPattern = /^arn:aws:iam::\d{12}:role\/[a-zA-Z0-9+=,.@\-_/]+$/;
  return roleArnPattern.test(arn);
}

/**
 * Extract AWS account ID from a role ARN
 */
export function extractAccountIdFromArn(arn: string): string | null {
  const match = arn.match(/^arn:aws:iam::(\d{12}):role\//);
  return match ? match[1] : null;
}
