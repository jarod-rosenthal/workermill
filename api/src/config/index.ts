import { config as dotenvConfig } from "dotenv";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  S3Client,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import type { ProviderId } from "../providers/types.js";

// Load .env.local first (for local development), then .env as fallback
// Check both current dir and parent dir (API runs from api/ subdirectory)
const envLocalPaths = [
  join(process.cwd(), ".env.local"),           // api/.env.local
  join(process.cwd(), "..", ".env.local"),     // workermill/.env.local (project root)
];
for (const envPath of envLocalPaths) {
  if (existsSync(envPath)) {
    console.log(`[Config] Loading environment from: ${envPath}`);
    dotenvConfig({ path: envPath });
    break;
  }
}
// Also load .env for any vars not in .env.local
dotenvConfig();

/**
 * Sync OAuth token from Claude credentials file to process.env.
 *
 * Claude CLI stores OAuth tokens in ~/.claude/.credentials.json.
 * This function reads the current token and updates process.env so that:
 * 1. Docker containers receive the fresh token via environment variables
 * 2. The planning agent and other services use the correct token
 *
 * Call this at startup to ensure the token is fresh.
 */
export function syncOAuthTokenFromCredentials(): void {
  if (process.env.EXECUTION_MODE !== "local") {
    return; // Only relevant in local mode
  }

  const credsPaths = [
    join(homedir(), ".claude", ".credentials.json"),
    // WSL: Check Windows user profile
    "/mnt/c/Users/" + (process.env.USER || "user") + "/.claude/.credentials.json",
  ];

  for (const credsPath of credsPaths) {
    if (existsSync(credsPath)) {
      try {
        const creds = JSON.parse(readFileSync(credsPath, "utf-8"));
        const oauth = creds.claudeAiOauth;

        if (oauth?.accessToken) {
          const oldToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.slice(0, 20);
          const newToken = oauth.accessToken.slice(0, 20);

          if (oldToken !== newToken) {
            process.env.CLAUDE_CODE_OAUTH_TOKEN = oauth.accessToken;
            console.log(`[Config] Synced OAuth token from ${credsPath}`);
            console.log(`[Config] Token updated: ${oldToken}... → ${newToken}...`);
          } else {
            console.log(`[Config] OAuth token already in sync`);
          }
          return;
        }
      } catch (err) {
        console.warn(`[Config] Failed to read credentials from ${credsPath}:`, err);
      }
    }
  }

  console.warn("[Config] No OAuth credentials found - run 'claude auth login'");
}

// Sync OAuth token at module load time (before any services start)
syncOAuthTokenFromCredentials();

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
    // GitHub Actions runner (ephemeral ECS tasks)
    runnerTaskDefinition: process.env.RUNNER_TASK_DEFINITION || "workermill-dev-github-runner",
    runnerSecurityGroup: process.env.RUNNER_SECURITY_GROUP || "",
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
      pro: process.env.STRIPE_PRICE_PRO || "",
      max: process.env.STRIPE_PRICE_MAX || "",
      enterprise: process.env.STRIPE_PRICE_ENTERPRISE || "",
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

  // Encryption at rest for sensitive fields (Organization tokens, webhook secrets)
  // 32-byte hex string (64 characters). If not set, encryption is disabled (plaintext).
  encryptionKey: process.env.ENCRYPTION_KEY || "",

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
    openrouter: "OPENROUTER_API_KEY",
    groq: "GROQ_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    mistral: "MISTRAL_API_KEY",
    xai: "XAI_API_KEY",
    bedrock: "AWS_BEDROCK_CREDENTIALS", // Format: ACCESS_KEY_ID:SECRET_ACCESS_KEY
    azure: "AZURE_OPENAI_CREDENTIALS", // Format: ENDPOINT:API_KEY
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
  // LOCAL MODE: Use OAuth token for Anthropic, skip Secrets Manager
  if (process.env.EXECUTION_MODE === "local") {
    if (providerId === "anthropic" && process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      // Return a sentinel value - actual OAuth token is used by Claude CLI directly
      return "LOCAL_OAUTH_MODE";
    }
    // For other providers in local mode, allow continuing to check env vars
    const envKey = `${providerId.toUpperCase()}_API_KEY`;
    if (process.env[envKey]) {
      return process.env[envKey]!;
    }
  }

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
 * Logs warnings if required vars are missing or using defaults.
 *
 * NOTE: This is currently warning-only, not fatal, because ECS task definitions
 * may have the variables configured differently than local dev expects.
 */
export function validateEnvironment(): void {
  const isProduction = config.nodeEnv === "production";
  const warnings: string[] = [];

  // Check env vars directly (not config values which have fallbacks)
  const criticalVars = [
    { name: "DB_HOST", hasValue: !!process.env.DB_HOST },
    { name: "DB_PASSWORD", hasValue: !!process.env.DB_PASSWORD },
    { name: "COGNITO_USER_POOL_ID", hasValue: !!process.env.COGNITO_USER_POOL_ID },
    { name: "COGNITO_CLIENT_ID", hasValue: !!process.env.COGNITO_CLIENT_ID },
  ];

  // Infrastructure vars - critical for worker spawning
  const infrastructureVars = [
    { name: "ECS_CLUSTER", hasValue: !!process.env.ECS_CLUSTER },
    { name: "PRIVATE_SUBNETS", hasValue: !!process.env.PRIVATE_SUBNETS },
    { name: "SECURITY_GROUPS", hasValue: !!process.env.SECURITY_GROUPS },
  ];

  // Check critical vars
  for (const v of criticalVars) {
    if (!v.hasValue) {
      warnings.push(`${v.name} not set - using default value`);
    }
  }

  // Check infrastructure vars
  for (const v of infrastructureVars) {
    if (!v.hasValue) {
      warnings.push(`${v.name} not configured - worker spawning may fail`);
    }
  }

  // Log warnings (both dev and prod - informational only)
  if (warnings.length > 0) {
    const prefix = isProduction ? "[Config] WARNING" : "[Config] Development mode";
    console.warn(`${prefix}: Some environment variables not explicitly set:`);
    for (const w of warnings) {
      console.warn(`  - ${w}`);
    }
    // NOTE: Not failing - just informational. The app may still work if
    // environment is configured via other means (Secrets Manager, task definition, etc.)
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
