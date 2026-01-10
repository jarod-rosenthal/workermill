/**
 * AWS ECS Compute Provider
 *
 * Implementation of ComputeProvider interface for AWS ECS Fargate.
 */

import {
  ECSClient,
  RunTaskCommand,
  StopTaskCommand,
  DescribeTasksCommand,
} from "@aws-sdk/client-ecs";
import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import type {
  ComputeProvider,
  ComputeProviderConfig,
  ContainerTask,
  ContainerLogs,
  RunTaskOptions,
} from "@agents-oncallshift/core";

export interface ECSConfig extends ComputeProviderConfig {
  region?: string;
  cluster: string;
  subnets?: string[];
  securityGroups?: string[];
  logGroup?: string;
  executionRoleArn?: string;
  taskRoleArn?: string;
}

export class ECSComputeProvider implements ComputeProvider {
  private ecs: ECSClient;
  private logs: CloudWatchLogsClient;
  private config: ECSConfig = { cluster: "" };

  constructor() {
    this.ecs = new ECSClient({});
    this.logs = new CloudWatchLogsClient({});
  }

  async initialize(config: ECSConfig): Promise<void> {
    this.config = config;
    const region = config.region || "us-east-1";
    this.ecs = new ECSClient({ region });
    this.logs = new CloudWatchLogsClient({ region });
  }

  async runTask(options: RunTaskOptions): Promise<ContainerTask> {
    const environment = Object.entries(options.environment || {}).map(
      ([name, value]) => ({ name, value })
    );

    const command = new RunTaskCommand({
      cluster: this.config.cluster,
      taskDefinition: options.taskDefinition,
      launchType: "FARGATE",
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: this.config.subnets || [],
          securityGroups: this.config.securityGroups || [],
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
        cpu: options.cpu,
        memory: options.memory,
      },
      tags: Object.entries(options.tags || {}).map(([key, value]) => ({
        key,
        value,
      })),
    });

    const response = await this.ecs.send(command);
    const task = response.tasks?.[0];

    if (!task?.taskArn) {
      throw new Error("Failed to start ECS task");
    }

    const taskId = task.taskArn.split("/").pop() || "";

    return {
      arn: task.taskArn,
      id: taskId,
      status: this.mapECSStatus(task.lastStatus),
      startedAt: task.startedAt,
    };
  }

  async stopTask(taskArn: string, reason?: string): Promise<void> {
    const command = new StopTaskCommand({
      cluster: this.config.cluster,
      task: taskArn,
      reason: reason || "Stopped by orchestrator",
    });

    await this.ecs.send(command);
  }

  async getTaskStatus(taskArn: string): Promise<ContainerTask> {
    const command = new DescribeTasksCommand({
      cluster: this.config.cluster,
      tasks: [taskArn],
    });

    const response = await this.ecs.send(command);
    const task = response.tasks?.[0];

    if (!task) {
      throw new Error(`Task not found: ${taskArn}`);
    }

    const container = task.containers?.[0];

    return {
      arn: task.taskArn || taskArn,
      id: taskArn.split("/").pop() || "",
      status: this.mapECSStatus(task.lastStatus),
      exitCode: container?.exitCode,
      startedAt: task.startedAt,
      stoppedAt: task.stoppedAt,
      reason: task.stoppedReason || container?.reason,
    };
  }

  async waitForTaskCompletion(
    taskArn: string,
    options?: { timeoutMs?: number; pollIntervalMs?: number }
  ): Promise<ContainerTask> {
    const timeoutMs = options?.timeoutMs || 3600000;
    const pollIntervalMs = options?.pollIntervalMs || 30000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getTaskStatus(taskArn);

      if (status.status === "stopped") {
        return status;
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Task timed out after ${timeoutMs}ms`);
  }

  async getTaskLogs(
    taskId: string,
    options?: { limit?: number }
  ): Promise<ContainerLogs> {
    if (!this.config.logGroup) {
      return { events: [] };
    }

    const logStreamName = `worker/${taskId}`;

    try {
      const command = new GetLogEventsCommand({
        logGroupName: this.config.logGroup,
        logStreamName,
        limit: options?.limit || 1000,
        startFromHead: false,
      });

      const response = await this.logs.send(command);

      return {
        events: (response.events || []).map((event) => ({
          timestamp: new Date(event.timestamp || 0),
          message: event.message || "",
        })),
      };
    } catch (error) {
      // Log stream might not exist yet
      return { events: [] };
    }
  }

  private mapECSStatus(
    status?: string
  ): "pending" | "running" | "stopped" | "failed" {
    switch (status) {
      case "PROVISIONING":
      case "PENDING":
        return "pending";
      case "RUNNING":
        return "running";
      case "STOPPED":
        return "stopped";
      default:
        return "pending";
    }
  }
}
