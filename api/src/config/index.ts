import { config as dotenvConfig } from "dotenv";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  S3Client,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import type { ProviderId } from "../providers/types.js";

dotenvConfig();

export const config = {
  // Server
  port: parseInt(process.env.PORT || "3000", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  environment: process.env.ENVIRONMENT || "dev", // For secrets path (workermill/dev/...)

  // S3 (worker state checkpoints)
  s3: {
    checkpointBucket: process.env.CHECKPOINT_BUCKET || `workermill-dev-worker-state-AWS_ACCOUNT_ID`,
  },

  // Database
  database: {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    name: process.env.DB_NAME || "workermill",
    username: process.env.DB_USERNAME || "workermill",
    password: process.env.DB_PASSWORD || "",
    url: process.env.DATABASE_URL,
  },

  // AWS
  aws: {
    region: process.env.AWS_REGION || "us-east-1",
    ecsCluster: process.env.ECS_CLUSTER || "workermill-dev",
    workerTaskDefinition: process.env.WORKER_TASK_DEFINITION || "workermill-dev-worker",
    privateSubnets: (process.env.PRIVATE_SUBNETS || "").split(",").filter(Boolean),
    securityGroups: (process.env.SECURITY_GROUPS || "").split(",").filter(Boolean),
    workerLogGroup: process.env.WORKER_LOG_GROUP || "/ecs/workermill-dev/worker",
    sqsJobsQueueUrl: process.env.SQS_JOBS_QUEUE_URL || "",
  },

  // Cognito
  cognito: {
    userPoolId: process.env.COGNITO_USER_POOL_ID || "COGNITO_POOL_ID",
    clientId: process.env.COGNITO_CLIENT_ID || "COGNITO_CLIENT_ID",
    region: process.env.AWS_REGION || "us-east-1",
    domain: process.env.COGNITO_DOMAIN || "workermill-dev-x0ru7n3p",
  },

  // Secrets
  secrets: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
    githubToken: process.env.GITHUB_TOKEN || "",
    jiraCredentials: process.env.JIRA_CREDENTIALS || "",
  },

  // API
  apiBaseUrl: process.env.API_BASE_URL || "https://workermill.com",
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:5173,https://workermill.com").split(","),

  // Stripe Billing
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
    prices: {
      free: "", // Free tier has no Stripe price
      starter: process.env.STRIPE_PRICE_STARTER || "price_starter",
      pro: process.env.STRIPE_PRICE_PRO || "price_pro",
      enterprise: process.env.STRIPE_PRICE_ENTERPRISE || "price_enterprise",
    },
  },
};

// Secrets Manager client (lazy initialized)
let secretsClient: SecretsManagerClient | null = null;

function getSecretsClient(): SecretsManagerClient {
  if (!secretsClient) {
    secretsClient = new SecretsManagerClient({ region: config.aws.region });
  }
  return secretsClient;
}

/**
 * Provider credentials cache
 * Key format: `${orgId}:${providerId}` or `platform:${providerId}` for defaults
 * TTL: 5 minutes
 */
interface CachedCredential {
  apiKey: string;
  expiresAt: number;
}

const providerCredentialsCache = new Map<string, CachedCredential>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Map provider ID to environment variable name
 */
export function getProviderEnvVar(providerId: ProviderId): string {
  const envVarMap: Record<ProviderId, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_API_KEY",
    ollama: "OLLAMA_HOST", // Ollama uses host URL instead of API key
    "ai-sdk": "AI_SDK_UNDERLYING_PROVIDER", // AI SDK uses underlying provider's credentials
  };
  return envVarMap[providerId];
}

/**
 * Get provider API credentials from AWS Secrets Manager
 *
 * Credential resolution order:
 * 1. Organization-specific secret: workermill/${env}/orgs/${orgId}/providers/${provider}
 * 2. Platform default secret: workermill/${env}/${provider}-api-key
 * 3. For anthropic only: Fall back to environment variable or config.secrets.anthropicApiKey
 *
 * @param orgId - Organization ID
 * @param providerId - Provider identifier (anthropic, openai, google, ollama)
 * @returns API key or host URL for the provider
 * @throws Error if credentials not found (except for anthropic which has platform fallback)
 */
export async function getProviderCredentials(
  orgId: string,
  providerId: ProviderId
): Promise<string> {
  const now = Date.now();

  // Check cache first - org-specific
  const orgCacheKey = `${orgId}:${providerId}`;
  const cachedOrg = providerCredentialsCache.get(orgCacheKey);
  if (cachedOrg && cachedOrg.expiresAt > now) {
    return cachedOrg.apiKey;
  }

  // Check cache - platform default
  const platformCacheKey = `platform:${providerId}`;
  const cachedPlatform = providerCredentialsCache.get(platformCacheKey);
  if (cachedPlatform && cachedPlatform.expiresAt > now) {
    return cachedPlatform.apiKey;
  }

  const client = getSecretsClient();
  const env = config.environment;

  // Try org-specific secret first
  try {
    const orgSecretPath = `workermill/${env}/orgs/${orgId}/providers/${providerId}`;
    const orgSecret = await client.send(
      new GetSecretValueCommand({ SecretId: orgSecretPath })
    );

    if (orgSecret.SecretString) {
      // Cache the result
      providerCredentialsCache.set(orgCacheKey, {
        apiKey: orgSecret.SecretString,
        expiresAt: now + CACHE_TTL_MS,
      });
      return orgSecret.SecretString;
    }
  } catch {
    // Org-specific secret not found, try platform default
  }

  // Try platform default secret
  try {
    const platformSecretPath = `workermill/${env}/${providerId}-api-key`;
    const platformSecret = await client.send(
      new GetSecretValueCommand({ SecretId: platformSecretPath })
    );

    if (platformSecret.SecretString) {
      // Cache the result
      providerCredentialsCache.set(platformCacheKey, {
        apiKey: platformSecret.SecretString,
        expiresAt: now + CACHE_TTL_MS,
      });
      return platformSecret.SecretString;
    }
  } catch {
    // Platform default not found
  }

  // Special handling for anthropic - fall back to environment variable
  if (providerId === "anthropic") {
    const envKey = config.secrets.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
    if (envKey) {
      // Cache the result
      providerCredentialsCache.set(platformCacheKey, {
        apiKey: envKey,
        expiresAt: now + CACHE_TTL_MS,
      });
      return envKey;
    }
  }

  // For ollama, return empty string (no auth required for local)
  if (providerId === "ollama") {
    return process.env.OLLAMA_HOST || "http://localhost:11434";
  }

  // Credentials not found for non-anthropic providers
  throw new Error(
    `No credentials found for provider '${providerId}'. ` +
      `Configure credentials at: workermill/${env}/orgs/${orgId}/providers/${providerId} ` +
      `or workermill/${env}/${providerId}-api-key in AWS Secrets Manager.`
  );
}

/**
 * Check if credentials exist for a provider (without fetching the actual value)
 * Used for provider configuration status display
 */
export async function hasProviderCredentials(
  orgId: string,
  providerId: ProviderId
): Promise<boolean> {
  // Ollama doesn't require credentials
  if (providerId === "ollama") {
    return true;
  }

  try {
    await getProviderCredentials(orgId, providerId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear cached credentials for an organization or provider
 * Call this when credentials are updated
 */
export function clearProviderCredentialsCache(
  orgId?: string,
  providerId?: ProviderId
): void {
  if (orgId && providerId) {
    providerCredentialsCache.delete(`${orgId}:${providerId}`);
  } else if (providerId) {
    // Clear all caches for this provider
    for (const key of providerCredentialsCache.keys()) {
      if (key.endsWith(`:${providerId}`)) {
        providerCredentialsCache.delete(key);
      }
    }
  } else if (orgId) {
    // Clear all caches for this org
    for (const key of providerCredentialsCache.keys()) {
      if (key.startsWith(`${orgId}:`)) {
        providerCredentialsCache.delete(key);
      }
    }
  } else {
    // Clear everything
    providerCredentialsCache.clear();
  }
}

// =============================================================================
// Worker State Checkpoint Functions
// =============================================================================

/**
 * Checkpoint state from S3
 */
export interface TaskCheckpoint {
  taskId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  stage: string;
  repoCloned: boolean;
  branch: string | null;
  commits: string[];
  filesAnalyzed: string[];
  filesModified: string[];
  testsRun: boolean;
  testsPassed: boolean | null;
  lastAction: string;
  pendingWork: string | null;
  resumeCount: number;
}

// S3 client (lazy initialized)
let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({ region: config.aws.region });
  }
  return s3Client;
}

/**
 * Get task checkpoint from S3
 *
 * Retrieves the checkpoint state file for a task from S3.
 * Used by the orchestrator to detect Spot interruptions via the "interrupted" stage.
 *
 * @param taskId - The worker task ID
 * @returns TaskCheckpoint object or null if not found
 */
export async function getTaskCheckpoint(taskId: string): Promise<TaskCheckpoint | null> {
  const client = getS3Client();
  const bucket = config.s3.checkpointBucket;
  const key = `${taskId}/checkpoint.json`;

  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );

    if (!response.Body) {
      return null;
    }

    // Convert stream to string
    const bodyContents = await response.Body.transformToString();
    const checkpoint = JSON.parse(bodyContents) as TaskCheckpoint;

    return checkpoint;
  } catch (error) {
    // NoSuchKey or other errors - checkpoint doesn't exist
    if (error instanceof Error && error.name === "NoSuchKey") {
      return null;
    }

    // Log other errors but don't throw - checkpoint retrieval is optional
    console.error(`Failed to retrieve checkpoint for task ${taskId}:`, error);
    return null;
  }
}
