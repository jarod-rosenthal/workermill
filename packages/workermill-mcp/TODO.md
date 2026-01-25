# WorkerMill MCP Server Implementation TODO

## Overview
Create a custom MCP server that exposes WorkerMill's API, enabling Claude Code sessions to manage tasks, control the orchestrator, and monitor the platform.

---

## Implementation Checklist

### 1. Package Setup
- [x] Create `package.json`
- [x] Create `tsconfig.json`

### 2. API Client (`src/client.ts`)
Create a WorkerMill API client with these methods:
- [x] `listTasks(status?, limit?, offset?)` - GET /api/tasks
- [x] `getTask(id)` - GET /api/tasks/:id
- [x] `createTask(jiraIssueKey, persona?, model?)` - POST /api/tasks
- [x] `cancelTask(id)` - POST /api/tasks/:id/cancel
- [x] `retryTask(id)` - POST /api/tasks/:id/retry
- [x] `deleteTask(id)` - DELETE /api/tasks/:id
- [x] `getPlan(id)` - GET /api/tasks/:id/plan
- [x] `approvePlan(id, executionMode?)` - POST /api/tasks/:id/plan/approve
- [x] `requestChanges(id, feedback)` - POST /api/tasks/:id/plan/request-changes
- [x] `getChildren(id)` - GET /api/tasks/:id/children
- [x] `getOrchestratorStatus()` - GET /api/orchestrator/status
- [x] `startOrchestrator()` - POST /api/orchestrator/start
- [x] `stopOrchestrator()` - POST /api/orchestrator/stop
- [x] `getDashboardStats()` - GET /api/control-center
- [x] `getSettings()` - GET /api/settings
- [x] `updateSettings(payload)` - PUT /api/settings
- [x] `getIntegrations()` - GET /api/settings/integrations
- [x] `getModels()` - GET /api/settings/models
- [x] `getProviders()` - GET /api/settings/providers

### 3. Tool Definitions (`src/tools/index.ts`)
Define MCP tools with Zod schemas:

#### Task Management Tools
- [x] `workermill_list_tasks` - List tasks with optional status filter
- [x] `workermill_get_task` - Get task details by ID
- [x] `workermill_create_task` - Create task from Jira issue key
- [x] `workermill_cancel_task` - Cancel a running task
- [x] `workermill_retry_task` - Retry a failed/completed task
- [x] `workermill_delete_task` - Delete a task from history

#### Plan Management Tools
- [x] `workermill_get_plan` - Get execution plan for PRD task
- [x] `workermill_approve_plan` - Approve plan with execution mode
- [x] `workermill_request_changes` - Request plan changes with feedback
- [x] `workermill_get_children` - Get child tasks for PRD task

#### Orchestrator Tools
- [x] `workermill_orchestrator_status` - Get orchestrator running status
- [x] `workermill_start_orchestrator` - Start the orchestrator
- [x] `workermill_stop_orchestrator` - Stop the orchestrator

#### Monitoring Tools
- [x] `workermill_dashboard_stats` - Get dashboard statistics

#### Settings Tools
- [x] `workermill_get_settings` - Get organization settings
- [x] `workermill_update_settings` - Update organization settings
- [x] `workermill_get_integrations` - Get integration status
- [x] `workermill_get_models` - Get available AI models
- [x] `workermill_get_providers` - Get available AI providers

### 4. MCP Server Entry Point (`src/server.ts`)
- [x] Set up stdio transport
- [x] Register all tools
- [x] Handle tool calls
- [x] Error handling

### 5. Public Exports (`src/index.ts`)
- [x] Export client
- [x] Export tools
- [x] Export server (via bin entry point)

### 6. Build & Configuration
- [x] Run `npm install`
- [x] Run `npm run build`
- [x] Update `.mcp.json` - Add workermill server entry
- [x] Update `.claude/settings.local.json` - Enable the server

### 7. Verification
- [x] Server starts without errors
- [ ] Restart Claude Code (requires user action)
- [ ] Test `workermill_orchestrator_status` (requires API key)
- [ ] Test `workermill_list_tasks` (requires API key)
- [ ] Test `workermill_dashboard_stats` (requires API key)

---

## Authentication
- Environment variable: `WORKERMILL_API_KEY`
- Header format: `x-api-key: <key>`
- API base URL: `WORKERMILL_API_URL` (default: `https://workermill.com`)

---

## Next Steps
1. Set the `WORKERMILL_API_KEY` in `.mcp.json` (currently a placeholder)
2. Restart Claude Code to load the new MCP server
3. Test the workermill_* tools

---

## Reference Files
| File | Purpose |
|------|---------|
| `packages/oncallshift-mcp/src/server.ts` | Server template |
| `packages/oncallshift-mcp/src/client.ts` | Client pattern |
| `packages/oncallshift-mcp/src/tools/index.ts` | Tool definition pattern |
| `api/src/routes/tasks.ts` | WorkerMill task endpoints |
| `api/src/routes/orchestrator.ts` | Orchestrator endpoints |
| `api/src/routes/control-center.ts` | Dashboard endpoints |
