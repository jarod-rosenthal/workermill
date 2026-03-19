# @workermill/mcp-server

MCP (Model Context Protocol) server for the [WorkerMill](https://workermill.com) AI orchestration platform. Enables Claude Code, Claude Desktop, and other MCP-compatible clients to manage tasks, control the orchestrator, monitor execution, and search indexed codebases through natural language.

## Installation

```bash
npm install @workermill/mcp-server
```

Or run directly:

```bash
WORKERMILL_API_KEY=your-key npx @workermill/mcp-server
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WORKERMILL_API_KEY` | Yes | -- | Your WorkerMill API key (generate from Settings > API Access) |
| `WORKERMILL_API_URL` | No | `https://workermill.com` | API base URL (override for self-hosted instances) |

### Claude Code (SSE — recommended)

Add to `~/.claude/settings.json`:

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

### Claude Code (stdio — local)

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "workermill": {
      "command": "npx",
      "args": ["@workermill/mcp-server"],
      "env": {
        "WORKERMILL_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}
```

### Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "workermill": {
      "command": "npx",
      "args": ["@workermill/mcp-server"],
      "env": {
        "WORKERMILL_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}
```

After adding the config, restart the MCP client for the tools to become available.

## Available Tools

### Task Management

| Tool | Description | Parameters |
|------|-------------|------------|
| `workermill_list_tasks` | List tasks with optional status filter | `status?`, `limit?`, `offset?` |
| `workermill_get_task` | Get detailed task information | `id` |
| `workermill_create_task` | Create a new task from a Jira issue key | `jiraIssueKey`, `workerPersona?`, `workerModel?`, `summary?`, `skipManagerReview?`, `deploymentEnabled?`, `improvementEnabled?` |
| `workermill_cancel_task` | Cancel a running task | `id` |
| `workermill_retry_task` | Retry a failed/completed task | `id` |
| `workermill_delete_task` | Delete a task from history | `id` |
| `workermill_update_task` | Update task metadata (status, PR info) | `taskId`, `status?`, `prUrl?`, `prNumber?` |

### Plan Management

| Tool | Description | Parameters |
|------|-------------|------------|
| `workermill_get_plan` | Get execution plan for a PRD task | `id` |
| `workermill_approve_plan` | Approve a plan for execution | `id`, `executionMode?` (`autonomous` or `supervised`) |
| `workermill_request_changes` | Request changes to a plan | `id`, `feedback` |
| `workermill_get_children` | Get child tasks of a PRD parent task | `id` |

### Orchestrator Control

| Tool | Description | Parameters |
|------|-------------|------------|
| `workermill_orchestrator_status` | Get orchestrator running status | (none) |
| `workermill_start_orchestrator` | Start the orchestrator | (none) |
| `workermill_stop_orchestrator` | Stop the orchestrator | (none) |

### Monitoring

| Tool | Description | Parameters |
|------|-------------|------------|
| `workermill_dashboard_stats` | Get dashboard statistics (task counts, costs) | (none) |
| `workermill_get_task_logs` | Get recent task logs with cursor pagination | `taskId`, `limit?`, `since?` |
| `workermill_get_all_task_logs` | Get complete task log history for analysis | `taskId`, `limit?` |
| `workermill_get_coordination_feed` | Get Epic/PRD expert collaboration feed | `parentTaskId`, `messageType?`, `since?`, `limit?`, `includeArchived?` |

### Settings & Configuration

| Tool | Description | Parameters |
|------|-------------|------------|
| `workermill_get_settings` | Get organization settings | (none) |
| `workermill_update_settings` | Update organization settings | `logRetentionDays?`, `taskRetentionDays?`, `maxConcurrentWorkers?`, `defaultMaxRetries?`, `taskCooldownSeconds?`, `defaultWorkerModel?`, `defaultWorkerPersona?`, `costAlertThresholdUsd?` |
| `workermill_get_integrations` | Get integration status (Jira, GitHub, etc.) | (none) |
| `workermill_get_models` | Get available AI models | (none) |
| `workermill_get_providers` | Get available AI providers | (none) |

### Codebase RAG (Semantic Code Search)

| Tool | Description | Parameters |
|------|-------------|------------|
| `workermill_codebase_search` | Semantic code search using vector embeddings | `repository`, `query`, `limit?`, `minSimilarity?`, `language?`, `chunkTypes?`, `symbolType?`, `branch?`, `multiQuery?` |
| `workermill_codebase_symbol` | Find code by exact symbol name | `repository`, `name`, `branch?`, `limit?` |
| `workermill_codebase_file` | Get indexed chunks for a specific file | `repository`, `path`, `branch?` |
| `workermill_codebase_index` | Trigger indexing for a repository | `repository`, `branch?`, `forceReindex?`, `maxFiles?` |
| `workermill_codebase_status` | Get indexing status for a repository | `repository`, `branch?` |
| `workermill_codebase_stats` | Get org-wide indexing statistics | (none) |
| `workermill_codebase_repositories` | List all indexed repositories | (none) |

## Guided Prompts

The server includes guided prompts that walk through common workflows step-by-step:

| Prompt | Description | Arguments |
|--------|-------------|-----------|
| `troubleshoot_task` | Debug a failed task: analyze logs, identify failure reasons, suggest fixes | `task_id` |
| `create_and_monitor_task` | Full task lifecycle: create from Jira, monitor execution, handle completion | `jira_key` |
| `review_epic_progress` | Review multi-story Epic/PRD progress with expert collaboration | `task_id` |
| `optimize_worker_settings` | Analyze settings and recommend cost/performance/reliability optimizations | (none) |

## Usage Examples

In Claude Code or Claude Desktop, use natural language:

```
> Show me all running tasks
  → calls workermill_list_tasks(status: "running")

> Create a task for PROJ-123
  → calls workermill_create_task(jiraIssueKey: "PROJ-123")

> What's the orchestrator status?
  → calls workermill_orchestrator_status()

> Show me the logs for task abc-123
  → calls workermill_get_task_logs(taskId: "abc-123")

> Search the auth code in my-org/my-repo
  → calls workermill_codebase_search(repository: "my-org/my-repo", query: "authentication")
```

## Programmatic Usage

The client can be imported directly for use outside the MCP server:

```typescript
import { WorkerMillClient } from '@workermill/mcp-server';

const client = new WorkerMillClient({
  apiKey: 'your-api-key',
  baseUrl: 'https://workermill.com',
});

const tasks = await client.listTasks({ status: 'running' });
console.log(tasks.data);
```

## License

Apache-2.0
