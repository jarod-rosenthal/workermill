***REMOVED*** WorkerMill MCP Server Implementation TODO

***REMOVED******REMOVED*** Overview
Create a custom MCP server that exposes WorkerMill's API, enabling Claude Code sessions to manage tasks, control the orchestrator, and monitor the platform.

---

***REMOVED******REMOVED*** Implementation Checklist

***REMOVED******REMOVED******REMOVED*** 1. Package Setup
- [x] Create `package.json`
- [x] Create `tsconfig.json`

***REMOVED******REMOVED******REMOVED*** 2. API Client (`src/client.ts`)
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

***REMOVED******REMOVED******REMOVED*** 3. Tool Definitions (`src/tools/index.ts`)
Define MCP tools with Zod schemas:

***REMOVED******REMOVED******REMOVED******REMOVED*** Task Management Tools
- [x] `workermill_list_tasks` - List tasks with optional status filter
- [x] `workermill_get_task` - Get task details by ID
- [x] `workermill_create_task` - Create task from Jira issue key
- [x] `workermill_cancel_task` - Cancel a running task
- [x] `workermill_retry_task` - Retry a failed/completed task
- [x] `workermill_delete_task` - Delete a task from history

***REMOVED******REMOVED******REMOVED******REMOVED*** Plan Management Tools
- [x] `workermill_get_plan` - Get execution plan for PRD task
- [x] `workermill_approve_plan` - Approve plan with execution mode
- [x] `workermill_request_changes` - Request plan changes with feedback
- [x] `workermill_get_children` - Get child tasks for PRD task

***REMOVED******REMOVED******REMOVED******REMOVED*** Orchestrator Tools
- [x] `workermill_orchestrator_status` - Get orchestrator running status
- [x] `workermill_start_orchestrator` - Start the orchestrator
- [x] `workermill_stop_orchestrator` - Stop the orchestrator

***REMOVED******REMOVED******REMOVED******REMOVED*** Monitoring Tools
- [x] `workermill_dashboard_stats` - Get dashboard statistics

***REMOVED******REMOVED******REMOVED******REMOVED*** Settings Tools
- [x] `workermill_get_settings` - Get organization settings
- [x] `workermill_update_settings` - Update organization settings
- [x] `workermill_get_integrations` - Get integration status
- [x] `workermill_get_models` - Get available AI models
- [x] `workermill_get_providers` - Get available AI providers

***REMOVED******REMOVED******REMOVED*** 4. MCP Server Entry Point (`src/server.ts`)
- [x] Set up stdio transport
- [x] Register all tools
- [x] Handle tool calls
- [x] Error handling

***REMOVED******REMOVED******REMOVED*** 5. Public Exports (`src/index.ts`)
- [x] Export client
- [x] Export tools
- [x] Export server (via bin entry point)

***REMOVED******REMOVED******REMOVED*** 6. Build & Configuration
- [x] Run `npm install`
- [x] Run `npm run build`
- [x] Update `.mcp.json` - Add workermill server entry
- [x] Update `.claude/settings.local.json` - Enable the server

***REMOVED******REMOVED******REMOVED*** 7. Verification
- [x] Server starts without errors
- [ ] Restart Claude Code (requires user action)
- [ ] Test `workermill_orchestrator_status` (requires API key)
- [ ] Test `workermill_list_tasks` (requires API key)
- [ ] Test `workermill_dashboard_stats` (requires API key)

---

***REMOVED******REMOVED*** Version 1.1.0 Additions

***REMOVED******REMOVED******REMOVED*** New Tools
- [x] `workermill_get_task_logs` - Get recent execution logs for a task (polling with cursor)
- [x] `workermill_get_all_task_logs` - Get ALL logs for a task (full history for analysis)
- [x] `workermill_get_coordination_feed` - Get Epic/PRD expert collaboration feed

***REMOVED******REMOVED******REMOVED*** Guided Prompts
- [x] `troubleshoot_task` - Step-by-step debugging for failed tasks
- [x] `create_and_monitor_task` - Full task lifecycle guide
- [x] `review_epic_progress` - Review Epic/PRD multi-story progress
- [x] `optimize_worker_settings` - Settings optimization recommendations

---

***REMOVED******REMOVED*** Authentication
- Environment variable: `WORKERMILL_API_KEY`
- Header format: `x-api-key: <key>`
- API base URL: `WORKERMILL_API_URL` (default: `https://workermill.com`)

---

***REMOVED******REMOVED*** Next Steps
1. Set the `WORKERMILL_API_KEY` in `.mcp.json` (currently a placeholder)
2. Restart Claude Code to load the new MCP server
3. Test the workermill_* tools

---

***REMOVED******REMOVED*** Reference Files
| File | Purpose |
|------|---------|
| `packages/oncallshift-mcp/src/server.ts` | Server template |
| `packages/oncallshift-mcp/src/client.ts` | Client pattern |
| `packages/oncallshift-mcp/src/tools/index.ts` | Tool definition pattern |
| `api/src/routes/tasks.ts` | WorkerMill task endpoints |
| `api/src/routes/orchestrator.ts` | Orchestrator endpoints |
| `api/src/routes/control-center.ts` | Dashboard endpoints |
