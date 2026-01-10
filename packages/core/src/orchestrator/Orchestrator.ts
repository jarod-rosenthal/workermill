/**
 * AI Worker Orchestrator
 *
 * Core orchestration logic for managing AI agent task execution.
 * Uses pluggable interfaces for queue, compute, task source, and result publishing.
 */

import { DataSource, In, Not } from "typeorm";
import { AIWorkerTask, AIWorkerTaskStatus } from "../models/AIWorkerTask";
import { AIWorkerInstance } from "../models/AIWorkerInstance";
import { AIWorkerTaskLog } from "../models/AIWorkerTaskLog";
import { AIWorkerApproval } from "../models/AIWorkerApproval";
import { TaskSource, NullTaskSource } from "../interfaces/TaskSource";
import { ResultPublisher, NullResultPublisher } from "../interfaces/ResultPublisher";
import { ComputeProvider, ContainerTask } from "../interfaces/ComputeProvider";
import { QueueProvider, QueueMessage as IQueueMessage } from "../interfaces/QueueProvider";
import { QueueMessage, TaskOutput, OrchestratorConfig, OrchestratorEvents } from "./types";

export interface OrchestratorDependencies {
  dataSource: DataSource;
  queueProvider: QueueProvider<QueueMessage>;
  computeProvider: ComputeProvider;
  taskSource?: TaskSource;
  resultPublisher?: ResultPublisher;
  logger?: Logger;
}

export interface Logger {
  info(message: string, meta?: Record<string, any>): void;
  warn(message: string, meta?: Record<string, any>): void;
  error(message: string, meta?: Record<string, any>): void;
  debug(message: string, meta?: Record<string, any>): void;
}

const defaultLogger: Logger = {
  info: (msg, meta) => console.log(`[INFO] ${msg}`, meta || ""),
  warn: (msg, meta) => console.warn(`[WARN] ${msg}`, meta || ""),
  error: (msg, meta) => console.error(`[ERROR] ${msg}`, meta || ""),
  debug: (msg, meta) => console.debug(`[DEBUG] ${msg}`, meta || ""),
};

export class Orchestrator {
  private dataSource: DataSource;
  private queue: QueueProvider<QueueMessage>;
  private compute: ComputeProvider;
  private taskSource: TaskSource;
  private resultPublisher: ResultPublisher;
  private logger: Logger;
  private config: OrchestratorConfig;
  private events: OrchestratorEvents;
  private running = false;

  constructor(
    deps: OrchestratorDependencies,
    config: OrchestratorConfig,
    events: OrchestratorEvents = {}
  ) {
    this.dataSource = deps.dataSource;
    this.queue = deps.queueProvider;
    this.compute = deps.computeProvider;
    this.taskSource = deps.taskSource || new NullTaskSource();
    this.resultPublisher = deps.resultPublisher || new NullResultPublisher();
    this.logger = deps.logger || defaultLogger;
    this.config = config;
    this.events = events;
  }

  async start(): Promise<void> {
    this.running = true;
    this.logger.info("Orchestrator starting...");

    while (this.running) {
      try {
        await this.pollQueue();
      } catch (error) {
        this.logger.error("Error in polling loop", { error });
        this.events.onError?.(error as Error);
        await this.sleep(5000);
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.logger.info("Orchestrator stopping...");
  }

  private async pollQueue(): Promise<void> {
    const messages = await this.queue.receiveMessages({
      maxMessages: 1,
      waitTimeSeconds: 1,
      visibilityTimeout: 3600,
    });

    for (const message of messages) {
      try {
        await this.processMessage(message.body);
        await this.queue.deleteMessage(message.receiptHandle);
      } catch (error) {
        this.logger.error("Error processing message", {
          error,
          messageId: message.id,
        });
      }
    }
  }

  private async processMessage(message: QueueMessage): Promise<void> {
    this.logger.info("Processing message", {
      action: message.action,
      taskId: message.taskId,
    });

    switch (message.action) {
      case "execute":
        await this.executeTask(message.taskId);
        break;
      case "retry":
        await this.retryTask(message.taskId);
        break;
      case "cancel":
        await this.cancelTask(message.taskId);
        break;
      case "check_status":
        await this.checkTaskStatus(message.taskId);
        break;
      default:
        this.logger.warn("Unknown action", { action: message.action });
    }
  }

  private async executeTask(taskId: string): Promise<void> {
    const taskRepo = this.dataSource.getRepository(AIWorkerTask);
    const workerRepo = this.dataSource.getRepository(AIWorkerInstance);

    // Atomic claim to prevent duplicate execution
    const claimResult = await taskRepo
      .createQueryBuilder()
      .update(AIWorkerTask)
      .set({ status: "claimed" as AIWorkerTaskStatus })
      .where("id = :id AND status = :status", { id: taskId, status: "queued" })
      .execute();

    if (claimResult.affected === 0) {
      this.logger.info("Task already claimed, skipping", { taskId });
      return;
    }

    const task = await taskRepo.findOne({ where: { id: taskId } });
    if (!task) {
      this.logger.error("Task not found after claim", { taskId });
      return;
    }

    this.logger.info("Task claimed", {
      taskId,
      externalKey: task.externalKey,
    });

    try {
      // Check persona concurrency - only 1 active task per persona
      const activeTaskForPersona = await taskRepo.findOne({
        where: {
          tenantId: task.tenantId,
          workerPersona: task.workerPersona,
          status: In([
            "claimed",
            "environment_setup",
            "executing",
            "revision_needed",
            "deployment_pending",
            "deploying",
            "deployed_validating",
          ]),
          id: Not(task.id),
        },
      });

      if (activeTaskForPersona) {
        this.logger.info("Persona slot occupied, requeueing", {
          taskId: task.id,
          persona: task.workerPersona,
          blockingTaskId: activeTaskForPersona.id,
        });
        await this.requeueTaskWithBackoff(task, "persona_slot_occupied");
        return;
      }

      await this.logTaskEvent(task, "status_change", "Task claimed by orchestrator");
      this.events.onTaskStarted?.(taskId);

      // Assign or create worker
      let worker = await workerRepo.findOne({
        where: {
          tenantId: task.tenantId,
          persona: task.workerPersona,
          status: "idle",
        },
      });

      if (!worker) {
        worker = workerRepo.create({
          tenantId: task.tenantId,
          persona: task.workerPersona,
          displayName: `${task.workerPersona.replace(/_/g, " ")} (Auto-created)`,
          status: "working",
          currentTaskId: task.id,
        });
        await workerRepo.save(worker);
      } else {
        worker.status = "working";
        worker.currentTaskId = task.id;
        await workerRepo.save(worker);
      }

      task.assignedWorkerId = worker.id;
      await taskRepo.save(task);

      // Update status
      await this.updateTaskStatus(task, "environment_setup");
      await this.logTaskEvent(task, "status_change", "Setting up execution environment");

      // Spawn compute task
      const containerTask = await this.compute.runTask({
        taskDefinition: this.config.cluster || "ai-worker",
        environment: {
          TASK_ID: task.id,
          EXTERNAL_KEY: task.externalKey,
          GIT_REPO: task.gitRepo,
        },
        tags: {
          taskId: task.id,
          persona: task.workerPersona,
        },
      });

      task.containerTaskArn = containerTask.arn;
      task.containerTaskId = containerTask.id;
      task.startedAt = new Date();
      await this.updateTaskStatus(task, "executing");
      await taskRepo.save(task);

      await this.logTaskEvent(task, "status_change", `Container task started: ${containerTask.id}`);

      // Update external task source
      await this.taskSource.updateTask(task.externalId, {
        status: "In Progress",
        comment: `AI worker started execution`,
      });

      // Monitor completion
      this.monitorTaskCompletion(task).catch((error) => {
        this.logger.error("Error monitoring task", { taskId: task.id, error });
      });
    } catch (error: any) {
      await this.handleTaskError(task, error);
    }
  }

  private async monitorTaskCompletion(task: AIWorkerTask): Promise<void> {
    const taskRepo = this.dataSource.getRepository(AIWorkerTask);
    const workerRepo = this.dataSource.getRepository(AIWorkerInstance);

    if (!task.containerTaskArn) {
      this.logger.error("No container task to monitor", { taskId: task.id });
      return;
    }

    try {
      const status = await this.compute.waitForTaskCompletion(task.containerTaskArn, {
        timeoutMs: this.config.taskTimeoutMs || 3600000,
        pollIntervalMs: 30000,
      });

      // Calculate duration
      if (status.startedAt && status.stoppedAt) {
        task.computeSeconds = Math.floor(
          (status.stoppedAt.getTime() - status.startedAt.getTime()) / 1000
        );
      }

      if (status.exitCode === 0) {
        // Success - parse output
        const logs = await this.compute.getTaskLogs(task.containerTaskId!, { limit: 2000 });
        const output = this.parseTaskOutput(logs.events.map((e) => e.message).join("\n"));

        if (output.inputTokens !== undefined) {
          task.aiInputTokens = output.inputTokens;
        }
        if (output.outputTokens !== undefined) {
          task.aiOutputTokens = output.outputTokens;
        }
        if (output.model) {
          task.workerModel = output.model;
        }

        if (output.prUrl) {
          task.gitPrUrl = output.prUrl;
          task.gitPrNumber = output.prNumber ?? null;
          task.gitBranch = output.branch ?? null;
          await this.updateTaskStatus(task, "pr_created");
          await this.logTaskEvent(task, "pr_created", `PR created: ${output.prUrl}`);
        } else if (output.result === "no_changes") {
          await this.updateTaskStatus(task, "completed");
          await this.logTaskEvent(task, "status_change", "Completed with no changes needed");
        } else {
          await this.updateTaskStatus(task, "completed");
          await this.logTaskEvent(task, "status_change", "Task completed");
        }

        this.events.onTaskCompleted?.(task.id, true);
      } else {
        task.errorMessage = status.reason || `Exit code: ${status.exitCode}`;
        await this.updateTaskStatus(task, "failed");
        await this.logTaskEvent(task, "error", `Task failed: ${task.errorMessage}`);
        this.events.onTaskCompleted?.(task.id, false);
      }

      // Calculate cost
      task.estimatedCostUsd = task.calculateCost();
      await taskRepo.save(task);

      // Release worker
      if (task.assignedWorkerId) {
        const worker = await workerRepo.findOne({ where: { id: task.assignedWorkerId } });
        if (worker) {
          worker.status = "idle";
          worker.currentTaskId = null;
          worker.lastTaskAt = new Date();
          await workerRepo.save(worker);
        }
        task.assignedWorkerId = null;
        await taskRepo.save(task);
      }

      // Update external task source
      await this.taskSource.updateTask(task.externalId, {
        status: task.status === "completed" ? "Done" : "Failed",
      });
    } catch (error: any) {
      await this.handleTaskError(task, error);
    }
  }

  private parseTaskOutput(output: string): TaskOutput {
    const result: TaskOutput = {};

    const resultMatch = output.match(/::result::(\w+)/);
    if (resultMatch) result.result = resultMatch[1];

    const prUrlMatch = output.match(/::pr_url::(\S+)/);
    if (prUrlMatch) result.prUrl = prUrlMatch[1].trim();

    const prNumberMatch = output.match(/::pr_number::(\d+)/);
    if (prNumberMatch) result.prNumber = parseInt(prNumberMatch[1], 10);

    const branchMatch = output.match(/::branch::(\S+)/);
    if (branchMatch) result.branch = branchMatch[1].trim();

    const inputTokensMatch = output.match(/::input_tokens::(\d+)/);
    if (inputTokensMatch) result.inputTokens = parseInt(inputTokensMatch[1], 10);

    const outputTokensMatch = output.match(/::output_tokens::(\d+)/);
    if (outputTokensMatch) result.outputTokens = parseInt(outputTokensMatch[1], 10);

    const modelMatch = output.match(/::model::(\w+)/);
    if (modelMatch) result.model = modelMatch[1];

    return result;
  }

  private async retryTask(taskId: string): Promise<void> {
    const taskRepo = this.dataSource.getRepository(AIWorkerTask);
    const task = await taskRepo.findOne({ where: { id: taskId } });

    if (!task || !task.canRetry()) {
      this.logger.info("Task cannot be retried", { taskId });
      return;
    }

    task.retryCount++;
    task.status = "queued";
    task.errorMessage = null;
    task.containerTaskArn = null;
    task.containerTaskId = null;
    await taskRepo.save(task);

    await this.logTaskEvent(task, "retry", `Retry attempt ${task.retryCount}/${task.maxRetries}`);
    await this.executeTask(taskId);
  }

  private async cancelTask(taskId: string): Promise<void> {
    const taskRepo = this.dataSource.getRepository(AIWorkerTask);
    const workerRepo = this.dataSource.getRepository(AIWorkerInstance);

    const task = await taskRepo.findOne({ where: { id: taskId } });
    if (!task) {
      this.logger.error("Task not found for cancel", { taskId });
      return;
    }

    if (task.containerTaskArn && task.status === "executing") {
      await this.compute.stopTask(task.containerTaskArn, "Cancelled by user");
    }

    if (task.assignedWorkerId) {
      const worker = await workerRepo.findOne({ where: { id: task.assignedWorkerId } });
      if (worker) {
        worker.status = "idle";
        worker.currentTaskId = null;
        worker.tasksCancelled++;
        await workerRepo.save(worker);
      }
    }

    await this.updateTaskStatus(task, "cancelled");
    await this.logTaskEvent(task, "status_change", "Task cancelled");
  }

  private async checkTaskStatus(taskId: string): Promise<void> {
    const taskRepo = this.dataSource.getRepository(AIWorkerTask);
    const task = await taskRepo.findOne({ where: { id: taskId } });

    if (!task?.containerTaskArn) return;

    const status = await this.compute.getTaskStatus(task.containerTaskArn);
    this.logger.info("Task status check", {
      taskId,
      status: status.status,
      exitCode: status.exitCode,
    });
  }

  private async updateTaskStatus(task: AIWorkerTask, status: AIWorkerTaskStatus): Promise<void> {
    const taskRepo = this.dataSource.getRepository(AIWorkerTask);
    const isTerminal = ["completed", "failed", "cancelled"].includes(status);

    await taskRepo.update(
      { id: task.id },
      {
        status,
        ...(isTerminal && { completedAt: new Date() }),
      }
    );

    task.status = status;
    if (isTerminal) {
      task.completedAt = new Date();
    }
  }

  private async logTaskEvent(
    task: AIWorkerTask,
    type: string,
    message: string,
    options?: { severity?: "debug" | "info" | "warning" | "error"; metadata?: Record<string, any> }
  ): Promise<void> {
    const logRepo = this.dataSource.getRepository(AIWorkerTaskLog);
    const log = logRepo.create({
      taskId: task.id,
      type: type as any,
      message,
      severity: options?.severity || "info",
      metadata: options?.metadata,
    });
    await logRepo.save(log);
  }

  private async handleTaskError(task: AIWorkerTask, error: any): Promise<void> {
    const taskRepo = this.dataSource.getRepository(AIWorkerTask);
    const workerRepo = this.dataSource.getRepository(AIWorkerInstance);

    this.logger.error("Task error", { taskId: task.id, error: error.message });

    task.errorMessage = error.message;
    task.estimatedCostUsd = task.calculateCost();
    await taskRepo.save(task);

    await this.updateTaskStatus(task, "failed");
    await this.logTaskEvent(task, "error", error.message, { severity: "error" });

    if (task.assignedWorkerId) {
      const worker = await workerRepo.findOne({ where: { id: task.assignedWorkerId } });
      if (worker) {
        worker.status = "idle";
        worker.currentTaskId = null;
        worker.tasksFailed++;
        await workerRepo.save(worker);
      }
    }

    this.events.onTaskFailed?.(task.id, error);
  }

  private async requeueTaskWithBackoff(task: AIWorkerTask, reason: string): Promise<void> {
    const taskRepo = this.dataSource.getRepository(AIWorkerTask);

    const baseDelay = 30;
    const maxDelay = 300;
    const retryCount = task.personaWaitCount || 0;
    const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);

    task.status = "queued";
    task.personaWaitCount = retryCount + 1;
    await taskRepo.save(task);

    await this.logTaskEvent(task, "info", `Task requeued (${reason}), retry in ${delay}s`);

    setTimeout(async () => {
      try {
        await this.queue.sendMessage({ taskId: task.id, action: "execute" });
      } catch (error) {
        this.logger.error("Failed to requeue task", { taskId: task.id, error });
      }
    }, delay * 1000);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
