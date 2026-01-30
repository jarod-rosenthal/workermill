/**
 * WorkerMill API Client
 *
 * A wrapper around the WorkerMill REST API for use by the MCP server.
 */

/**
 * Configuration options for the WorkerMill client
 */
export interface WorkerMillClientConfig {
  apiKey: string;
  baseUrl?: string;
}

/**
 * Standard API response wrapper
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Task list parameters
 */
export interface ListTasksParams {
  status?: string;
  limit?: number;
  offset?: number;
}

/**
 * Task creation payload
 */
export interface CreateTaskPayload {
  jiraIssueKey: string;
  workerPersona?: string;
  workerModel?: string;
  summary?: string;
  skipManagerReview?: boolean;
  deploymentEnabled?: boolean;
  improvementEnabled?: boolean;
}

/**
 * Plan approval payload
 */
export interface ApprovePlanPayload {
  executionMode?: "autonomous" | "supervised";
}

/**
 * Request changes payload
 */
export interface RequestChangesPayload {
  feedback: string;
}

/**
 * Organization settings payload
 */
export interface OrgSettingsPayload {
  logRetentionDays?: number;
  taskRetentionDays?: number;
  maxConcurrentWorkers?: number;
  defaultMaxRetries?: number;
  taskCooldownSeconds?: number;
  defaultWorkerModel?: string;
  defaultWorkerPersona?: string;
  costAlertThresholdUsd?: number | null;
}

/**
 * Update task payload (for fixing/patching tasks)
 */
export interface UpdateTaskPayload {
  taskId: string;
  status?: string;
  prUrl?: string;
  prNumber?: number;
}

/**
 * Task logs parameters (polling endpoint)
 */
export interface GetTaskLogsParams {
  taskId: string;
  limit?: number;
  since?: string; // Resume cursor in format "ISO8601|UUID"
}

/**
 * All task logs parameters (full fetch)
 */
export interface GetAllTaskLogsParams {
  taskId: string;
  limit?: number;
}

/**
 * Coordination feed parameters
 */
export interface GetCoordinationFeedParams {
  parentTaskId: string;
  messageType?: string;
  since?: string;
  limit?: number;
  includeArchived?: boolean;
}

export class WorkerMillClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: WorkerMillClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || "https://workermill.com";
  }

  /**
   * Make an authenticated request to the WorkerMill API
   */
  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    endpoint: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage: string;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.message || errorJson.error || `HTTP ${response.status}`;
        } catch {
          errorMessage = errorText || `HTTP ${response.status}: ${response.statusText}`;
        }
        return {
          success: false,
          error: errorMessage,
        };
      }

      // Handle empty responses (204 No Content)
      const contentLength = response.headers.get("content-length");
      if (response.status === 204 || contentLength === "0") {
        return {
          success: true,
          data: undefined as T,
        };
      }

      const data = (await response.json()) as T;
      return {
        success: true,
        data,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  // ============================================
  // Task Management
  // ============================================

  /**
   * List tasks with optional filters
   * GET /api/tasks
   */
  async listTasks(params?: ListTasksParams): Promise<ApiResponse> {
    const queryParams = new URLSearchParams();

    if (params?.status) queryParams.set("status", params.status);
    if (params?.limit) queryParams.set("limit", params.limit.toString());
    if (params?.offset) queryParams.set("offset", params.offset.toString());

    const query = queryParams.toString();
    const endpoint = `/api/tasks${query ? `?${query}` : ""}`;
    return this.request("GET", endpoint);
  }

  /**
   * Get a single task by ID
   * GET /api/tasks/:id
   */
  async getTask(id: string): Promise<ApiResponse> {
    return this.request("GET", `/api/tasks/${id}`);
  }

  /**
   * Create a new task from a Jira issue key
   * POST /api/tasks
   */
  async createTask(payload: CreateTaskPayload): Promise<ApiResponse> {
    return this.request("POST", "/api/tasks", payload);
  }

  /**
   * Cancel a running task
   * POST /api/tasks/:id/cancel
   */
  async cancelTask(id: string): Promise<ApiResponse> {
    return this.request("POST", `/api/tasks/${id}/cancel`);
  }

  /**
   * Retry a failed or completed task
   * POST /api/tasks/:id/retry
   */
  async retryTask(id: string): Promise<ApiResponse> {
    return this.request("POST", `/api/tasks/${id}/retry`);
  }

  /**
   * Delete a task from history
   * DELETE /api/tasks/:id
   */
  async deleteTask(id: string): Promise<ApiResponse> {
    return this.request("DELETE", `/api/tasks/${id}`);
  }

  /**
   * Update/fix a task (admin operation)
   * POST /api/system/fix-task
   */
  async updateTask(payload: UpdateTaskPayload): Promise<ApiResponse> {
    return this.request("POST", "/api/system/fix-task", payload);
  }

  // ============================================
  // Plan Management
  // ============================================

  /**
   * Get the execution plan for a task
   * GET /api/tasks/:id/plan
   */
  async getPlan(id: string): Promise<ApiResponse> {
    return this.request("GET", `/api/tasks/${id}/plan`);
  }

  /**
   * Approve a plan with optional execution mode
   * POST /api/tasks/:id/plan/approve
   */
  async approvePlan(id: string, payload?: ApprovePlanPayload): Promise<ApiResponse> {
    return this.request("POST", `/api/tasks/${id}/plan/approve`, payload || {});
  }

  /**
   * Request changes to a plan with feedback
   * POST /api/tasks/:id/plan/request-changes
   */
  async requestChanges(id: string, payload: RequestChangesPayload): Promise<ApiResponse> {
    return this.request("POST", `/api/tasks/${id}/plan/request-changes`, payload);
  }

  /**
   * Get child tasks for a PRD parent task
   * GET /api/tasks/:id/children
   */
  async getChildren(id: string): Promise<ApiResponse> {
    return this.request("GET", `/api/tasks/${id}/children`);
  }

  // ============================================
  // Orchestrator Control
  // ============================================

  /**
   * Get orchestrator status
   * GET /api/orchestrator/status
   */
  async getOrchestratorStatus(): Promise<ApiResponse> {
    return this.request("GET", "/api/orchestrator/status");
  }

  /**
   * Start the orchestrator
   * POST /api/orchestrator/start
   */
  async startOrchestrator(): Promise<ApiResponse> {
    return this.request("POST", "/api/orchestrator/start");
  }

  /**
   * Stop the orchestrator
   * POST /api/orchestrator/stop
   */
  async stopOrchestrator(): Promise<ApiResponse> {
    return this.request("POST", "/api/orchestrator/stop");
  }

  // ============================================
  // Monitoring
  // ============================================

  /**
   * Get dashboard statistics
   * GET /api/control-center
   */
  async getDashboardStats(): Promise<ApiResponse> {
    return this.request("GET", "/api/control-center");
  }

  /**
   * Get logs for a task from the database
   * GET /api/control-center/logs/:taskId
   *
   * This fetches logs from PostgreSQL (what workers POST to).
   * For CloudWatch container logs, use /api/tasks/:id/logs instead.
   */
  async getTaskLogs(params: GetTaskLogsParams): Promise<ApiResponse> {
    const queryParams = new URLSearchParams();

    if (params.limit) queryParams.set("limit", params.limit.toString());
    if (params.since) queryParams.set("since", params.since);

    const query = queryParams.toString();
    const endpoint = `/api/control-center/logs/${params.taskId}${query ? `?${query}` : ""}`;
    return this.request("GET", endpoint);
  }

  /**
   * Get ALL logs for a task (for analysis)
   * GET /api/control-center/logs/:taskId/all
   *
   * Returns all logs in chronological order, used for post-hoc analysis.
   */
  async getAllTaskLogs(params: GetAllTaskLogsParams): Promise<ApiResponse> {
    const queryParams = new URLSearchParams();

    if (params.limit) queryParams.set("limit", params.limit.toString());

    const query = queryParams.toString();
    const endpoint = `/api/control-center/logs/${params.taskId}/all${query ? `?${query}` : ""}`;
    return this.request("GET", endpoint);
  }

  /**
   * Get coordination feed for an Epic/PRD task
   * GET /api/coordination/context/:parentTaskId
   */
  async getCoordinationFeed(params: GetCoordinationFeedParams): Promise<ApiResponse> {
    const queryParams = new URLSearchParams();

    if (params.messageType) queryParams.set("messageType", params.messageType);
    if (params.since) queryParams.set("since", params.since);
    if (params.limit) queryParams.set("limit", params.limit.toString());
    if (params.includeArchived) queryParams.set("includeArchived", "true");

    const query = queryParams.toString();
    const endpoint = `/api/coordination/context/${params.parentTaskId}${query ? `?${query}` : ""}`;
    return this.request("GET", endpoint);
  }

  // ============================================
  // Settings Management
  // ============================================

  /**
   * Get organization settings
   * GET /api/settings
   */
  async getSettings(): Promise<ApiResponse> {
    return this.request("GET", "/api/settings");
  }

  /**
   * Update organization settings
   * PUT /api/settings
   */
  async updateSettings(payload: OrgSettingsPayload): Promise<ApiResponse> {
    return this.request("PUT", "/api/settings", payload);
  }

  /**
   * Get integration status for all configured integrations
   * GET /api/settings/integrations
   */
  async getIntegrations(): Promise<ApiResponse> {
    return this.request("GET", "/api/settings/integrations");
  }

  /**
   * Get available AI models
   * GET /api/settings/models
   */
  async getModels(): Promise<ApiResponse> {
    return this.request("GET", "/api/settings/models");
  }

  /**
   * Get available AI providers
   * GET /api/settings/providers
   */
  async getProviders(): Promise<ApiResponse> {
    return this.request("GET", "/api/settings/providers");
  }
}
