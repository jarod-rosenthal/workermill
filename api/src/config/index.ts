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
    sesRegion: process.env.SES_REGION || "us-east-2", // SES approved in Ohio
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
      free: "", // Legacy - no Stripe price
      starter: process.env.STRIPE_PRICE_STARTER || "price_starter", // $29/mo - 5 hrs included
      team: process.env.STRIPE_PRICE_TEAM || "price_team", // $79/mo - 20 hrs included
      business: process.env.STRIPE_PRICE_BUSINESS || "price_business", // $199/mo - 60 hrs included
      pro: process.env.STRIPE_PRICE_PRO || "price_pro", // Legacy - maps to team
      enterprise: process.env.STRIPE_PRICE_ENTERPRISE || "price_enterprise", // Custom
    },
  },

  // Credit-Based Billing
  creditBilling: {
    feePercent: parseInt(process.env.WORKERMILL_FEE_PERCENT || "15", 10),
    minDepositCents: parseInt(process.env.MIN_DEPOSIT_CENTS || "1000", 10),
    signupBonusCents: parseInt(process.env.SIGNUP_BONUS_CENTS || "1000", 10),
    defaultRechargeThresholdCents: 1000, // $10
    defaultRechargeAmountCents: 5000, // $50
  },

  // AI Support Agent
  supportAgent: {
    enabled: process.env.SUPPORT_AGENT_ENABLED === "true",
    autoResponseCategories: (process.env.SUPPORT_AUTO_RESPONSE_CATEGORIES || "general,technical,feature_request,bug_report").split(","),
    escalationPriorities: (process.env.SUPPORT_ESCALATION_PRIORITIES || "urgent").split(","),
    escalationAgeHours: parseInt(process.env.SUPPORT_ESCALATION_AGE_HOURS || "24", 10),
    defaultModel: process.env.SUPPORT_AGENT_MODEL || "claude-haiku-4-5-20251001",
    maxConcurrentResponses: parseInt(process.env.SUPPORT_MAX_CONCURRENT || "5", 10),
    confidenceThreshold: parseInt(process.env.SUPPORT_CONFIDENCE_THRESHOLD || "70", 10),
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
 * SECURITY: Only returns org-specific credentials - NO platform fallback for multi-tenancy isolation.
 * Each organization must configure their own API keys in Settings > AI Providers.
 *
 * Credential location: workermill/${env}/orgs/${orgId}/providers/${providerId}
 *
 * @param orgId - Organization ID
 * @param providerId - Provider identifier (anthropic, openai, google, ollama)
 * @returns API key or host URL for the provider
 * @throws Error if credentials not configured for the organization
 */
export async function getProviderCredentials(
  orgId: string,
  providerId: ProviderId
): Promise<string> {
  const now = Date.now();

  // Check cache - org-specific only (no platform cache for multi-tenancy security)
  const orgCacheKey = `${orgId}:${providerId}`;
  const cachedOrg = providerCredentialsCache.get(orgCacheKey);
  if (cachedOrg && cachedOrg.expiresAt > now) {
    return cachedOrg.apiKey;
  }

  const client = getSecretsClient();
  const env = config.environment;

  // SECURITY: Only check org-specific secret - NO platform fallback for multi-tenancy isolation
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
    // Org-specific secret not found - do NOT fall back to platform secrets
  }

  // For ollama, check org-specific URL first, then return default local endpoint
  if (providerId === "ollama") {
    // Ollama doesn't require an API key, just a host URL
    // The org's ollamaBaseUrl setting is checked separately in orchestrator
    return process.env.OLLAMA_HOST || "http://localhost:11434";
  }

  // Credentials not configured for this org - fail with clear error message
  throw new Error(
    `Provider '${providerId}' not configured for your organization. ` +
      `Please configure your ${providerId} API key in Settings > AI Providers.`
  );
}

/**
 * Check if an organization has its OWN credentials for a provider
 * Used for provider configuration status display
 * NOTE: Only checks org-specific credentials, NOT platform fallbacks (for multi-tenancy security)
 */
export async function hasProviderCredentials(
  orgId: string,
  providerId: ProviderId
): Promise<boolean> {
  // Ollama doesn't require credentials
  if (providerId === "ollama") {
    return true;
  }

  const client = getSecretsClient();
  const env = config.environment;

  // Only check org-specific secret - no platform fallback for display purposes
  try {
    const orgSecretPath = `workermill/${env}/orgs/${orgId}/providers/${providerId}`;
    const orgSecret = await client.send(
      new GetSecretValueCommand({ SecretId: orgSecretPath })
    );
    return !!orgSecret.SecretString;
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

// =============================================================================
// Environment Variable Validation
// =============================================================================

/**
 * Validate critical environment variables at startup.
 * Fails fast in production if required vars are missing.
 */
export function validateEnvironment(): void {
  const isProduction = config.nodeEnv === "production";
  const missing: string[] = [];
  const warnings: string[] = [];

  // Critical for production - will fail startup
  const criticalVars = [
    { name: "DB_HOST", value: config.database.host, fallback: "localhost" },
    { name: "DB_PASSWORD", value: config.database.password, fallback: "" },
    { name: "COGNITO_USER_POOL_ID", value: config.cognito.userPoolId, fallback: "COGNITO_POOL_ID" },
    { name: "COGNITO_CLIENT_ID", value: config.cognito.clientId, fallback: "COGNITO_CLIENT_ID" },
  ];

  // Infrastructure vars - critical for worker spawning
  const infrastructureVars = [
    { name: "ECS_CLUSTER", value: config.aws.ecsCluster, fallback: "workermill-dev" },
    { name: "PRIVATE_SUBNETS", value: config.aws.privateSubnets.join(","), fallback: "" },
    { name: "SECURITY_GROUPS", value: config.aws.securityGroups.join(","), fallback: "" },
  ];

  // Check critical vars
  for (const v of criticalVars) {
    if (!v.value || v.value === v.fallback) {
      if (isProduction) {
        missing.push(v.name);
      } else {
        warnings.push(`${v.name} using default value`);
      }
    }
  }

  // Check infrastructure vars (needed for worker spawning)
  for (const v of infrastructureVars) {
    if (!v.value || v.value === v.fallback) {
      if (isProduction) {
        missing.push(v.name);
      } else {
        warnings.push(`${v.name} not configured - worker spawning may fail`);
      }
    }
  }

  // Log warnings in development
  if (warnings.length > 0 && !isProduction) {
    console.warn("[Config] Development environment warnings:");
    for (const w of warnings) {
      console.warn(`  - ${w}`);
    }
  }

  // Fail fast in production
  if (missing.length > 0 && isProduction) {
    console.error("[Config] FATAL: Missing required environment variables:");
    for (const m of missing) {
      console.error(`  - ${m}`);
    }
    process.exit(1);
  }
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
