/**
 * WorkerMill MCP Tool Definitions
 *
 * Defines all MCP tools with Zod schemas for parameter validation.
 */

import { z } from "zod";
import type { WorkerMillClient } from "../client.js";

/**
 * Tool definition structure
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  handler: (client: WorkerMillClient, args: unknown) => Promise<unknown>;
}

// ============================================
// Task Management Tools
// ============================================

export const listTasksTool: ToolDefinition = {
  name: "workermill_list_tasks",
  description: "List WorkerMill tasks with optional filters. Returns task IDs, statuses, Jira issue keys, and cost information.",
  inputSchema: z.object({
    status: z.string().optional().describe("Filter by task status (queued, running, completed, failed, cancelled)"),
    limit: z.number().optional().describe("Maximum number of tasks to return"),
    offset: z.number().optional().describe("Number of tasks to skip for pagination"),
  }),
  handler: async (client, args) => {
    const params = args as { status?: string; limit?: number; offset?: number };
    return client.listTasks(params);
  },
};

export const getTaskTool: ToolDefinition = {
  name: "workermill_get_task",
  description: "Get detailed information about a specific WorkerMill task by ID. Includes status, logs, cost, and git information.",
  inputSchema: z.object({
    id: z.string().describe("The task ID to retrieve"),
  }),
  handler: async (client, args) => {
    const { id } = args as { id: string };
    return client.getTask(id);
  },
};

export const createTaskTool: ToolDefinition = {
  name: "workermill_create_task",
  description: "Create a new WorkerMill task from a Jira issue key. The task will be queued for execution by an AI worker. Jira labels are automatically detected (epic, multi-provider, sdk, review, deploy, improve, haiku, sonnet, opus) to configure execution mode.",
  inputSchema: z.object({
    jiraIssueKey: z.string().describe("The Jira issue key (e.g., OCS-123)"),
    workerPersona: z.string().optional().describe("Worker persona (backend_developer, frontend_developer, devops_engineer, etc.)"),
    workerModel: z.string().optional().describe("AI model to use (claude-haiku-4-5, claude-sonnet-4-5, claude-opus-4-6)"),
    summary: z.string().optional().describe("Optional summary override for the task"),
    skipManagerReview: z.boolean().optional().describe("Skip virtual manager review before execution (overrides 'review' label)"),
    deploymentEnabled: z.boolean().optional().describe("Enable auto-deployment after PR approval (overrides 'deploy' label)"),
    improvementEnabled: z.boolean().optional().describe("Enable self-improvement analysis after task completion (overrides 'improve' label)"),
  }),
  handler: async (client, args) => {
    const payload = args as {
      jiraIssueKey: string;
      workerPersona?: string;
      workerModel?: string;
      summary?: string;
      skipManagerReview?: boolean;
      deploymentEnabled?: boolean;
      improvementEnabled?: boolean;
    };
    return client.createTask(payload);
  },
};

export const cancelTaskTool: ToolDefinition = {
  name: "workermill_cancel_task",
  description: "Cancel a running WorkerMill task. The worker container will be stopped.",
  inputSchema: z.object({
    id: z.string().describe("The task ID to cancel"),
  }),
  handler: async (client, args) => {
    const { id } = args as { id: string };
    return client.cancelTask(id);
  },
};

export const retryTaskTool: ToolDefinition = {
  name: "workermill_retry_task",
  description: "Retry a failed or completed WorkerMill task. Creates a new execution attempt.",
  inputSchema: z.object({
    id: z.string().describe("The task ID to retry"),
  }),
  handler: async (client, args) => {
    const { id } = args as { id: string };
    return client.retryTask(id);
  },
};

export const deleteTaskTool: ToolDefinition = {
  name: "workermill_delete_task",
  description: "Delete a WorkerMill task from history. This action cannot be undone.",
  inputSchema: z.object({
    id: z.string().describe("The task ID to delete"),
  }),
  handler: async (client, args) => {
    const { id } = args as { id: string };
    return client.deleteTask(id);
  },
};

export const updateTaskTool: ToolDefinition = {
  name: "workermill_update_task",
  description: "Update/fix a WorkerMill task. Can update status, PR URL, and PR number. Useful for manually fixing tasks with missing metadata.",
  inputSchema: z.object({
    taskId: z.string().describe("The task ID to update"),
    status: z.string().optional().describe("New status for the task (queued, running, completed, failed, review_requested, etc.)"),
    prUrl: z.string().optional().describe("GitHub PR URL to associate with the task"),
    prNumber: z.number().optional().describe("GitHub PR number to associate with the task"),
  }),
  handler: async (client, args) => {
    const payload = args as { taskId: string; status?: string; prUrl?: string; prNumber?: number };
    return client.updateTask(payload);
  },
};

// ============================================
// Plan Management Tools
// ============================================

export const getPlanTool: ToolDefinition = {
  name: "workermill_get_plan",
  description: "Get the execution plan for a PRD task. Returns the planned sub-tasks and their dependencies.",
  inputSchema: z.object({
    id: z.string().describe("The PRD task ID"),
  }),
  handler: async (client, args) => {
    const { id } = args as { id: string };
    return client.getPlan(id);
  },
};

export const approvePlanTool: ToolDefinition = {
  name: "workermill_approve_plan",
  description: "Approve an execution plan for a PRD task. The plan will start executing after approval.",
  inputSchema: z.object({
    id: z.string().describe("The PRD task ID"),
    executionMode: z.enum(["autonomous", "supervised"]).optional().describe("Execution mode: autonomous (auto-approve) or supervised (manual approval)"),
  }),
  handler: async (client, args) => {
    const { id, executionMode } = args as { id: string; executionMode?: "autonomous" | "supervised" };
    return client.approvePlan(id, executionMode ? { executionMode } : undefined);
  },
};

export const requestChangesTool: ToolDefinition = {
  name: "workermill_request_changes",
  description: "Request changes to a PRD task's execution plan. Provide feedback for the planner to revise.",
  inputSchema: z.object({
    id: z.string().describe("The PRD task ID"),
    feedback: z.string().describe("Feedback describing what changes are needed in the plan"),
  }),
  handler: async (client, args) => {
    const { id, feedback } = args as { id: string; feedback: string };
    return client.requestChanges(id, { feedback });
  },
};

export const getChildrenTool: ToolDefinition = {
  name: "workermill_get_children",
  description: "Get child tasks for a PRD parent task. Returns all sub-tasks spawned from the plan.",
  inputSchema: z.object({
    id: z.string().describe("The PRD parent task ID"),
  }),
  handler: async (client, args) => {
    const { id } = args as { id: string };
    return client.getChildren(id);
  },
};

// ============================================
// Orchestrator Tools
// ============================================

export const orchestratorStatusTool: ToolDefinition = {
  name: "workermill_orchestrator_status",
  description: "Get the current status of the WorkerMill orchestrator. Returns whether it's running and processing tasks.",
  inputSchema: z.object({}),
  handler: async (client) => {
    return client.getOrchestratorStatus();
  },
};

export const startOrchestratorTool: ToolDefinition = {
  name: "workermill_start_orchestrator",
  description: "Start the WorkerMill orchestrator. It will begin processing queued tasks.",
  inputSchema: z.object({}),
  handler: async (client) => {
    return client.startOrchestrator();
  },
};

export const stopOrchestratorTool: ToolDefinition = {
  name: "workermill_stop_orchestrator",
  description: "Stop the WorkerMill orchestrator. Running tasks will complete but no new tasks will be started.",
  inputSchema: z.object({}),
  handler: async (client) => {
    return client.stopOrchestrator();
  },
};

// ============================================
// Monitoring Tools
// ============================================

export const dashboardStatsTool: ToolDefinition = {
  name: "workermill_dashboard_stats",
  description: "Get dashboard statistics including task counts, costs, and worker utilization.",
  inputSchema: z.object({}),
  handler: async (client) => {
    return client.getDashboardStats();
  },
};

export const getTaskLogsTool: ToolDefinition = {
  name: "workermill_get_task_logs",
  description: "Get recent execution logs for a WorkerMill task. Returns terminal output from the worker container including commands, stdout/stderr, git operations, and error messages. Response includes 'nextCursor' and 'hasMore' for pagination — pass 'nextCursor' as 'since' to get the next page.",
  inputSchema: z.object({
    taskId: z.string().describe("The task ID to get logs for"),
    limit: z.number().optional().describe("Maximum number of log entries to return (default: 100, max: 50000)"),
    since: z.string().optional().describe("Resume cursor from previous response (format: ISO8601|UUID). Omit to get recent logs."),
  }),
  handler: async (client, args) => {
    const params = args as { taskId: string; limit?: number; since?: string };
    return client.getTaskLogs(params);
  },
};

export const getAllTaskLogsTool: ToolDefinition = {
  name: "workermill_get_all_task_logs",
  description: "Get ALL logs for a task in chronological order. Use this for post-hoc analysis of completed or failed tasks. Returns full log history including type, message, severity, command output, and timestamps.",
  inputSchema: z.object({
    taskId: z.string().describe("The task ID to get all logs for"),
    limit: z.number().optional().describe("Maximum number of log entries to return (default: 500)"),
  }),
  handler: async (client, args) => {
    const params = args as { taskId: string; limit?: number };
    return client.getAllTaskLogs(params);
  },
};

export const getCoordinationFeedTool: ToolDefinition = {
  name: "workermill_get_coordination_feed",
  description: "Get the coordination feed for an Epic/PRD task showing expert collaboration. Returns decisions, questions, answers, file changes, and progress updates from all personas working on the task.",
  inputSchema: z.object({
    parentTaskId: z.string().describe("The parent Epic/PRD task ID"),
    messageType: z.string().optional().describe("Filter by message type: decision, question, answer, consultation, file_created, file_modified, completion, blocker, warning, progress, story_ready, story_claimed"),
    since: z.string().optional().describe("Only get messages after this ISO timestamp"),
    limit: z.number().optional().describe("Maximum number of messages to return (default: 100, max: 500)"),
    includeArchived: z.boolean().optional().describe("Include archived messages from completed workflows (default: false)"),
  }),
  handler: async (client, args) => {
    const params = args as {
      parentTaskId: string;
      messageType?: string;
      since?: string;
      limit?: number;
      includeArchived?: boolean;
    };
    return client.getCoordinationFeed(params);
  },
};

// ============================================
// Settings Tools
// ============================================

export const getSettingsTool: ToolDefinition = {
  name: "workermill_get_settings",
  description: "Get organization settings including worker configuration, retention policies, and cost thresholds.",
  inputSchema: z.object({}),
  handler: async (client) => {
    return client.getSettings();
  },
};

export const updateSettingsTool: ToolDefinition = {
  name: "workermill_update_settings",
  description: "Update organization settings. Only provided fields will be changed.",
  inputSchema: z.object({
    logRetentionDays: z.number().optional().describe("Days to retain task logs (default: 30)"),
    taskRetentionDays: z.number().optional().describe("Days to retain completed tasks (default: 90)"),
    maxConcurrentWorkers: z.number().optional().describe("Maximum parallel workers (default: 3)"),
    defaultMaxRetries: z.number().optional().describe("Default retry attempts for failed tasks (default: 3)"),
    taskCooldownSeconds: z.number().optional().describe("Cooldown before re-processing a ticket (default: 30)"),
    defaultWorkerModel: z.string().optional().describe("Default AI model for workers"),
    defaultWorkerPersona: z.string().optional().describe("Default worker persona role"),
    costAlertThresholdUsd: z.number().nullable().optional().describe("Alert threshold for costs in USD"),
  }),
  handler: async (client, args) => {
    const payload = args as {
      logRetentionDays?: number;
      taskRetentionDays?: number;
      maxConcurrentWorkers?: number;
      defaultMaxRetries?: number;
      taskCooldownSeconds?: number;
      defaultWorkerModel?: string;
      defaultWorkerPersona?: string;
      costAlertThresholdUsd?: number | null;
    };
    return client.updateSettings(payload);
  },
};

export const getIntegrationsTool: ToolDefinition = {
  name: "workermill_get_integrations",
  description: "Get the status of all configured integrations (Jira, GitHub, Linear, Slack, etc.).",
  inputSchema: z.object({}),
  handler: async (client) => {
    return client.getIntegrations();
  },
};

export const getModelsTool: ToolDefinition = {
  name: "workermill_get_models",
  description: "Get available AI models that can be used for worker tasks.",
  inputSchema: z.object({}),
  handler: async (client) => {
    return client.getModels();
  },
};

export const getProvidersTool: ToolDefinition = {
  name: "workermill_get_providers",
  description: "Get available AI providers (Anthropic, OpenAI, Ollama, etc.) and their configuration status.",
  inputSchema: z.object({}),
  handler: async (client) => {
    return client.getProviders();
  },
};

// ============================================
// Codebase RAG Tools
// ============================================

export const codebaseSearchTool: ToolDefinition = {
  name: "workermill_codebase_search",
  description:
    "Semantic code search across indexed repositories using vector embeddings. " +
    "Finds relevant code snippets by meaning, not just keywords. " +
    "Returns file paths, line ranges, symbol info, and relevance scores. " +
    "Use multiQuery=true for broader recall (generates multiple search angles from your query).",
  inputSchema: z.object({
    repository: z
      .string()
      .describe("Repository to search (e.g., oncallshift/oncallshift-api)"),
    query: z
      .string()
      .describe(
        "Natural language search query describing the code you're looking for (e.g., 'authentication middleware', 'database connection pool')"
      ),
    limit: z
      .number()
      .optional()
      .describe("Max results to return (1-50, default: 10)"),
    minSimilarity: z
      .number()
      .optional()
      .describe(
        "Minimum similarity threshold (0-1, default: 0.4). Higher = more precise, lower = more results"
      ),
    language: z
      .string()
      .optional()
      .describe("Filter by programming language (e.g., typescript, python)"),
    chunkTypes: z
      .string()
      .optional()
      .describe(
        "Comma-separated chunk types to filter (e.g., 'class,function,interface')"
      ),
    symbolType: z
      .string()
      .optional()
      .describe(
        "Filter by symbol type (function, class, interface, type, enum, variable)"
      ),
    branch: z
      .string()
      .optional()
      .describe("Branch to search (default: main)"),
    multiQuery: z
      .boolean()
      .optional()
      .describe(
        "Enable multi-query search for better recall — generates multiple search queries from your description"
      ),
  }),
  handler: async (client, args) => {
    const params = args as {
      repository: string;
      query: string;
      limit?: number;
      minSimilarity?: number;
      language?: string;
      chunkTypes?: string;
      symbolType?: string;
      branch?: string;
      multiQuery?: boolean;
    };
    return client.codebaseSearch({
      ...params,
      chunkTypes: params.chunkTypes
        ? params.chunkTypes.split(",").map((s) => s.trim())
        : undefined,
    });
  },
};

export const codebaseSymbolTool: ToolDefinition = {
  name: "workermill_codebase_symbol",
  description:
    "Find code by exact symbol name (function, class, interface, type, enum). " +
    "Case-insensitive lookup. Returns the full code chunk containing the symbol definition.",
  inputSchema: z.object({
    repository: z
      .string()
      .describe("Repository to search (e.g., oncallshift/oncallshift-api)"),
    name: z
      .string()
      .describe(
        "Symbol name to find (e.g., 'authenticateRequest', 'WorkerTask', 'CreateTaskPayload')"
      ),
    branch: z
      .string()
      .optional()
      .describe("Branch to search (default: main)"),
    limit: z
      .number()
      .optional()
      .describe("Max results to return (1-50, default: 10)"),
  }),
  handler: async (client, args) => {
    const params = args as {
      repository: string;
      name: string;
      branch?: string;
      limit?: number;
    };
    return client.codebaseSymbol(params);
  },
};

export const codebaseFileTool: ToolDefinition = {
  name: "workermill_codebase_file",
  description:
    "Get all indexed code chunks for a specific file. " +
    "Returns the file's contents broken into semantic chunks (functions, classes, imports, etc.) with line ranges.",
  inputSchema: z.object({
    repository: z
      .string()
      .describe("Repository (e.g., oncallshift/oncallshift-api)"),
    path: z
      .string()
      .describe("File path within the repository (e.g., backend/src/auth/middleware.ts)"),
    branch: z
      .string()
      .optional()
      .describe("Branch (default: main)"),
  }),
  handler: async (client, args) => {
    const params = args as {
      repository: string;
      path: string;
      branch?: string;
    };
    return client.codebaseFile(params);
  },
};

export const codebaseIndexTool: ToolDefinition = {
  name: "workermill_codebase_index",
  description:
    "Trigger indexing for a repository. Indexes source code into vector embeddings for semantic search. " +
    "Indexing runs asynchronously — use workermill_codebase_status to check progress.",
  inputSchema: z.object({
    repository: z
      .string()
      .describe("Repository to index (e.g., oncallshift/oncallshift-api)"),
    branch: z
      .string()
      .optional()
      .describe("Branch to index (default: main)"),
    forceReindex: z
      .boolean()
      .optional()
      .describe("Force re-indexing even if already indexed"),
    maxFiles: z
      .number()
      .optional()
      .describe("Maximum files to index (1-2000)"),
  }),
  handler: async (client, args) => {
    const params = args as {
      repository: string;
      branch?: string;
      forceReindex?: boolean;
      maxFiles?: number;
    };
    return client.codebaseIndex(params);
  },
};

export const codebaseStatusTool: ToolDefinition = {
  name: "workermill_codebase_status",
  description:
    "Get the indexing status for a repository (pending, indexing, ready, failed). " +
    "Shows chunk count, indexed file count, and last indexed commit.",
  inputSchema: z.object({
    repository: z
      .string()
      .describe("Repository to check (e.g., oncallshift/oncallshift-api)"),
    branch: z
      .string()
      .optional()
      .describe("Branch to check (default: main)"),
  }),
  handler: async (client, args) => {
    const { repository, branch } = args as {
      repository: string;
      branch?: string;
    };
    return client.codebaseStatus(repository, branch);
  },
};

export const codebaseStatsTool: ToolDefinition = {
  name: "workermill_codebase_stats",
  description:
    "Get org-wide codebase indexing statistics. " +
    "Shows total chunks, files, repositories, and per-repo breakdown with status.",
  inputSchema: z.object({}),
  handler: async (client) => {
    return client.codebaseStats();
  },
};

export const codebaseRepositoriesTool: ToolDefinition = {
  name: "workermill_codebase_repositories",
  description:
    "List all indexed repositories for the organization. " +
    "Shows repository names, branches, indexing status, and chunk counts.",
  inputSchema: z.object({}),
  handler: async (client) => {
    return client.codebaseRepositories();
  },
};

// ============================================
// All Tools Export
// ============================================

export const allTools: ToolDefinition[] = [
  // Task Management
  listTasksTool,
  getTaskTool,
  createTaskTool,
  cancelTaskTool,
  retryTaskTool,
  deleteTaskTool,
  updateTaskTool,
  // Plan Management
  getPlanTool,
  approvePlanTool,
  requestChangesTool,
  getChildrenTool,
  // Orchestrator
  orchestratorStatusTool,
  startOrchestratorTool,
  stopOrchestratorTool,
  // Monitoring
  dashboardStatsTool,
  getTaskLogsTool,
  getAllTaskLogsTool,
  getCoordinationFeedTool,
  // Settings
  getSettingsTool,
  updateSettingsTool,
  getIntegrationsTool,
  getModelsTool,
  getProvidersTool,
  // Codebase RAG
  codebaseSearchTool,
  codebaseSymbolTool,
  codebaseFileTool,
  codebaseIndexTool,
  codebaseStatusTool,
  codebaseStatsTool,
  codebaseRepositoriesTool,
];
