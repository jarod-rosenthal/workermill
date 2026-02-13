/**
 * WorkerMill MCP Server
 *
 * Public exports for programmatic use of the MCP server components.
 *
 * @example
 * ```typescript
 * // The server is typically run as a standalone process:
 * // WORKERMILL_API_KEY=your-key npx @workermill/mcp-server
 *
 * // Or import the client for programmatic use:
 * import { WorkerMillClient } from '@workermill/mcp-server';
 *
 * const client = new WorkerMillClient({
 *   apiKey: 'your-api-key',
 *   baseUrl: 'https://workermill.com'
 * });
 *
 * const tasks = await client.listTasks({ status: 'running' });
 * ```
 */

// Note: The MCP server is run via CLI: `npx @workermill/mcp-server` or `node build/server.js`
// The server.ts file is the entry point (see package.json bin configuration)

// Client exports
export {
  WorkerMillClient,
  type WorkerMillClientConfig,
  type ApiResponse,
  type ListTasksParams,
  type CreateTaskPayload,
  type ApprovePlanPayload,
  type RequestChangesPayload,
  type OrgSettingsPayload,
  type CodebaseSearchPayload,
  type CodebaseIndexPayload,
  type CodebaseSymbolParams,
  type CodebaseFileParams,
} from "./client.js";

// Tool exports
export { allTools, type ToolDefinition } from "./tools/index.js";

// Individual tool exports for custom server configurations
export {
  // Task Management
  listTasksTool,
  getTaskTool,
  createTaskTool,
  cancelTaskTool,
  retryTaskTool,
  deleteTaskTool,
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
} from "./tools/index.js";
