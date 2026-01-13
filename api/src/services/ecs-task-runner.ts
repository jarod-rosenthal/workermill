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
import { config } from "../config/index.js";
import { WorkerTask } from "../models/index.js";
import { logger } from "../utils/logger.js";

interface TaskCredentials {
  anthropicApiKey: string;
  githubToken: string;
  orgApiKey?: string;
  jiraBaseUrl?: string;
  jiraEmail?: string;
  jiraApiToken?: string;
}

interface RunTaskResult {
  taskArn: string;
  taskId: string;
}

interface TaskStatus {
  taskArn: string;
  taskId: string;
  status: "PROVISIONING" | "PENDING" | "RUNNING" | "DEPROVISIONING" | "STOPPED" | "UNKNOWN";
  exitCode?: number;
  reason?: string;
  startedAt?: Date;
  stoppedAt?: Date;
}

interface LogEvent {
  timestamp: number;
  message: string;
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
   */
  async runWorkerTask(
    task: WorkerTask,
    credentials: TaskCredentials
  ): Promise<RunTaskResult> {
    // Map model to Claude CLI short name
    const modelToCliName = (model: string): string => {
      if (model.includes("opus")) return "opus";
      if (model.includes("haiku")) return "haiku";
      return "sonnet";
    };

    const environment = [
      { name: "TASK_ID", value: task.id },
      { name: "ORG_ID", value: task.orgId },
      { name: "JIRA_ISSUE_KEY", value: task.jiraIssueKey },
      { name: "JIRA_SUMMARY", value: task.summary },
      { name: "JIRA_DESCRIPTION", value: task.description || "" },
      { name: "GITHUB_REPO", value: task.githubRepo },
      { name: "WORKER_PERSONA", value: task.workerPersona },
      { name: "CLAUDE_MODEL", value: modelToCliName(task.workerModel) },
      { name: "ANTHROPIC_API_KEY", value: credentials.anthropicApiKey },
      { name: "GITHUB_TOKEN", value: credentials.githubToken },
      { name: "API_BASE_URL", value: config.apiBaseUrl },
      { name: "RETRY_NUMBER", value: String(task.retryCount) },
      // Jira credentials for ticket updates
      { name: "JIRA_BASE_URL", value: credentials.jiraBaseUrl || "" },
      { name: "JIRA_EMAIL", value: credentials.jiraEmail || "" },
      { name: "JIRA_API_TOKEN", value: credentials.jiraApiToken || "" },
      { name: "TICKET_KEY", value: task.jiraIssueKey },
      // Workflow control flags
      { name: "DEPLOYMENT_ENABLED", value: task.deploymentEnabled ? "true" : "false" },
      { name: "REVIEW_ENABLED", value: task.skipManagerReview === false ? "true" : "false" },
      { name: "TASK_NOTES", value: task.taskNotes || "" },
      // Deployment infrastructure (for Kaniko builds and ECS deployments)
      { name: "AWS_REGION", value: config.aws.region },
      { name: "ECS_CLUSTER", value: config.aws.ecsCluster },
      // Oncallshift deployment targets (hardcoded for now, will be org-configurable later)
      { name: "DOCKER_REGISTRY", value: "593971626975.dkr.ecr.us-east-1.amazonaws.com/oncallshift-dev/backend" },
      { name: "CLUSTER_NAME", value: "oncallshift-dev" },
      { name: "SERVICE_NAME", value: "oncallshift-dev-backend" },
      { name: "FRONTEND_BUCKET", value: "oncallshift-dev-frontend-593971626975" },
      { name: "CDN_DISTRIBUTION_ID", value: "E7BQGD7BWAB8B" },
      { name: "HEALTH_CHECK_URL", value: "https://oncallshift.com/api/health" },
    ].filter((env) => env.value !== "");

    if (credentials.orgApiKey) {
      environment.push({ name: "ORG_API_KEY", value: credentials.orgApiKey });
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
        { key: "JiraIssueKey", value: task.jiraIssueKey },
        { key: "WorkerPersona", value: task.workerPersona },
      ],
    });

    const response = await this.ecs.send(command);

    if (!response.tasks || response.tasks.length === 0) {
      const failures = response.failures?.map((f) => `${f.arn}: ${f.reason}`).join(", ");
      throw new Error(`Failed to start ECS task: ${failures || "Unknown error"}`);
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
    options?: { startTime?: number; limit?: number; nextToken?: string }
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
   * Spawn an ECS task for the Virtual Manager (PR review, log analysis)
   */
  async runManagerTask(
    task: WorkerTask,
    credentials: TaskCredentials,
    action: "review_pr" | "analyze_logs"
  ): Promise<RunTaskResult> {
    // Map model based on action (Opus for review, Haiku for analysis)
    const modelForAction = action === "review_pr" ? "opus" : "haiku";

    const environment = [
      { name: "TASK_ID", value: task.id },
      { name: "ORG_ID", value: task.orgId },
      { name: "MANAGER_ACTION", value: action },
      { name: "JIRA_ISSUE_KEY", value: task.jiraIssueKey },
      { name: "JIRA_SUMMARY", value: task.summary },
      { name: "JIRA_DESCRIPTION", value: task.description || "" },
      { name: "GITHUB_REPO", value: task.githubRepo },
      { name: "PR_URL", value: task.githubPrUrl || "" },
      { name: "PR_NUMBER", value: String(task.githubPrNumber || "") },
      { name: "REVIEW_FEEDBACK", value: task.reviewFeedback || "" },
      { name: "CLAUDE_MODEL", value: modelForAction },
      { name: "ANTHROPIC_API_KEY", value: credentials.anthropicApiKey },
      { name: "GITHUB_TOKEN", value: credentials.githubToken },
      { name: "API_BASE_URL", value: config.apiBaseUrl },
      // Jira credentials for ticket updates
      { name: "JIRA_BASE_URL", value: credentials.jiraBaseUrl || "" },
      { name: "JIRA_EMAIL", value: credentials.jiraEmail || "" },
      { name: "JIRA_API_TOKEN", value: credentials.jiraApiToken || "" },
    ].filter((env) => env.value !== "");

    if (credentials.orgApiKey) {
      environment.push({ name: "ORG_API_KEY", value: credentials.orgApiKey });
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
        { key: "JiraIssueKey", value: task.jiraIssueKey },
        { key: "ManagerAction", value: action },
        { key: "Component", value: "virtual-manager" },
      ],
    });

    const response = await this.ecs.send(command);

    if (!response.tasks || response.tasks.length === 0) {
      const failures = response.failures?.map((f) => `${f.arn}: ${f.reason}`).join(", ");
      throw new Error(`Failed to start Manager ECS task: ${failures || "Unknown error"}`);
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
