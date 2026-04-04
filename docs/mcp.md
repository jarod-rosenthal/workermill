# MCP Integration

Control WorkerMill directly from Claude Code, Claude Desktop, or other MCP-compatible tools using the WorkerMill MCP server.

## What is MCP?

**Model Context Protocol (MCP)** is an open protocol that allows AI assistants to connect to external tools and data sources. With the WorkerMill MCP server, you can manage tasks, view logs, and control the platform — directly from your AI assistant.

## Setup

### Step 1 — Generate an API Key

Go to **WorkerMill Settings → API Access → WorkerMill** and create a new API key. Give it a descriptive name like "Claude Code" or "My Laptop".

### Step 2 — Add to Claude Code Configuration

Add this to `~/.claude/settings.json`. Choose SSE (remote) or stdio (local) transport:

**SSE (Remote) — recommended:**
```json
{
  "mcpServers": {
    "workermill": {
      "type": "sse",
      "url": "https://workermill.com/api/mcp/sse",
      "headers": {
        "x-api-key": "YOUR_API_KEY"
      }
    }
  }
}
```

**stdio (Local npx):**
```json
{
  "mcpServers": {
    "workermill": {
      "command": "npx",
      "args": ["-y", "@workermill/mcp-server"],
      "env": {
        "WORKERMILL_API_KEY": "YOUR_API_KEY",
        "WORKERMILL_API_URL": "https://workermill.com"
      }
    }
  }
}
```

Replace `YOUR_API_KEY` with the key you generated.

### Step 3 — Restart Claude Code

Restart Claude Code to load the new MCP server. You should see WorkerMill tools available.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `WORKERMILL_API_KEY` | ✓ | Your WorkerMill API key |
| `WORKERMILL_API_URL` | — | Base URL (default: `https://workermill.com`). Set for self-hosted instances. |

## Available Tools

### Task Management
| Tool | Parameters | Description |
|------|-----------|-------------|
| `workermill_list_tasks` | `status?, limit?, offset?` | List tasks with optional status filter |
| `workermill_get_task` | `id` | Get detailed task information |
| `workermill_create_task` | `jiraIssueKey, persona?, model?` | Create a new task from a Jira, GitHub, or GitLab issue |
| `workermill_cancel_task` | `id` | Cancel a running task |
| `workermill_retry_task` | `id` | Retry a failed task |
| `workermill_delete_task` | `id` | Delete a task from history |
| `workermill_update_task` | `taskId, status?, prUrl?, prNumber?` | Update task metadata |

### Plan Management
| Tool | Parameters | Description |
|------|-----------|-------------|
| `workermill_get_plan` | `id` | Get execution plan for a task |
| `workermill_approve_plan` | `id, executionMode?` | Approve an execution plan |
| `workermill_request_changes` | `id, feedback` | Request changes to a plan |
| `workermill_get_children` | `id` | Get child tasks of a build |

### Orchestrator Control
| Tool | Parameters | Description |
|------|-----------|-------------|
| `workermill_orchestrator_status` | (none) | Get orchestrator status |
| `workermill_start_orchestrator` | (none) | Start task processing |
| `workermill_stop_orchestrator` | (none) | Stop task processing |

### Monitoring
| Tool | Parameters | Description |
|------|-----------|-------------|
| `workermill_dashboard_stats` | (none) | Get dashboard statistics |
| `workermill_get_task_logs` | `taskId, limit?, since?` | Get recent task logs |
| `workermill_get_all_task_logs` | `taskId, limit?` | Get complete task log history |
| `workermill_get_coordination_feed` | `parentTaskId, messageType?, since?, limit?` | Get expert collaboration feed |

### Settings & Configuration
| Tool | Parameters | Description |
|------|-----------|-------------|
| `workermill_get_settings` | (none) | Get organization settings |
| `workermill_update_settings` | various | Update organization settings |
| `workermill_get_integrations` | (none) | Get integration status |
| `workermill_get_models` | (none) | Get available AI models |
| `workermill_get_providers` | (none) | Get AI provider status |

### Codebase RAG
| Tool | Parameters | Description |
|------|-----------|-------------|
| `workermill_codebase_search` | `repository, query, limit?, ...` | Semantic code search via vector embeddings |
| `workermill_codebase_symbol` | `repository, name, branch?, limit?` | Find code by exact symbol name |
| `workermill_codebase_file` | `repository, path, branch?` | Get indexed chunks for a specific file |
| `workermill_codebase_index` | `repository, branch?, forceReindex?, maxFiles?` | Trigger indexing for a repository |
| `workermill_codebase_status` | `repository, branch?` | Get indexing status |
| `workermill_codebase_stats` | (none) | Org-wide indexing statistics |
| `workermill_codebase_repositories` | (none) | List all indexed repositories |

## Guided Prompts

Pre-built workflows that guide AI assistants through multi-step tasks:

| Prompt | Args | Description |
|--------|------|-------------|
| `troubleshoot_task` | `task_id` | Debug a failed task step-by-step |
| `create_and_monitor_task` | `jira_key` | Create a task and monitor through completion |
| `review_epic_progress` | `task_id` | Review an Epic's progress with collaboration feed |
| `optimize_worker_settings` | (none) | Review settings and suggest optimizations |

## Usage Examples

In Claude Code, you can ask Claude naturally:

```
workermill_list_tasks(status: "running")
workermill_create_task(jiraIssueKey: "PROJ-123")
workermill_orchestrator_status()
workermill_get_task_logs(taskId: "abc-123", limit: 50)
workermill_dashboard_stats()
workermill_codebase_search(repository: "org/repo", query: "authentication middleware")
```

Or ask naturally: *"Show me all running tasks"* or *"Create a task for PROJ-456"* and Claude will use the appropriate tools.

## Common Workflows

**Monitor Active Work:**
1. Check orchestrator status
2. List running tasks
3. View logs for specific task
4. Check dashboard stats

**Create & Track Task:**
1. Create task from Jira issue
2. Monitor task status
3. View execution logs
4. Check coordination feed for epics

**Handle Failures:**
1. List failed tasks
2. Get task details and logs
3. Retry or cancel task
4. Update task metadata if needed

**Codebase Search:**
1. Index a repository
2. Check indexing status
3. Search code by meaning
4. Look up symbols and files

## Security Notes

- API keys are scoped to your organization
- Keys can be revoked anytime from Settings
- All API calls are logged for audit
- SSE connection encrypted via HTTPS
- stdio transport runs locally — API key never leaves your machine
