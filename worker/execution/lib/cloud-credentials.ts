/**
 * Cloud Credentials Helper
 *
 * Provides utilities for workers to assume customer IAM roles for secure
 * cross-account deployments. Workers use these temporary credentials instead
 * of their own task role permissions for customer infrastructure access.
 *
 * Environment Variables:
 * - CUSTOMER_AWS_ROLE_ARN: The customer's IAM role ARN to assume
 * - CUSTOMER_AWS_EXTERNAL_ID: External ID for confused deputy protection
 * - CUSTOMER_AWS_REGION: AWS region for the customer's infrastructure
 */

import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";

export interface CustomerAwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: Date;
  region: string;
}

// Cache for assumed credentials (refreshed before expiration)
let cachedCredentials: CustomerAwsCredentials | null = null;
const CREDENTIAL_REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiration

/**
 * Check if customer AWS role is configured
 */
export function hasCustomerAwsConfig(): boolean {
  return !!process.env.CUSTOMER_AWS_ROLE_ARN;
}

/**
 * Get customer AWS configuration from environment
 */
export function getCustomerAwsConfig(): {
  roleArn: string;
  externalId: string;
  region: string;
} | null {
  const roleArn = process.env.CUSTOMER_AWS_ROLE_ARN;
  if (!roleArn) {
    return null;
  }

  return {
    roleArn,
    externalId: process.env.CUSTOMER_AWS_EXTERNAL_ID || "",
    region: process.env.CUSTOMER_AWS_REGION || "us-east-1",
  };
}

/**
 * Assume the customer's IAM role and return temporary credentials
 *
 * The worker's task role has permission to call sts:AssumeRole on customer roles
 * (roles matching workermill-customer-* pattern or in external accounts).
 * The customer's role trust policy requires the external ID for security.
 *
 * @returns Temporary AWS credentials for the customer's account
 */
export async function assumeCustomerRole(): Promise<CustomerAwsCredentials> {
  const config = getCustomerAwsConfig();
  if (!config) {
    throw new Error(
      "Customer AWS role not configured. Set CUSTOMER_AWS_ROLE_ARN environment variable."
    );
  }

  // Check if we have valid cached credentials
  if (cachedCredentials) {
    const now = Date.now();
    const expirationMs = cachedCredentials.expiration.getTime();
    if (expirationMs - now > CREDENTIAL_REFRESH_BUFFER_MS) {
      return cachedCredentials;
    }
  }

  console.log(`[cloud-credentials] Assuming customer role: ${config.roleArn}`);

  // Use the worker's task role credentials (from ECS) to assume the customer role
  const stsClient = new STSClient({ region: config.region });

  const taskId = process.env.TASK_ID || "unknown";
  const sessionName = `workermill-deploy-${taskId.substring(0, 20)}`;

  const command = new AssumeRoleCommand({
    RoleArn: config.roleArn,
    ExternalId: config.externalId || undefined,
    RoleSessionName: sessionName,
    DurationSeconds: 3600, // 1 hour - maximum for assumed roles
  });

  const response = await stsClient.send(command);

  if (!response.Credentials) {
    throw new Error("AssumeRole returned no credentials");
  }

  cachedCredentials = {
    accessKeyId: response.Credentials.AccessKeyId!,
    secretAccessKey: response.Credentials.SecretAccessKey!,
    sessionToken: response.Credentials.SessionToken!,
    expiration: response.Credentials.Expiration!,
    region: config.region,
  };

  console.log(
    `[cloud-credentials] Successfully assumed customer role, expires at: ${cachedCredentials.expiration.toISOString()}`
  );

  return cachedCredentials;
}

/**
 * Get AWS SDK credentials object for use with AWS clients
 */
export async function getCustomerAwsSdkCredentials(): Promise<{
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
  };
  region: string;
}> {
  const creds = await assumeCustomerRole();
  return {
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken,
    },
    region: creds.region,
  };
}

/**
 * Set environment variables for AWS CLI/SDK tools to use customer credentials
 * Call this before running shell commands that need AWS access
 */
export async function setCustomerAwsEnvVars(): Promise<void> {
  const creds = await assumeCustomerRole();

  process.env.AWS_ACCESS_KEY_ID = creds.accessKeyId;
  process.env.AWS_SECRET_ACCESS_KEY = creds.secretAccessKey;
  process.env.AWS_SESSION_TOKEN = creds.sessionToken;
  process.env.AWS_REGION = creds.region;
  process.env.AWS_DEFAULT_REGION = creds.region;

  console.log(
    "[cloud-credentials] AWS environment variables set for customer account"
  );
}

/**
 * Create an AWS client configured with customer credentials
 * Use this factory function for any AWS SDK v3 client
 *
 * @example
 * const s3 = await createCustomerAwsClient(S3Client);
 * const ecs = await createCustomerAwsClient(ECSClient);
 */
export async function createCustomerAwsClient<
  T extends new (config: {
    region: string;
    credentials: {
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken: string;
    };
  }) => InstanceType<T>
>(ClientClass: T): Promise<InstanceType<T>> {
  const { credentials, region } = await getCustomerAwsSdkCredentials();
  return new ClientClass({
    region,
    credentials,
  });
}

/**
 * Clear cached credentials (for testing or forced refresh)
 */
export function clearCredentialsCache(): void {
  cachedCredentials = null;
}
