/**
 * ComputeProvider Interface
 *
 * Abstraction for compute providers (AWS ECS, Kubernetes, Docker, etc.)
 * Implement this interface to run worker tasks on different platforms.
 */

export interface ContainerTask {
  arn: string;
  id: string;
  status: "pending" | "running" | "stopped" | "failed";
  exitCode?: number;
  startedAt?: Date;
  stoppedAt?: Date;
  reason?: string;
}

export interface ContainerLogs {
  events: Array<{
    timestamp: Date;
    message: string;
  }>;
}

export interface RunTaskOptions {
  taskDefinition: string;
  containerOverrides?: Record<string, any>;
  environment?: Record<string, string>;
  secrets?: Record<string, string>;
  cpu?: string;
  memory?: string;
  tags?: Record<string, string>;
}

export interface ComputeProviderConfig {
  region?: string;
  cluster?: string;
  [key: string]: any;
}

export interface ComputeProvider {
  /**
   * Initialize the compute provider
   */
  initialize(config: ComputeProviderConfig): Promise<void>;

  /**
   * Run a new container task
   */
  runTask(options: RunTaskOptions): Promise<ContainerTask>;

  /**
   * Stop a running task
   */
  stopTask(taskArn: string, reason?: string): Promise<void>;

  /**
   * Get the status of a task
   */
  getTaskStatus(taskArn: string): Promise<ContainerTask>;

  /**
   * Wait for a task to complete
   */
  waitForTaskCompletion(
    taskArn: string,
    options?: { timeoutMs?: number; pollIntervalMs?: number }
  ): Promise<ContainerTask>;

  /**
   * Get logs from a task
   */
  getTaskLogs(taskId: string, options?: { limit?: number }): Promise<ContainerLogs>;
}
