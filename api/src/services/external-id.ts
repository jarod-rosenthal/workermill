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
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
  CreateSecretCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

const secretsClient = new SecretsManagerClient({ region: config.aws.region });

/**
 * Generate a new external ID for an organization
 */
export function generateExternalId(orgId: string): string {
  const randomPart = randomBytes(16).toString("hex"); // 32 hex chars
  return `workermill-${orgId}-${randomPart}`;
}

/**
 * Get the secret path for an org's AWS role configuration
 */
function getAwsRoleSecretPath(orgId: string): string {
  const secretPrefix = `workermill/${config.environment}`;
  return `${secretPrefix}/orgs/${orgId}/aws-role-config`;
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
  const secretPath = getAwsRoleSecretPath(orgId);

  try {
    // Try to get existing config
    const response = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: secretPath })
    );

    if (response.SecretString) {
      const config = JSON.parse(response.SecretString) as AwsRoleConfig;
      if (config.externalId) {
        return config.externalId;
      }
    }
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) {
      logger.error("Error fetching AWS role config", { error, orgId });
      throw error;
    }
    // Secret doesn't exist, will create below
  }

  // Generate new external ID
  const externalId = generateExternalId(orgId);
  const newConfig: Partial<AwsRoleConfig> = {
    externalId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    await secretsClient.send(
      new CreateSecretCommand({
        Name: secretPath,
        SecretString: JSON.stringify(newConfig),
        Description: `AWS cross-account role configuration for org ${orgId}`,
      })
    );
  } catch (error) {
    // If it already exists (race condition), update it
    if ((error as { name?: string }).name === "ResourceExistsException") {
      await secretsClient.send(
        new PutSecretValueCommand({
          SecretId: secretPath,
          SecretString: JSON.stringify(newConfig),
        })
      );
    } else {
      throw error;
    }
  }

  logger.info("Generated new external ID for org", { orgId });
  return externalId;
}

/**
 * Get the AWS role configuration for an organization
 */
export async function getAwsRoleConfig(orgId: string): Promise<AwsRoleConfig | null> {
  const secretPath = getAwsRoleSecretPath(orgId);

  try {
    const response = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: secretPath })
    );

    if (response.SecretString) {
      return JSON.parse(response.SecretString) as AwsRoleConfig;
    }
    return null;
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      return null;
    }
    logger.error("Error fetching AWS role config", { error, orgId });
    throw error;
  }
}

/**
 * Save the AWS role configuration for an organization
 */
export async function saveAwsRoleConfig(
  orgId: string,
  roleArn: string,
  region: string
): Promise<AwsRoleConfig> {
  const secretPath = getAwsRoleSecretPath(orgId);

  // Get existing external ID or create new one
  const externalId = await getOrCreateExternalId(orgId);

  const config: AwsRoleConfig = {
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
      config.createdAt = existing.createdAt;
      config.externalId = existing.externalId; // Never change external ID once set
    }
  } catch {
    // Ignore errors, will use new timestamps
  }

  try {
    await secretsClient.send(
      new PutSecretValueCommand({
        SecretId: secretPath,
        SecretString: JSON.stringify(config),
      })
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      await secretsClient.send(
        new CreateSecretCommand({
          Name: secretPath,
          SecretString: JSON.stringify(config),
          Description: `AWS cross-account role configuration for org ${orgId}`,
        })
      );
    } else {
      throw error;
    }
  }

  logger.info("Saved AWS role config for org", { orgId, roleArn, region });
  return config;
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
