import {
  ECSClient,
  RunTaskCommand,
  DescribeTasksCommand,
  StopTaskCommand,
} from "@aws-sdk/client-ecs";
import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { config, getProviderEnvVar } from "../config/index.js";
import { WorkerTask } from "../models/index.js";
import { logger } from "../utils/logger.js";
import type { ProviderId } from "../providers/types.js";

interface TaskCredentials {
  anthropicApiKey: string;
  githubToken: string;
  githubReviewerToken?: string; // Separate token for PR reviews (avoids self-approval)
  orgApiKey?: string;
  jiraBaseUrl?: string;
  jiraEmail?: string;
  jiraApiToken?: string;
  // Multi-provider support
  providerApiKey?: string; // Provider-specific API key (OpenAI, Google, etc.)
  providerId?: ProviderId; // Which provider to use
  ollamaBaseUrl?: string; // Self-hosted Ollama endpoint URL
  ollamaContextWindow?: number; // Context window size for Ollama models
  vllmBaseUrl?: string; // vLLM/OpenAI-compatible endpoint URL (GPU inference)
  // Ralph execution settings
  useRalph?: boolean;
  ralphMaxStories?: number;
  // Manager settings
  managerProvider?: string;
  managerModelId?: string;
  openaiApiKey?: string;
  googleApiKey?: string;
  // Customer AWS cross-account deployment credentials
  // Workers assume this role for deployments instead of using platform credentials
  customerAwsRoleArn?: string;
  customerAwsExternalId?: string;
  customerAwsRegion?: string;
  // Multi-SCM provider support
  scmProvider?: "github" | "gitlab" | "bitbucket";
  scmBaseUrl?: string; // For self-hosted instances (e.g., gitlab.company.com)
  scmToken?: string; // The SCM access token (GitHub/GitLab/BitBucket)
  bitbucketUsername?: string; // BitBucket requires username:app_password format
}

interface RunTaskResult {
  taskArn: string;
  taskId: string;
}

interface TaskStatus {
  taskArn: string;
  taskId: string;
  status:
    | "PROVISIONING"
    | "PENDING"
    | "RUNNING"
    | "DEPROVISIONING"
    | "STOPPED"
    | "UNKNOWN";
  exitCode?: number;
  reason?: string;
  startedAt?: Date;
  stoppedAt?: Date;
}

interface LogEvent {
  timestamp: number;
  message: string;
}

interface RunTaskOptions {
  /** Additional environment variables to pass to the container */
  additionalEnv?: Record<string, string>;
}

export class ECSTaskRunner {
  private ecs: ECSClient;
  private logs: CloudWatchLogsClient;

  constructor() {
    this.ecs = new ECSClient({ region: config.aws.region });
    this.logs = new CloudWatchLogsClient({ region: config.aws.region });
  }

  /**
   * Spawn an ECS task for a worker
   * @param task - The worker task to run
   * @param credentials - Credentials for API access
   * @param options - Optional configuration including additional environment variables
   */
  async runWorkerTask(
    task: WorkerTask,
    credentials: TaskCredentials,
    options?: RunTaskOptions,
  ): Promise<RunTaskResult> {
    // Determine the provider to use (default to anthropic for backward compatibility)
    const providerId: ProviderId =
      (task.workerProvider as ProviderId) || "anthropic";

    // Map model to CLI name based on provider
    // - Anthropic: Use short names (opus/haiku/sonnet) for Claude CLI
    // - Other providers: Use the actual model name
    const getModelForProvider = (
      model: string,
      provider: ProviderId,
    ): string => {
      if (provider === "anthropic") {
        // Claude CLI uses short names
        if (model.includes("opus")) return "opus";
        if (model.includes("haiku")) return "haiku";
        return "sonnet";
      }
      // For Ollama, OpenAI, Google - use the actual model name
      return model;
    };

    const modelName = getModelForProvider(task.workerModel, providerId);

    // Build base environment variables
    const environment = [
      { name: "TASK_ID", value: task.id },
      { name: "ORG_ID", value: task.orgId },
      { name: "JIRA_ISSUE_KEY", value: task.jiraIssueKey || "" },
      { name: "JIRA_SUMMARY", value: task.summary },
      { name: "JIRA_DESCRIPTION", value: task.description || "" },
      { name: "GITHUB_REPO", value: task.githubRepo },
      { name: "WORKER_PERSONA", value: task.workerPersona },
      { name: "CLAUDE_MODEL", value: modelName },
      // Also pass the full model name for non-Claude providers
      { name: "WORKER_MODEL", value: task.workerModel },
      { name: "GITHUB_TOKEN", value: credentials.githubToken },
      // Separate token for PR reviews (avoids GitHub self-approval restriction)
      { name: "GITHUB_REVIEWER_TOKEN", value: credentials.githubReviewerToken || "" },
      // Multi-SCM provider support
      { name: "SCM_PROVIDER", value: credentials.scmProvider || "github" },
      { name: "SCM_BASE_URL", value: credentials.scmBaseUrl || "" },
      { name: "SCM_TOKEN", value: credentials.scmToken || credentials.githubToken },
      { name: "BITBUCKET_USERNAME", value: credentials.bitbucketUsername || "" },
      { name: "API_BASE_URL", value: config.apiBaseUrl },
      { name: "RETRY_NUMBER", value: String(task.retryCount) },
      // Jira credentials for ticket updates
      { name: "JIRA_BASE_URL", value: credentials.jiraBaseUrl || "" },
      { name: "JIRA_EMAIL", value: credentials.jiraEmail || "" },
      { name: "JIRA_API_TOKEN", value: credentials.jiraApiToken || "" },
      { name: "TICKET_KEY", value: task.jiraIssueKey || "" },
      // Workflow control flags
      // PRD child tasks auto-deploy (no human PR review for individual stories)
      {
        name: "DEPLOYMENT_ENABLED",
        value: task.deploymentEnabled || task.parentTaskId ? "true" : "false",
      },
      // PRD child task flag: merge to feature branch without deploying
      // Child stories output ::result::deployed to unblock dependents, but skip actual deployment
      {
        name: "PRD_CHILD_TASK",
        value: task.parentTaskId ? "true" : "false",
      },
      {
        name: "REVIEW_ENABLED",
        value: task.skipManagerReview === false ? "true" : "false",
      },
      {
        name: "IMPROVEMENT_ENABLED",
        value: task.improvementEnabled ? "true" : "false",
      },
      // Standard SDK mode: Use Agent SDK-based executor for single tasks
      // Provides Epic-level functionality (inline review/deploy/improve) without multi-story coordination
      {
        name: "STANDARD_SDK_MODE",
        value: task.standardSdkMode ? "true" : "false",
      },
      { name: "TASK_NOTES", value: task.taskNotes || "" },
      // Deployment infrastructure (for Kaniko builds)
      // Note: AWS_REGION and ECS_CLUSTER are for WorkerMill's own infrastructure (spawning workers)
      { name: "AWS_REGION", value: config.aws.region },
      { name: "ECS_CLUSTER", value: config.aws.ecsCluster },
      // Target repository deployment config is read from .workermill/deploy.json after clone
      // No hardcoded deployment targets - workers are generic and config-driven
      // Multi-provider support
      { name: "WORKER_PROVIDER", value: providerId },
      // Manager provider and model for Epic/PRD workflows (separate from worker model)
      { name: "MANAGER_PROVIDER", value: credentials.managerProvider || "anthropic" },
      { name: "MANAGER_MODEL", value: credentials.managerModelId || "" },
      // PRD Orchestration - Parent task ID for multi-story coordination
      { name: "PARENT_TASK_ID", value: task.parentTaskId || "" },
      // PRD Orchestration - Parent Jira key ONLY for synthetic keys (e.g., OCS-123-S1)
      // Real Jira stories (OCS-410) should update their own tickets, not the parent
      // Only pass parent key if current key looks synthetic (contains "-S" followed by digits)
      {
        name: "PARENT_JIRA_KEY",
        value:
          task.jiraIssueKey && /-S\d+$/.test(task.jiraIssueKey)
            ? ((task.jiraFields as Record<string, unknown>)
                ?.parentJiraKey as string) || ""
            : "",
      },
      // PRD Orchestration - Target branch for feature branch workflow
      // Child tasks PR to this branch instead of main
      {
        name: "TARGET_BRANCH",
        value:
          ((task.jiraFields as Record<string, unknown>)
            ?.targetBranch as string) || "",
      },
      // PRD Orchestration - Story-specific branch (Phase 1 simplification)
      // Each worker gets its own branch within feature workflow
      {
        name: "STORY_BRANCH",
        value:
          ((task.jiraFields as Record<string, unknown>)
            ?.storyBranch as string) || "",
      },
      // Execution mode for supervised/autonomous
      {
        name: "EXECUTION_MODE",
        value:
          ((task.jiraFields as Record<string, unknown>)
            ?.executionMode as string) || "autonomous",
      },
      // File targeting from planning agent (Cost-first optimization)
      {
        name: "TARGET_FILES",
        value: JSON.stringify(
          ((task.jiraFields as Record<string, unknown>)
            ?.targetFiles as string[]) || [],
        ),
      },
      {
        name: "REFERENCE_FILES",
        value: JSON.stringify(
          ((task.jiraFields as Record<string, unknown>)
            ?.referenceFiles as string[]) || [],
        ),
      },
      // V2 Pipeline support
      {
        name: "PIPELINE_VERSION",
        value:
          ((task.jiraFields as Record<string, unknown>)
            ?.pipelineVersion as string) || task.pipelineVersion || "",
      },
      // V2 step input (serialized JSON) - contains step details, context sidecar, git setup command
      {
        name: "V2_STEP_INPUT",
        value:
          (task.jiraFields as Record<string, unknown>)?.v2StepInput
            ? JSON.stringify((task.jiraFields as Record<string, unknown>).v2StepInput)
            : "",
      },
    ].filter((env) => env.value !== "");

    // Add provider-specific API key environment variable
    // For anthropic, always use ANTHROPIC_API_KEY (required by Claude CLI)
    // For other providers, use both their specific env var AND ANTHROPIC_API_KEY as fallback
    // For ai-sdk, pass credentials for the underlying provider (set via additionalEnv)
    if (providerId === "anthropic") {
      environment.push({
        name: "ANTHROPIC_API_KEY",
        value: credentials.anthropicApiKey,
      });
    } else if (providerId === "ai-sdk") {
      // AI SDK multi-expert mode: pass all available API keys
      // The underlying provider is specified via AI_SDK_UNDERLYING_PROVIDER env var (from additionalEnv)
      if (credentials.anthropicApiKey) {
        environment.push({
          name: "ANTHROPIC_API_KEY",
          value: credentials.anthropicApiKey,
        });
      }
      if (credentials.providerApiKey && credentials.providerId) {
        const providerEnvVar = getProviderEnvVar(credentials.providerId);
        environment.push({ name: providerEnvVar, value: credentials.providerApiKey });
      }
      if (credentials.ollamaBaseUrl) {
        environment.push({
          name: "OLLAMA_HOST",
          value: credentials.ollamaBaseUrl,
        });
      }
      if (credentials.ollamaContextWindow) {
        environment.push({
          name: "OLLAMA_CONTEXT_WINDOW",
          value: String(credentials.ollamaContextWindow),
        });
      }
    } else if (providerId === "ollama") {
      // For Ollama, pass the base URL (no API key needed)
      if (credentials.ollamaBaseUrl) {
        environment.push({
          name: "OLLAMA_HOST",
          value: credentials.ollamaBaseUrl,
        });
      }
      // Pass context window size
      if (credentials.ollamaContextWindow) {
        environment.push({
          name: "OLLAMA_CONTEXT_WINDOW",
          value: String(credentials.ollamaContextWindow),
        });
      }
      // Also pass Anthropic key for fallback scenarios
      if (credentials.anthropicApiKey) {
        environment.push({
          name: "ANTHROPIC_API_KEY",
          value: credentials.anthropicApiKey,
        });
      }
    } else {
      // Pass the provider-specific API key
      const providerEnvVar = getProviderEnvVar(providerId);
      const providerApiKey = credentials.providerApiKey || "";
      if (providerApiKey) {
        environment.push({ name: providerEnvVar, value: providerApiKey });
      }
      // Also pass Anthropic key for fallback scenarios (e.g., Claude CLI still used)
      if (credentials.anthropicApiKey) {
        environment.push({
          name: "ANTHROPIC_API_KEY",
          value: credentials.anthropicApiKey,
        });
      }
    }

    if (credentials.orgApiKey) {
      environment.push({ name: "ORG_API_KEY", value: credentials.orgApiKey });
    }

    // Ralph execution settings
    if (credentials.useRalph !== undefined) {
      environment.push({
        name: "USE_RALPH",
        value: credentials.useRalph ? "true" : "false",
      });
    }
    if (credentials.ralphMaxStories !== undefined) {
      environment.push({
        name: "RALPH_MAX_STORIES",
        value: String(credentials.ralphMaxStories),
      });
    }

    // vLLM/GPU inference endpoint (OpenAI-compatible API)
    if (credentials.vllmBaseUrl) {
      environment.push({
        name: "VLLM_BASE_URL",
        value: credentials.vllmBaseUrl,
      });
    }

    // Manager provider API keys for Epic inline reviewer
    // Epic mode runs inline Tech Lead review inside the worker container
    // which needs access to the manager's AI provider API key
    if (credentials.googleApiKey) {
      environment.push({
        name: "GOOGLE_API_KEY",
        value: credentials.googleApiKey,
      });
      environment.push({
        name: "GOOGLE_GENERATIVE_AI_API_KEY",
        value: credentials.googleApiKey,
      });
    }
    if (credentials.openaiApiKey) {
      environment.push({
        name: "OPENAI_API_KEY",
        value: credentials.openaiApiKey,
      });
    }

    // Customer AWS cross-account role credentials
    // Workers use these to assume the customer's IAM role for deployments
    if (credentials.customerAwsRoleArn) {
      environment.push({
        name: "CUSTOMER_AWS_ROLE_ARN",
        value: credentials.customerAwsRoleArn,
      });
      if (credentials.customerAwsExternalId) {
        environment.push({
          name: "CUSTOMER_AWS_EXTERNAL_ID",
          value: credentials.customerAwsExternalId,
        });
      }
      if (credentials.customerAwsRegion) {
        environment.push({
          name: "CUSTOMER_AWS_REGION",
          value: credentials.customerAwsRegion,
        });
      }
    }

    // Add any additional environment variables from options (e.g., multi-persona mode)
    if (options?.additionalEnv) {
      for (const [name, value] of Object.entries(options.additionalEnv)) {
        if (value) {
          environment.push({ name, value });
        }
      }
    }

    const command = new RunTaskCommand({
      cluster: config.aws.ecsCluster,
      taskDefinition: config.aws.workerTaskDefinition,
      capacityProviderStrategy: [
        { capacityProvider: "FARGATE_SPOT", weight: 2, base: 0 },
        { capacityProvider: "FARGATE", weight: 1, base: 0 },
      ],
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: config.aws.privateSubnets,
          securityGroups: config.aws.securityGroups,
          assignPublicIp: "ENABLED",
        },
      },
      overrides: {
        containerOverrides: [
          {
            name: "worker",
            environment,
          },
        ],
      },
      tags: [
        { key: "TaskId", value: task.id },
        { key: "JiraIssueKey", value: task.jiraIssueKey || "internal" },
        { key: "WorkerPersona", value: task.workerPersona },
      ],
    });

    const response = await this.ecs.send(command);

    if (!response.tasks || response.tasks.length === 0) {
      const failures = response.failures
        ?.map((f) => `${f.arn}: ${f.reason}`)
        .join(", ");
      throw new Error(
        `Failed to start ECS task: ${failures || "Unknown error"}`,
      );
    }

    const ecsTask = response.tasks[0];
    const taskArn = ecsTask.taskArn!;
    const taskId = taskArn.split("/").pop()!;

    logger.info("Started ECS worker task", {
      taskId,
      taskArn,
      workerTaskId: task.id,
      jiraIssueKey: task.jiraIssueKey,
    });

    return { taskArn, taskId };
  }

  /**
   * Get current status of an ECS task
   */
  async getTaskStatus(taskArn: string): Promise<TaskStatus> {
    const command = new DescribeTasksCommand({
      cluster: config.aws.ecsCluster,
      tasks: [taskArn],
    });

    const response = await this.ecs.send(command);

    if (!response.tasks || response.tasks.length === 0) {
      return {
        taskArn,
        taskId: taskArn.split("/").pop()!,
        status: "UNKNOWN",
        reason: "Task not found",
      };
    }

    const task = response.tasks[0];
    const container = task.containers?.[0];

    return {
      taskArn,
      taskId: taskArn.split("/").pop()!,
      status: (task.lastStatus || "UNKNOWN") as TaskStatus["status"],
      exitCode: container?.exitCode,
      reason: task.stoppedReason || container?.reason,
      startedAt: task.startedAt,
      stoppedAt: task.stoppedAt,
    };
  }

  /**
   * Stop a running ECS task
   */
  async stopTask(taskArn: string, reason?: string): Promise<void> {
    const command = new StopTaskCommand({
      cluster: config.aws.ecsCluster,
      task: taskArn,
      reason: reason || "Stopped by WorkerMill API",
    });

    await this.ecs.send(command);
    logger.info("Stopped ECS task", { taskArn, reason });
  }

  /**
   * Get logs from a task
   */
  async getTaskLogs(
    taskId: string,
    options?: { startTime?: number; limit?: number; nextToken?: string },
  ): Promise<{ events: LogEvent[]; nextToken?: string }> {
    // AWS awslogs driver creates streams as: {prefix}/{container-name}/{task-id}
    const logStreamName = `worker/worker/${taskId}`;

    try {
      const command = new GetLogEventsCommand({
        logGroupName: config.aws.workerLogGroup,
        logStreamName,
        startTime: options?.startTime,
        limit: options?.limit || 100,
        nextToken: options?.nextToken,
        startFromHead: !options?.nextToken,
      });

      const response = await this.logs.send(command);

      return {
        events: (response.events || []).map((event) => ({
          timestamp: event.timestamp || 0,
          message: event.message || "",
        })),
        nextToken: response.nextForwardToken,
      };
    } catch (error: unknown) {
      if ((error as { name?: string }).name === "ResourceNotFoundException") {
        return { events: [] };
      }
      throw error;
    }
  }

  /**
   * Calculate estimated cost for a task
   */
  calculateTaskCost(durationSeconds: number): number {
    // Fargate Spot pricing (us-east-1):
    // 2 vCPU + 4GB: ~$0.05/hour regular, ~$0.015/hour Spot
    const hourlyRate = 0.015;
    return (durationSeconds / 3600) * hourlyRate;
  }

  /**
   * Spawn a warm container that waits for task assignment
   * Warm containers start with minimal env vars and poll the API for task details
   */
  async runWarmContainer(orgId: string): Promise<RunTaskResult> {
    // Verify platform API key is configured
    const platformApiKey =
      process.env.WARM_POOL_API_KEY || process.env.PLATFORM_API_KEY;
    if (!platformApiKey) {
      throw new Error(
        "WARM_POOL_API_KEY or PLATFORM_API_KEY must be configured for warm container pool",
      );
    }

    // Minimal environment for warm pool mode
    // The actual task env vars are fetched via API when assigned
    const environment = [
      { name: "WARM_POOL_MODE", value: "true" },
      { name: "API_BASE_URL", value: config.apiBaseUrl },
      { name: "PLATFORM_API_KEY", value: platformApiKey },
      { name: "ORG_ID", value: orgId },
      // ECS_TASK_ID and ECS_TASK_ARN are set from container metadata below
    ];

    const command = new RunTaskCommand({
      cluster: config.aws.ecsCluster,
      taskDefinition: config.aws.workerTaskDefinition,
      capacityProviderStrategy: [
        { capacityProvider: "FARGATE_SPOT", weight: 2, base: 0 },
        { capacityProvider: "FARGATE", weight: 1, base: 0 },
      ],
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: config.aws.privateSubnets,
          securityGroups: config.aws.securityGroups,
          assignPublicIp: "ENABLED",
        },
      },
      overrides: {
        containerOverrides: [
          {
            name: "worker",
            environment,
            // Override command to inject ECS task metadata before starting
            // The warm-wait.sh script needs ECS_TASK_ID to identify itself
            command: [
              "/bin/bash",
              "-c",
              // Fetch ECS task metadata and export, then run start.sh
              "export ECS_TASK_ARN=$(curl -s $ECS_CONTAINER_METADATA_URI_V4/task | jq -r '.TaskARN // empty'); " +
              "export ECS_TASK_ID=$(echo $ECS_TASK_ARN | rev | cut -d'/' -f1 | rev); " +
              "exec /app/start.sh",
            ],
          },
        ],
      },
      tags: [
        { key: "WarmPool", value: "true" },
        { key: "OrgId", value: orgId },
      ],
    });

    const response = await this.ecs.send(command);

    if (!response.tasks || response.tasks.length === 0) {
      const failures = response.failures
        ?.map((f) => `${f.arn}: ${f.reason}`)
        .join(", ");
      throw new Error(
        `Failed to start warm container: ${failures || "Unknown error"}`,
      );
    }

    const ecsTask = response.tasks[0];
    const taskArn = ecsTask.taskArn!;
    const taskId = taskArn.split("/").pop()!;

    logger.info("Started warm container", {
      taskId,
      taskArn,
      orgId,
    });

    return { taskArn, taskId };
  }

  /**
   * Spawn an ECS task for the Virtual Manager (PR review, log analysis)
   */
  async runManagerTask(
    task: WorkerTask,
    credentials: TaskCredentials,
    action: "review_pr" | "analyze_logs",
  ): Promise<RunTaskResult> {
    // Use org's manager settings or default to OpenAI GPT-5.1-codex
    const managerProvider = credentials.managerProvider || "openai";
    const managerModel = credentials.managerModelId || "gpt-5.1-codex";

    const environment = [
      { name: "TASK_ID", value: task.id },
      { name: "ORG_ID", value: task.orgId },
      { name: "MANAGER_ACTION", value: action },
      { name: "JIRA_ISSUE_KEY", value: task.jiraIssueKey || "" },
      { name: "JIRA_SUMMARY", value: task.summary },
      { name: "JIRA_DESCRIPTION", value: task.description || "" },
      { name: "GITHUB_REPO", value: task.githubRepo },
      { name: "PR_URL", value: task.githubPrUrl || "" },
      { name: "PR_NUMBER", value: String(task.githubPrNumber || "") },
      { name: "REVIEW_FEEDBACK", value: task.reviewFeedback || "" },
      // Manager provider and model
      { name: "MANAGER_PROVIDER", value: managerProvider },
      { name: "MANAGER_MODEL", value: managerModel },
      // Legacy Claude model (for backwards compatibility)
      {
        name: "CLAUDE_MODEL",
        value: managerProvider === "anthropic" ? managerModel : "haiku",
      },
      { name: "ANTHROPIC_API_KEY", value: credentials.anthropicApiKey },
      { name: "GITHUB_TOKEN", value: credentials.githubToken },
      { name: "GITHUB_REVIEWER_TOKEN", value: credentials.githubReviewerToken || "" },
      { name: "API_BASE_URL", value: config.apiBaseUrl },
      // Jira credentials for ticket updates
      { name: "JIRA_BASE_URL", value: credentials.jiraBaseUrl || "" },
      { name: "JIRA_EMAIL", value: credentials.jiraEmail || "" },
      { name: "JIRA_API_TOKEN", value: credentials.jiraApiToken || "" },
    ].filter((env) => env.value !== "");

    if (credentials.orgApiKey) {
      environment.push({ name: "ORG_API_KEY", value: credentials.orgApiKey });
    }

    // Add provider-specific API keys
    if (credentials.openaiApiKey) {
      environment.push({
        name: "OPENAI_API_KEY",
        value: credentials.openaiApiKey,
      });
    }
    if (credentials.googleApiKey) {
      environment.push({
        name: "GOOGLE_API_KEY",
        value: credentials.googleApiKey,
      });
    }
    // Ollama support for manager
    if (managerProvider === "ollama" && credentials.ollamaBaseUrl) {
      environment.push({
        name: "OLLAMA_HOST",
        value: credentials.ollamaBaseUrl,
      });
    }
    if (credentials.ollamaContextWindow) {
      environment.push({
        name: "OLLAMA_CONTEXT_WINDOW",
        value: String(credentials.ollamaContextWindow),
      });
    }

    const command = new RunTaskCommand({
      cluster: config.aws.ecsCluster,
      taskDefinition: config.aws.workerTaskDefinition,
      capacityProviderStrategy: [
        { capacityProvider: "FARGATE_SPOT", weight: 2, base: 0 },
        { capacityProvider: "FARGATE", weight: 1, base: 0 },
      ],
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: config.aws.privateSubnets,
          securityGroups: config.aws.securityGroups,
          assignPublicIp: "ENABLED",
        },
      },
      overrides: {
        containerOverrides: [
          {
            name: "worker",
            environment,
            // Override command to run manager entrypoint
            command: ["/bin/bash", "/app/manager-entrypoint.sh"],
          },
        ],
      },
      tags: [
        { key: "TaskId", value: task.id },
        { key: "JiraIssueKey", value: task.jiraIssueKey || "internal" },
        { key: "ManagerAction", value: action },
        { key: "Component", value: "virtual-manager" },
      ],
    });

    const response = await this.ecs.send(command);

    if (!response.tasks || response.tasks.length === 0) {
      const failures = response.failures
        ?.map((f) => `${f.arn}: ${f.reason}`)
        .join(", ");
      throw new Error(
        `Failed to start Manager ECS task: ${failures || "Unknown error"}`,
      );
    }

    const ecsTask = response.tasks[0];
    const taskArn = ecsTask.taskArn!;
    const taskId = taskArn.split("/").pop()!;

    logger.info("Started ECS Manager task", {
      taskId,
      taskArn,
      workerTaskId: task.id,
      jiraIssueKey: task.jiraIssueKey,
      action,
    });

    return { taskArn, taskId };
  }
}

// Singleton instance
let instance: ECSTaskRunner | null = null;

export function getECSTaskRunner(): ECSTaskRunner {
  if (!instance) {
    instance = new ECSTaskRunner();
  }
  return instance;
}
