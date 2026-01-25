# MCP Integration Strategy for WorkerMill

## Overview

This document outlines how to integrate MCP (Model Context Protocol) servers into WorkerMill to enhance platform management and accelerate development. Three integration tiers are identified, from immediate value to longer-term investments.

---

## Phase 1: Leverage Existing MCPs (Immediate - No Code Changes)

**Goal:** Use the MCP servers already connected to Claude Code sessions to manage WorkerMill more effectively.

### Available MCP Servers

| Server | Key Tools | Use Case |
|--------|-----------|----------|
| `mcp__jira__` | `jira_get`, `jira_post`, `jira_patch` | Create/manage OCS tickets, transitions, comments |
| `mcp__github__` | `create_pull_request`, `list_pull_requests`, `merge_pull_request` | Monitor worker PRs, manage branches |
| `mcp__oncallshift__` | `list_incidents`, `create_incident`, `get_oncall_now` | Incident management for oncallshift product |
| `mcp__ollama__` | `ollama_list`, `ollama_chat`, `ollama_pull` | Local model testing and management |
| `mcp__browsermcp__` | `browser_navigate`, `browser_snapshot`, `browser_click` | UI testing, dashboard verification |

### Practical Workflows

#### 1. Ticket Creation Pipeline
```
1. Use `mcp__jira__jira_post` to create OCS tickets (WITHOUT labels)
2. Show ticket to user, get explicit confirmation
3. Use `mcp__jira__jira_patch` to add `workermill` label only after approval
```

#### 2. PR Management Dashboard
```
- `mcp__github__list_pull_requests` to see all worker-created PRs
- `mcp__github__get_pull_request_status` to check CI status
- `mcp__github__merge_pull_request` to merge approved PRs
```

#### 3. OnCallShift Development
```
- Test oncallshift features via MCP tools
- Create test incidents, verify on-call rotations
- Validate escalation policies
```

#### 4. Browser-Based Testing
```
- Navigate to workermill.com dashboard
- Capture snapshots for visual verification
- Automate UI workflows
```

**No implementation required** - these tools are already available.

---

## Phase 2: Custom WorkerMill MCP Server (High Value)

**Goal:** Create an MCP server that exposes WorkerMill's API, enabling Claude to orchestrate the platform.

### Proposed Location
```
packages/workermill-mcp/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts           # MCP server entry point
│   ├── server.ts          # Server implementation
│   └── tools/
│       ├── tasks.ts       # Task management
│       ├── orchestrator.ts # System control
│       └── monitoring.ts   # Stats and logs
```

### Tool Definitions

```typescript
// Task Management
workermill_list_tasks(status?: "queued"|"running"|"completed"|"failed", limit?: number)
workermill_get_task(taskId: string)
workermill_create_task(jiraIssueKey: string, persona?: string, model?: string)
workermill_cancel_task(taskId: string)
workermill_retry_task(taskId: string)
workermill_approve_task(taskId: string)  // Simulates PR approval gate

// Orchestrator Control
workermill_orchestrator_status()
workermill_start_orchestrator()
workermill_stop_orchestrator()

// Monitoring
workermill_dashboard_stats()
workermill_get_task_logs(taskId: string, limit?: number)
workermill_search_logs(query: string, since?: string)
```

### Authentication
- Use existing org API key mechanism (`x-api-key` header)
- Pass via environment variable: `WORKERMILL_API_KEY`
- API base URL: `WORKERMILL_API_URL` (default: `https://workermill.com`)

### MCP Configuration (for Claude Code)
```json
{
  "mcpServers": {
    "workermill": {
      "command": "node",
      "args": ["packages/workermill-mcp/dist/index.js"],
      "env": {
        "WORKERMILL_API_KEY": "${WORKERMILL_API_KEY}",
        "WORKERMILL_API_URL": "https://workermill.com"
      }
    }
  }
}
```

### Implementation Steps

1. **Create package structure** with MCP SDK dependency (`@modelcontextprotocol/sdk`)
2. **Implement task tools** that wrap existing API endpoints:
   - `GET /api/tasks` → `workermill_list_tasks`
   - `POST /api/tasks/:id/retry` → `workermill_retry_task`
   - `POST /api/tasks/:id/cancel` → `workermill_cancel_task`
3. **Implement orchestrator tools** wrapping `/api/orchestrator/*`
4. **Implement monitoring tools** wrapping `/api/control-center/*`
5. **Add to Claude Code configuration** in `.claude/settings.json`

### Key Files to Reference
- `api/src/routes/tasks.ts` - Task CRUD endpoints
- `api/src/routes/control-center.ts` - Dashboard endpoints
- `api/src/routes/orchestrator.ts` - Orchestrator control

---

## Phase 3: Worker MCP Integration (Optional - Lower Priority)

**Goal:** Replace some worker execution scripts with MCP tool calls.

### Candidates for MCP Replacement

| Script | Current | MCP Alternative | Recommendation |
|--------|---------|-----------------|----------------|
| `ticket/add_comment.ts` | Raw HTTP | `mcp__jira__jira_post` | **Replace** - simpler |
| `ticket/transition_issue.ts` | Raw HTTP | `mcp__jira__jira_post` | **Replace** - simpler |
| `git/create_pr.ts` | `gh` CLI | `mcp__github__create_pull_request` | **Keep** - gh handles edge cases |
| `git/commit_changes.ts` | git commands | N/A | **Keep** - no MCP equivalent |
| `deploy/*` | AWS SDK | N/A | **Keep** - infrastructure-specific |

### Implementation Challenges
1. Worker containers would need MCP server processes
2. Adds Docker image complexity
3. Claude Code CLI already provides tools - may be redundant

### Recommendation
Only pursue Phase 3 if:
- Workers migrate from Claude Code CLI to AI SDK
- Clear need for standardized tool interface emerges
- Testing shows measurable improvement

---

## Anti-Patterns to Avoid

| Anti-Pattern | Reason |
|--------------|--------|
| Replace log streaming | PostgreSQL + SSE works well (took a week to perfect) |
| Add MCP to orchestrator core | Atomic task claiming works reliably |
| Auto-trigger tasks via MCP | Must respect `workermill` label safety rule |
| Change model configs via MCP | Explicit user approval required per CLAUDE.md |

---

## Verification Plan

### Phase 1 (Existing MCPs)
- [ ] Create OCS ticket via `mcp__jira__jira_post`
- [ ] List PRs via `mcp__github__list_pull_requests`
- [ ] Check OnCallShift incidents via `mcp__oncallshift__list_incidents`

### Phase 2 (WorkerMill MCP Server)
- [ ] Run `npm run build` in `packages/workermill-mcp/`
- [ ] Add to `.claude/settings.json` mcpServers
- [ ] Restart Claude Code, verify tools appear
- [ ] Test `workermill_list_tasks` returns data
- [ ] Test `workermill_orchestrator_status` works

---

## Summary

| Phase | Effort | Impact | Timeline |
|-------|--------|--------|----------|
| Phase 1: Use existing MCPs | None | High | Immediate |
| Phase 2: WorkerMill MCP Server | 2-3 days | High | Week 1-2 |
| Phase 3: Worker MCP integration | 1-2 weeks | Medium | Defer |

**Recommendation:** Start with Phase 1 immediately (no changes needed), then implement Phase 2 for high-value platform management capabilities. Defer Phase 3 until clear need emerges.

---

## Appendix: Current Architecture Context

### How Workers Currently Integrate with External Services

| Service | Method | Authentication | Location |
|---------|--------|----------------|----------|
| Jira | REST API v3 | Basic Auth (email:token) | `api/src/utils/jira.ts` |
| GitHub | GitHub CLI + REST API | PAT (GITHUB_TOKEN) | `api/src/utils/github.ts` |
| WorkerMill API | REST (x-api-key header) | Org API Key | `worker/entrypoint.sh` |
| AWS | AWS CLI v2 + SDK | IAM Roles (ECS task) | Various |

### Worker Execution Flow
1. Jira webhook → API receives task
2. Orchestrator claims task atomically
3. ECS task spawned with environment variables
4. Worker runs Claude Code or Aider
5. Worker posts logs to `/api/tasks/:taskId/logs`
6. Dashboard streams logs via SSE (500ms polling)
7. Worker parses output markers (`::result::`, `::pr_url::`)
8. Task status updated, Jira transitioned

### Key Patterns (Do Not Change)
- **Log streaming**: PostgreSQL + SSE (NOT CloudWatch)
- **Task orchestration**: Database polling with atomic claims
- **Worker entrypoint**: Posts logs via `post_log()` function
