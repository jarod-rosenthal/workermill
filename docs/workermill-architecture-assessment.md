# WorkerMill Architecture Assessment

**Created:** 2026-02-04
**Status:** Draft - Pending Review
**Author:** Claude Code Analysis
**Scope:** AIClient abstraction, Coordination Feed, Blocker System, Token Refresh

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [AIClient Abstraction](#aiclient-abstraction)
3. [Deep Dive: Coordination Feed](#deep-dive-coordination-feed)
4. [Deep Dive: Blocker System](#deep-dive-blocker-system)
5. [Deep Dive: Token Refresh](#deep-dive-token-refresh)
6. [Consolidated Recommendations](#consolidated-recommendations)

---

## Executive Summary

This document provides a comprehensive architecture assessment of WorkerMill's execution infrastructure, covering:

1. **AIClient Abstraction** - The dual-backend system (Agent SDK vs AI SDK) and cleanup recommendations
2. **Coordination Feed** - Multi-worker communication system analysis and identified issues
3. **Blocker System** - Error classification, escalation, and retry mechanisms
4. **Token Refresh** - Critical gap in OAuth token lifecycle for long-running tasks

---

## AIClient Abstraction

This section outlines a prioritized plan to clean up the AIClient abstraction and local WorkerMill implementation. The goal is to **stop maintaining duplicate code** while preserving the ability to use any AI provider.

**The Core Rule:**
| Scenario | Backend | Auth | Why |
|----------|---------|------|-----|
| **Anthropic only** | Agent SDK | OAuth (Claude Max) | Free local dev, parallel execution |
| **Multi-provider or non-Anthropic** | AI SDK (Vercel) | API keys | Supports all providers |

**Key Insight:** The Agent SDK supports OAuth authentication (Claude Max subscription = free tokens). The AI SDK requires API keys (pay-per-token). This isn't just a technical difference - it's a **cost difference** that makes Agent SDK essential for rapid local development.

**The Goal:** Clean up the code so we're not duplicating logic, while maintaining both backends for their distinct purposes. This is NOT about collapsing to a single execution path.

---

## Current State Assessment

### SDK Versions (Current vs Latest)

| Package | Current | Latest | Status |
|---------|---------|--------|--------|
| `ai` (Vercel AI SDK) | ^6.0.0 | 6.0.69 | ✅ Current |
| `@ai-sdk/openai` | ^3.0.0 | 3.0.25 | ✅ Current |
| `@ai-sdk/anthropic` | ^3.0.0 | 3.0.36 | ✅ Current |
| `@ai-sdk/google` | ^3.0.0 | 3.0.6 | ✅ Current |
| `ollama-ai-provider` | ^1.2.0 | - | ⚠️ Deprecated |
| `@anthropic-ai/sdk` | ^0.72.1 | ~0.72.x | ✅ Current |
| Claude Code CLI | - | 2.1.12 | ✅ (external) |

**Action Required:** Replace `ollama-ai-provider` with `ollama-ai-provider-v2` or `ai-sdk-ollama@^3.0.0` for AI SDK 6 compatibility.

### Current Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    TWO EXECUTION BACKENDS                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Backend 1: Agent SDK (Anthropic Only)                          │
│  ┌──────────────────┐    ┌──────────────────┐                   │
│  │ Epic Coordinator │───▶│ runAgent()       │───▶ Claude        │
│  │ (coordinator.ts) │    │ (agent-sdk.ts)   │    processes      │
│  └──────────────────┘    └──────────────────┘                   │
│                                                                 │
│  Auth: ✅ OAuth (Claude Max - FREE)                             │
│  Tools: Read, Write, Edit, Bash, Glob, Grep (built-in)          │
│  Execution: Parallel workers                                    │
│  Use when: Anthropic is the only configured provider            │
│                                                                 │
│  Backend 2: AI SDK (Multi-Provider)                             │
│  ┌──────────────────┐    ┌──────────────────┐                   │
│  │ Multi-Expert     │───▶│ ai-sdk-executor  │───▶ Node          │
│  │ (index.ts)       │    │ .js              │    processes      │
│  └──────────────────┘    └──────────────────┘                   │
│                                                                 │
│  Auth: API keys (pay-per-token)                                 │
│  Tools: bash, read_file, write_file, edit_file, glob, grep      │
│  Execution: Sequential stories                                  │
│  Use when: Multiple providers OR non-Anthropic provider         │
│                                                                 │
│  Planning Agent (local mode carve-out - acceptable)             │
│  ┌──────────────────┐                                           │
│  │ planning-agent-  │───▶ Agent SDK (Anthropic)                 │
│  │ local.ts         │    OR AI SDK (other providers)            │
│  └──────────────────┘                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Why Two Backends?

**It's about authentication, not capability:**

| Backend | Auth Method | Cost | Best For |
|---------|-------------|------|----------|
| Agent SDK | OAuth (`claude auth login`) | **Free** with Claude Max | Local dev, Anthropic-only orgs |
| AI SDK | API keys | Pay per token | Multi-provider, production |

The AI SDK **cannot** use OAuth - it requires `ANTHROPIC_API_KEY`. This makes the Agent SDK essential for cost-free local development with Claude Max subscriptions.

---

## Strategic Direction: Clean Up, Don't Collapse

**We are NOT unifying to a single backend.** Both backends serve distinct purposes:

- **Agent SDK** = OAuth = free local dev = primary for Anthropic-only users
- **AI SDK** = API keys = multi-provider support = alternative path

### What "Unification" Means Here

1. **Stop duplicating logic** - Shared utilities for tokens, markers, tool names
2. **Clean abstractions** - AIClient interface that routes to the right backend
3. **Clear boundaries** - Agent SDK code doesn't leak into AI SDK code and vice versa
4. **Reduce maintenance burden** - One place to fix bugs, not two

### What We're NOT Doing

- ❌ Removing the Agent SDK path
- ❌ Making AI SDK the only option for Anthropic
- ❌ Requiring API keys for local development

### The Backend Selection Rule

```typescript
function selectBackend(config: OrgConfig): 'agent-sdk' | 'ai-sdk' {
  // If ONLY Anthropic is configured, use Agent SDK (supports OAuth)
  if (config.primaryProvider === 'anthropic' && !config.providerRouting) {
    return 'agent-sdk';
  }
  // Otherwise, use AI SDK (requires API keys, supports all providers)
  return 'ai-sdk';
}
```

This rule is already implemented - we're just cleaning up the code around it.

---

## Priority 1: Critical Issues (Do First)

### 1.1 Consolidate Token/Credential Management

**Problem:** OAuth token handling is scattered across 4 locations with different logic:

| Location | What It Does | Problem |
|----------|--------------|---------|
| `bin/local-workermill` | Reads from credentials.json | Shell script, can't refresh |
| `api/src/config/index.ts` | `syncOAuthTokenFromCredentials()` at module load | Race condition with API startup |
| `api/src/services/planning-agent-local.ts` | `ensureValidOAuthToken()` with refresh | Duplicates refresh logic |
| `worker/epic/agent-sdk.ts` | Checks `process.env.CLAUDE_CODE_OAUTH_TOKEN` | Passive consumer |

**Solution:** Create a single `TokenManager` class:

```typescript
// api/src/services/token-manager.ts

export class TokenManager {
  private static instance: TokenManager;
  private cachedToken: string | null = null;
  private expiresAt: number = 0;

  static getInstance(): TokenManager { ... }

  /**
   * Get a valid OAuth token, refreshing if needed.
   * Single source of truth for all token consumers.
   */
  async getOAuthToken(): Promise<string> {
    if (this.isTokenValid()) {
      return this.cachedToken!;
    }
    return this.refreshToken();
  }

  private isTokenValid(): boolean {
    return this.cachedToken !== null && Date.now() < this.expiresAt - 300000; // 5 min buffer
  }

  private async refreshToken(): Promise<string> {
    // Consolidated refresh logic from planning-agent-local.ts
    // Read from credentials file, call refresh endpoint, update cache
  }

  /**
   * For subprocess spawning - returns env vars to pass through.
   */
  getEnvForSubprocess(): Record<string, string> {
    return {
      CLAUDE_CODE_OAUTH_TOKEN: this.cachedToken || '',
    };
  }
}
```

**Files to Modify:**
- Create: `api/src/services/token-manager.ts`
- Update: `api/src/config/index.ts` - remove `syncOAuthTokenFromCredentials()`
- Update: `api/src/services/planning-agent-local.ts` - use TokenManager
- Update: `worker/epic/agent-sdk.ts` - use TokenManager (or accept token in config)
- Update: `bin/local-workermill` - remove token reading, rely on API

**Estimated Effort:** Medium
**Risk:** Low - isolated change with clear boundaries

---

### 1.2 Remove Magic Sentinel Value

**Problem:** `getProviderCredentials()` returns `"LOCAL_OAUTH_MODE"` for Anthropic in local mode. This string propagates through the system and is checked in multiple places.

```typescript
// Current (bad)
if (process.env.EXECUTION_MODE === "local") {
  if (providerId === "anthropic" && process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return "LOCAL_OAUTH_MODE";  // Magic string!
  }
}
```

**Solution:** Return a typed credential object instead:

```typescript
// api/src/config/index.ts

export type ProviderCredential =
  | { type: 'api_key'; key: string }
  | { type: 'oauth'; token: string }
  | { type: 'none' };  // For Ollama

export async function getProviderCredentials(
  orgId: string,
  providerId: ProviderId
): Promise<ProviderCredential> {
  if (process.env.EXECUTION_MODE === "local" && providerId === "anthropic") {
    const token = await TokenManager.getInstance().getOAuthToken();
    return { type: 'oauth', token };
  }
  // ... existing logic returns { type: 'api_key', key: ... }
}
```

**Estimated Effort:** Small
**Risk:** Low - straightforward type change

---

### 1.3 Unify Tool Name Conventions

**Problem:** Tool names differ between Claude CLI and AI SDK:

| Claude CLI | AI SDK | Purpose |
|------------|--------|---------|
| `Read` | `read_file` | Read file contents |
| `Write` | `write_file` | Write file |
| `Edit` | `edit_file` | Edit file |
| `Bash` | `bash` | Execute command |
| `Glob` | `glob` | Find files |
| `Grep` | `grep` | Search contents |

**Solution:** Define canonical tool names and map at boundaries:

```typescript
// worker/ai-clients/tools.ts

export const CANONICAL_TOOLS = ['read', 'write', 'edit', 'bash', 'glob', 'grep'] as const;
export type CanonicalTool = typeof CANONICAL_TOOLS[number];

export const TOOL_MAPPINGS = {
  claudeCli: {
    read: 'Read',
    write: 'Write',
    edit: 'Edit',
    bash: 'Bash',
    glob: 'Glob',
    grep: 'Grep',
  },
  aiSdk: {
    read: 'read_file',
    write: 'write_file',
    edit: 'edit_file',
    bash: 'bash',
    glob: 'glob',
    grep: 'grep',
  },
} as const;

export function mapToolsForProvider(
  tools: CanonicalTool[],
  provider: 'claudeCli' | 'aiSdk'
): string[] {
  return tools.map(t => TOOL_MAPPINGS[provider][t]);
}
```

**Estimated Effort:** Small
**Risk:** Low - additive change

---

## Priority 2: Architectural Improvements (Do Second)

### 2.1 Planning Agent (Local Mode Carve-Out)

**Status:** The planning agent in local mode is allowed to work differently. It doesn't need to go through the AIClient abstraction.

**Current behavior:**
- Local mode + Anthropic → Spawns Claude CLI directly (uses OAuth)
- Local mode + Other providers → Uses AI SDK (uses API keys)

**This is acceptable** because:
1. Planning is a one-time operation per task (not the hot path)
2. It already supports the TokenManager pattern via `ensureValidOAuthToken()`
3. Refactoring it provides minimal benefit vs. risk

**Optional improvement:** If we want consistency, planning could use the shared `spawnClaudeCli()` helper (see 2.2) instead of its own spawning logic. But this is low priority.

---

### 2.2 Clean AIClient Boundaries

**Problem:** `AnthropicAgentClient` imports Epic-specific types (`EpicConfig`, `ExpertConfig`), creating tight coupling.

**Goal:** The AIClient abstraction should:
1. Route to Agent SDK for Anthropic-only configs
2. Route to AI SDK for multi-provider configs
3. Not leak Epic concepts into the interface

**Solution:** Keep the routing simple, fix the type leakage:

```typescript
// worker/ai-clients/index.ts

export function createAIClient(config: AIClientConfig): AIClient {
  const { provider, useAgentSdk } = config;

  // Anthropic with Agent SDK = use OAuth-capable path
  if (provider === "anthropic" && useAgentSdk !== false) {
    return new AnthropicAgentClient(config);
  }

  // Everything else = use AI SDK (requires API keys)
  return new AISdkClient(config);
}
```

**The key insight:** The `useAgentSdk` flag (or detecting "Anthropic only" from org config) is the routing decision. The AIClient interface itself is simple - it's just `execute(options) => Promise<result>`.

**What to fix:**
- `AnthropicAgentClient` should not import `EpicConfig` - pass what it needs via `AIClientConfig`
- Shared types (`StreamMessage`, `TokenUsage`, `OutputMarkers`) should live in `worker/ai-clients/types.ts`
- Epic-specific types stay in `worker/epic/types.ts`

**Estimated Effort:** Medium
**Risk:** Low - mostly moving types around, not changing behavior

---

### 2.3 Consolidate Marker Extraction

**Problem:** Both `anthropic-agent.ts` and `ai-sdk-client.ts` have separate `extractMarkers()` implementations with subtle differences.

**Solution:** Single shared implementation:

```typescript
// worker/ai-clients/markers.ts

export interface OutputMarkers {
  result?: string;
  prUrl?: string;
  prNumber?: string;
  branch?: string;
  reviewDecision?: 'approved' | 'revision_needed' | 'rejected';
  codeQualityScore?: number;
  feedback?: string;
}

const MARKER_PATTERNS = {
  result: /::result::(\w+)/,
  prUrl: /::pr_url::(https?:\/\/[^\s\n]+)/,
  prNumber: /::pr_number::(\d+)/,
  branch: /::branch::([^\s\n]+)/,
  reviewDecision: /::review_decision::(approved|revision_needed|rejected)/,
  codeQualityScore: /::code_quality_score::(\d+)/,
  feedback: /::feedback::([^\n]+)/,
} as const;

export function extractMarkers(text: string): OutputMarkers {
  const markers: OutputMarkers = {};

  for (const [key, pattern] of Object.entries(MARKER_PATTERNS)) {
    const match = text.match(pattern);
    if (match) {
      if (key === 'codeQualityScore') {
        markers[key] = parseInt(match[1], 10);
      } else if (key === 'reviewDecision') {
        markers[key] = match[1] as OutputMarkers['reviewDecision'];
      } else {
        markers[key as keyof OutputMarkers] = match[1];
      }
    }
  }

  return markers;
}
```

**Estimated Effort:** Small
**Risk:** Low - straightforward extraction

---

## Priority 3: SDK Updates (Do Third)

### 3.1 Update Ollama Provider

**Problem:** Using deprecated `ollama-ai-provider@^1.2.0`.

**Solution:** Migrate to `ollama-ai-provider-v2` or `ai-sdk-ollama@^3.0.0`:

```bash
# In api/
npm uninstall ollama-ai-provider
npm install ollama-ai-provider-v2

# Or for advanced features (tool calling):
npm install ai-sdk-ollama@^3.0.0
```

**Code changes:**

```typescript
// Before
import { createOllama } from "ollama-ai-provider";

// After (ollama-ai-provider-v2)
import { createOllama } from "ollama-ai-provider-v2";

// Or (ai-sdk-ollama for tool support)
import { createOllama } from "ai-sdk-ollama";
```

**Estimated Effort:** Small
**Risk:** Low - drop-in replacement

---

### 3.2 Leverage AI SDK 6 Features

**Current codebase is already on AI SDK 6, but not using new features:**

1. **Use `output` parameter instead of manual parsing:**

```typescript
// Current (manual JSON parsing)
const result = await generateText({ model, prompt });
const plan = parseExecutionPlan(result.text);

// Better (structured output)
import { z } from 'zod';

const ExecutionPlanSchema = z.object({
  summary: z.string(),
  stories: z.array(z.object({
    id: z.string(),
    title: z.string(),
    // ...
  })),
  risks: z.array(z.string()),
  assumptions: z.array(z.string()),
});

const result = await generateText({
  model,
  prompt,
  output: {
    schema: ExecutionPlanSchema,
  },
});
const plan = result.output;  // Already typed!
```

2. **Use `onFinish` for token tracking:**

```typescript
const result = await generateText({
  model,
  prompt,
  onFinish: ({ usage, totalUsage }) => {
    logger.info('Token usage', {
      promptTokens: totalUsage.promptTokens,
      completionTokens: totalUsage.completionTokens,
    });
  },
});
```

3. **Use `stopWhen` for tool loops:**

```typescript
import { stopWhen, stepCountIs } from 'ai';

const result = await generateText({
  model,
  prompt,
  tools: { ... },
  stopWhen: stepCountIs(10),  // Max 10 tool iterations
});
```

**Estimated Effort:** Medium
**Risk:** Low - additive improvements

---

## Priority 4: Documentation & Observability (Ongoing)

### 4.1 Document Configuration Flow

Add to CLAUDE.md:

```markdown
### Configuration Flow (Local Mode)

```
┌──────────────────────────────────────────────────────────────────┐
│                     CONFIGURATION FLOW                           │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ~/.claude/.credentials.json                                     │
│         │                                                        │
│         ▼                                                        │
│  TokenManager.getInstance()                                      │
│         │                                                        │
│         ├───▶ Planning Agent (via AIClient)                      │
│         │                                                        │
│         ├───▶ Epic Coordinator (via subprocess env)              │
│         │                                                        │
│         └───▶ Worker Container (via CLAUDE_CODE_OAUTH_TOKEN)     │
│                                                                  │
│  .env.local                                                      │
│         │                                                        │
│         ▼                                                        │
│  api/src/config/index.ts                                         │
│         │                                                        │
│         ├───▶ EXECUTION_MODE=local                               │
│         ├───▶ DATABASE_URL                                       │
│         └───▶ TARGET_REPO_PATH                                   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```
```

### 4.2 Add Telemetry Integration

For production observability, integrate with Datadog or similar:

```typescript
// api/src/services/telemetry.ts

export function trackAIExecution(params: {
  taskId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  success: boolean;
}) {
  // Send to Datadog/Grafana/etc
}
```

---

## Implementation Order

| Phase | Items | Effort | Dependencies |
|-------|-------|--------|--------------|
| **Phase 1** | 1.1 TokenManager, 1.2 Remove sentinel | 1-2 days | None |
| **Phase 2** | 1.3 Tool name mapping, 2.3 Shared markers | 1 day | None |
| **Phase 3** | 2.2 Clean AIClient boundaries | 2-3 days | Phase 1, 2 |
| **Phase 4** | 3.1 Ollama provider update | 0.5 day | None |
| **Phase 5** | 4.1 Documentation | Ongoing | Any |

**Note:** Planning agent local mode is a carve-out - it doesn't need to go through AIClient.

---

## Risk Assessment

| Change | Risk | Mitigation |
|--------|------|------------|
| TokenManager refactor | Token refresh regression | Extensive testing with expired tokens |
| Removing sentinel value | Code that checks for `"LOCAL_OAUTH_MODE"` breaks | Search for all usages first |
| Shared marker extraction | Subtle regex differences cause bugs | Unit test both old implementations, ensure new one passes both |
| Ollama provider update | API incompatibility | Test with local Ollama before deploy |
| AIClient boundary cleanup | Break Epic workflow | Incremental changes, keep old code working until new code is tested |

---

## Success Criteria

1. **Single token management path** - All OAuth operations go through TokenManager
2. **No magic strings** - Credential types are explicit unions, no `"LOCAL_OAUTH_MODE"`
3. **Unified tool names** - Single canonical list with provider-specific mappings
4. **Clean AIClient abstraction** - Routes to Agent SDK or AI SDK based on config
5. **Shared marker extraction** - Single implementation used by both backends
6. **No duplicated spawning logic** - Planning agent reuses Agent SDK code
7. **Up-to-date dependencies** - No deprecated packages (fix Ollama provider)
8. **Clear backend boundaries** - Agent SDK and AI SDK code don't leak into each other

---

## Appendix: SDK Research Summary

### Agent SDK / Claude Code (v2.1.12)

- **Authentication:** API key (`ANTHROPIC_API_KEY`) **OR** OAuth (`claude auth login`)
- **OAuth benefit:** Free tokens with Claude Max subscription - essential for local dev
- **Spawning:** Python subprocess more reliable than Node.js (known issue #771)
- **Streaming:** `--output-format stream-json` for line-delimited JSON events
- **Token tracking:** Extract from `usage` field in stream events; cumulative (use `Math.max`)
- **When to use:** Anthropic-only configurations, local development

### Vercel AI SDK (v6.0.69)

- **Authentication:** API keys only - **NO OAuth support**
- **Cost:** Pay-per-token for all providers
- **Breaking changes from v5:** `generateObject` deprecated (use `output` param), `CoreMessage` removed
- **Token tracking:** `result.usage` / `result.totalUsage` for final counts; `onFinish` callback
- **Tool calling:** Use `tool()` helper with Zod schemas; `strict: true` for validation
- **Ollama:** Use `ollama-ai-provider-v2` or `ai-sdk-ollama@^3.0.0`
- **When to use:** Multi-provider configurations, non-Anthropic providers

---

## Next Steps

### Recommended Implementation Order

| Phase | Items | Effort | Impact |
|-------|-------|--------|--------|
| **Phase 1** | TokenManager, remove `"LOCAL_OAUTH_MODE"` sentinel | 1-2 days | Cleaner auth flow |
| **Phase 2** | Shared marker extraction, tool name mapping | 1 day | Less duplication |
| **Phase 3** | Clean up AIClient abstraction boundaries | 2-3 days | Maintainability |
| **Phase 4** | Update Ollama provider | 0.5 day | Fix deprecated package |
| **Phase 5** | Documentation | Ongoing | Onboarding |

### Quick Wins (Do Anytime)

- **Update Ollama provider** - Replace deprecated `ollama-ai-provider` with `ollama-ai-provider-v2`
- **Document the backend selection rule** - Add to CLAUDE.md so it's clear when each path is used

### Notes

- **Local mode planning is a carve-out** - It's okay for it to work differently
- **Don't over-engineer the AIClient** - It just needs to route to the right backend
- **Agent SDK is primary for Anthropic** - Don't invest in making AI SDK work with OAuth

---

## Deep Dive: Coordination Feed

The coordination feed is a PostgreSQL-backed message queue that enables communication between parallel expert workers, the coordinator, and the user dashboard.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         COORDINATION FEED SYSTEM                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐    ┌─────────────────────┐    ┌─────────────────────────┐  │
│  │   Expert    │───▶│ CoordinationClient  │───▶│ API: POST /coordination │  │
│  │   Worker    │    │  (coordination-     │    │      /feed/:taskId      │  │
│  │             │◀───│   client.ts)        │◀───│                         │  │
│  └─────────────┘    └─────────────────────┘    └────────────┬────────────┘  │
│                                                              │               │
│  ┌─────────────┐    ┌─────────────────────┐    ┌────────────▼────────────┐  │
│  │ Coordinator │───▶│ Request Coalescing  │───▶│   PostgreSQL Table:     │  │
│  │             │    │ (pending requests   │    │   coordination_feed     │  │
│  │             │◀───│  batched 100ms)     │◀───│     items               │  │
│  └─────────────┘    └─────────────────────┘    └────────────┬────────────┘  │
│                                                              │               │
│  ┌─────────────┐                               ┌────────────▼────────────┐  │
│  │  Dashboard  │◀──────────────────────────────│ SSE: GET /coordination  │  │
│  │    (UI)     │                               │     /stream/:taskId     │  │
│  └─────────────┘                               └─────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `CoordinationClient` | `worker/epic/coordination-client.ts` | Worker-side API wrapper with request coalescing |
| `CoordinationFeedItem` | `api/src/models/CoordinationFeedItem.ts` | TypeORM entity for feed messages |
| `/coordination/feed` routes | `api/src/routes/coordination.ts` | API endpoints for feed CRUD and streaming |
| `CoordinationFeed` component | `frontend/src/components/CoordinationFeed.tsx` | Dashboard UI for viewing feed |

### Message Types

```typescript
type FeedItemType =
  | 'plan_generated'      // Planning agent completed, stories ready
  | 'expert_assigned'     // Expert claimed a story
  | 'expert_progress'     // Progress update from expert
  | 'expert_completed'    // Story completed successfully
  | 'expert_failed'       // Story failed, needs retry/skip
  | 'blocker_escalated'   // Error escalated for human intervention
  | 'blocker_resolved'    // User resolved a blocker
  | 'user_message'        // User sent feedback/instruction
  | 'worker_ack'          // Worker acknowledged user message
  | 'coordination_request'// Expert requesting help from another
  | 'coordination_response'// Expert responding to request
```

### Request Coalescing (Performance Optimization)

The `CoordinationClient` implements request coalescing to reduce API calls:

```typescript
// worker/epic/coordination-client.ts

private pendingRequests: Map<string, PendingRequest> = new Map();
private flushInterval = 100; // ms

async postMessage(type: string, content: string, metadata?: object): Promise<void> {
  const key = `${type}:${content.slice(0, 50)}`;

  // If same message pending, skip duplicate
  if (this.pendingRequests.has(key)) {
    return;
  }

  this.pendingRequests.set(key, { type, content, metadata, timestamp: Date.now() });

  // Flush after 100ms
  if (!this.flushTimer) {
    this.flushTimer = setTimeout(() => this.flushPendingRequests(), this.flushInterval);
  }
}
```

**Benefit:** Reduces redundant updates when experts make rapid progress
**Risk:** Messages can be lost if worker crashes before flush

### Identified Issues

#### Issue 1: Cache Staleness in Coordinator

**Location:** `worker/epic/coordinator.ts` lines 180-220

**Problem:** The coordinator caches the execution plan and story states in memory. If the API updates state (e.g., user marks story as "skip"), the coordinator doesn't see it until it polls.

```typescript
// Current: Coordinator polls every 5 seconds
const pollInterval = setInterval(async () => {
  const feed = await this.client.getFeed();
  this.processNewItems(feed);
}, 5000);
```

**Impact:** Up to 5-second delay in responding to user actions (skip, abort, message)

**Recommendation:**
1. Reduce poll interval to 1 second for active tasks
2. Or implement push notification via WebSocket for critical events
3. Add `lastModified` timestamp comparison to detect changes faster

#### Issue 2: Pending Message Loss on Crash

**Location:** `worker/epic/coordination-client.ts` line 45-70

**Problem:** Request coalescing buffers messages in memory. If the worker crashes before flushing, messages are lost.

```typescript
// Messages buffered in memory, lost on crash
private pendingRequests: Map<string, PendingRequest> = new Map();
```

**Impact:** Progress updates and expert completions can be lost, leaving dashboard stale

**Recommendation:**
1. Flush immediately for critical message types (`expert_completed`, `blocker_escalated`)
2. Add graceful shutdown handler to flush pending requests
3. Consider write-ahead logging for critical messages

#### Issue 3: Race Condition in Story Claiming

**Location:** `api/src/routes/coordination.ts` POST `/claim-story`

**Problem:** Multiple experts can claim the same story in a brief window before the database UPDATE completes.

```typescript
// Current: SELECT then UPDATE (race window)
const story = await feedItemRepo.findOne({ where: { storyId, status: 'pending' } });
if (story) {
  story.status = 'in_progress';
  story.assignedExpert = expertId;
  await feedItemRepo.save(story);
}
```

**Impact:** Duplicate work if two experts claim simultaneously

**Recommendation:** Use atomic UPDATE with WHERE clause:

```typescript
const result = await feedItemRepo.createQueryBuilder()
  .update(CoordinationFeedItem)
  .set({ status: 'in_progress', assignedExpert: expertId })
  .where('storyId = :storyId AND status = :status', { storyId, status: 'pending' })
  .execute();

if (result.affected === 0) {
  throw new ConflictError('Story already claimed');
}
```

#### Issue 4: No Message Ordering Guarantee

**Problem:** Feed items are fetched by `createdAt` DESC, but concurrent inserts can have identical timestamps.

**Impact:** Dashboard may show messages in wrong order

**Recommendation:** Add auto-incrementing sequence number alongside timestamp:

```sql
ALTER TABLE coordination_feed_item ADD COLUMN seq SERIAL;
CREATE INDEX idx_feed_task_seq ON coordination_feed_item(task_id, seq);
```

---

## Deep Dive: Blocker System

The blocker system handles errors that workers cannot auto-resolve, escalating them to the dashboard for human intervention.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BLOCKER SYSTEM FLOW                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Expert Execution ──▶ Error Occurs ──▶ Error Classifier                     │
│                                              │                              │
│                                              ▼                              │
│                    ┌─────────────────────────────────────────────────┐      │
│                    │              ERROR CATEGORIES                    │      │
│                    ├─────────────────────────────────────────────────┤      │
│                    │ typescript  │ TypeScript compilation errors      │      │
│                    │ lint        │ ESLint/Prettier violations         │      │
│                    │ test        │ Test failures (unit, integration)  │      │
│                    │ build       │ Build/bundle failures              │      │
│                    │ auth        │ Authentication/authorization       │      │
│                    │ network     │ API calls, timeouts, DNS           │      │
│                    │ resource    │ Disk space, memory, file access    │      │
│                    │ unknown     │ Unclassified errors                │      │
│                    └─────────────────────────────────────────────────┘      │
│                                              │                              │
│                                              ▼                              │
│                         Is error fixable? (pattern match)                   │
│                              │                  │                           │
│                              ▼                  ▼                           │
│                           YES                  NO                           │
│                              │                  │                           │
│                              ▼                  ▼                           │
│                     Auto-retry (max 3)    Escalate blocker                  │
│                              │                  │                           │
│                              ▼                  ▼                           │
│                     Still failing?        Dashboard shows                   │
│                              │             BlockerAlert                     │
│                              ▼                  │                           │
│                     Escalate blocker      User action:                      │
│                                           Retry/Skip/Abort                  │
│                                                 │                           │
│                                                 ▼                           │
│                                      Resolution → Coordinator               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `BlockerManager` | `worker/epic/blocker-manager.ts` | Blocker detection, escalation, resolution |
| `ErrorClassifier` | `worker/epic/error-classifier.ts` | Categorize errors, generate summaries |
| `BlockerAlert` | `frontend/src/components/BlockerAlert.tsx` | UI for blocker display and actions |
| `/blocker-response` | `api/src/routes/coordination.ts` | Endpoint for user blocker resolutions |

### Error Classification

```typescript
// worker/epic/error-classifier.ts

export interface ClassifiedError {
  category: ErrorCategory;
  isFixable: boolean;
  summary: string;
  affectedFiles: string[];
  suggestedAction: string;
  rawError: string;
}

const ERROR_PATTERNS: Record<ErrorCategory, RegExp[]> = {
  typescript: [
    /error TS\d+:/,
    /Cannot find module/,
    /Type '.*' is not assignable to type/,
    /Property '.*' does not exist on type/,
  ],
  lint: [
    /eslint.*error/i,
    /prettier.*error/i,
    /\d+ problems? \(\d+ errors?/,
  ],
  test: [
    /FAIL\s+.*\.test\./,
    /✕.*\d+ms/,
    /AssertionError/,
    /Expected.*to equal/,
  ],
  // ... more patterns
};

export function classifyError(output: string): ClassifiedError {
  for (const [category, patterns] of Object.entries(ERROR_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(output)) {
        return {
          category: category as ErrorCategory,
          isFixable: FIXABLE_CATEGORIES.includes(category),
          summary: generateSummary(category, output),
          affectedFiles: extractAffectedFiles(output),
          suggestedAction: getSuggestedAction(category),
          rawError: output.slice(0, 5000), // Truncate for API
        };
      }
    }
  }
  return { category: 'unknown', isFixable: false, /* ... */ };
}
```

### Auto-Retry Logic

```typescript
// worker/epic/blocker-manager.ts

const FIXABLE_CATEGORIES = ['typescript', 'lint', 'test'];
const MAX_AUTO_RETRIES = 3;

async function handleError(
  storyId: string,
  error: ClassifiedError,
  retryCount: number
): Promise<'retry' | 'escalate'> {
  // Check if error is fixable and retries remain
  if (error.isFixable && retryCount < MAX_AUTO_RETRIES) {
    await this.coordinationClient.postMessage('expert_progress',
      `Auto-retrying ${error.category} error (attempt ${retryCount + 1}/${MAX_AUTO_RETRIES})`
    );
    return 'retry';
  }

  // Escalate to user
  await this.escalateBlocker(storyId, error);
  return 'escalate';
}
```

### Dependent Story Blocking

When a story fails and is escalated, dependent stories are automatically blocked:

```typescript
// worker/epic/coordinator.ts

function blockDependentStories(failedStoryId: string): void {
  const dependents = this.executionPlan.stories.filter(
    s => s.dependencies?.includes(failedStoryId)
  );

  for (const dependent of dependents) {
    dependent.status = 'blocked';
    dependent.blockedBy = failedStoryId;
    this.coordinationClient.postMessage('story_blocked',
      `Story ${dependent.id} blocked: waiting on ${failedStoryId}`
    );
  }
}
```

### Identified Issues

#### Issue 1: Pattern Matching Gaps

**Location:** `worker/epic/error-classifier.ts` lines 20-80

**Problem:** Error patterns are incomplete, causing many errors to fall into "unknown" category.

**Examples of missed patterns:**
```
// Not caught: Docker build errors
COPY failed: file not found in build context

// Not caught: Git errors
fatal: Not a git repository

// Not caught: Permission errors
EACCES: permission denied, open '/root/.npm'

// Not caught: Memory errors
FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory
```

**Impact:** Errors that could be auto-retried are escalated unnecessarily

**Recommendation:** Expand pattern list and add catch-all heuristics:

```typescript
// Additional patterns to add
const ADDITIONAL_PATTERNS = {
  docker: [/COPY failed/, /docker build.*failed/i, /manifest unknown/],
  git: [/fatal:.*git/, /error: failed to push/, /merge conflict/i],
  permission: [/EACCES/, /permission denied/i, /EPERM/],
  memory: [/heap out of memory/i, /ENOMEM/, /OOMKilled/],
};
```

#### Issue 2: Retry Guidance Not Reaching Agent

**Location:** `worker/epic/executor.ts` lines 300-350

**Problem:** When user selects "Retry with guidance", the guidance text is stored in the database but never passed to the agent's system prompt on retry.

```typescript
// Current: Retry just re-runs the story
async retryStory(storyId: string, resolution: BlockerResolution): Promise<void> {
  const story = this.getStory(storyId);
  story.status = 'pending';
  story.retryCount++;
  // BUG: resolution.guidance is never used!
  await this.executeStory(story);
}
```

**Impact:** User provides guidance but agent doesn't see it, defeating the purpose

**Recommendation:** Inject guidance into expert system prompt:

```typescript
async retryStory(storyId: string, resolution: BlockerResolution): Promise<void> {
  const story = this.getStory(storyId);
  story.status = 'pending';
  story.retryCount++;

  // Inject guidance into context
  if (resolution.guidance) {
    story.additionalContext = [
      ...(story.additionalContext || []),
      `USER GUIDANCE FOR RETRY: ${resolution.guidance}`,
      `Previous error: ${resolution.originalError}`,
    ];
  }

  await this.executeStory(story);
}
```

#### Issue 3: Blocker Timeout Not Configurable

**Location:** `worker/epic/blocker-manager.ts` line 45

**Problem:** Blocker wait timeout is hardcoded to 30 minutes. Long-running tasks may need longer, quick tasks may want shorter.

```typescript
// Current: Hardcoded timeout
const BLOCKER_WAIT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
```

**Impact:**
- Tasks timeout waiting for user response overnight
- Quick iterations wait too long before auto-skipping

**Recommendation:** Make configurable per-task or per-org:

```typescript
interface TaskConfig {
  blockerTimeoutMs?: number;  // Default: 30 minutes
  autoSkipBlockers?: boolean; // Default: false (escalate all)
  maxAutoRetries?: number;    // Default: 3
}
```

#### Issue 4: No Blocker Notification

**Problem:** When a blocker is escalated, the user must be watching the dashboard to see it. No email/Slack notification.

**Impact:** Blockers can sit unresolved for hours until user checks dashboard

**Recommendation:** Add notification integration:

```typescript
// api/src/services/notification-service.ts

async function notifyBlocker(taskId: string, blocker: Blocker): Promise<void> {
  const task = await taskRepo.findOne(taskId, { relations: ['organization'] });
  const org = task.organization;

  // Email notification
  if (org.settings.emailOnBlocker) {
    await emailService.send({
      to: task.createdBy.email,
      template: 'blocker-escalated',
      data: { taskId, blocker },
    });
  }

  // Slack notification
  if (org.settings.slackWebhook) {
    await slackService.postBlockerAlert(org.settings.slackWebhook, task, blocker);
  }
}
```

---

## Deep Dive: Token Refresh

### Critical Finding: No Mid-Task Token Refresh

**Severity: HIGH** - Long-running tasks (>8 hours) will fail due to expired OAuth tokens.

### Current Token Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          TOKEN LIFECYCLE (CURRENT)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Task Created                                                               │
│       │                                                                     │
│       ▼                                                                     │
│  ensureValidOAuthToken()  ◀─── ONLY TOKEN VALIDATION POINT                  │
│  (planning-agent-local.ts:89-130)                                           │
│       │                                                                     │
│       ├── Check token expiry (8 hour lifetime)                              │
│       ├── If expired: call `claude auth refresh`                            │
│       └── Store in process.env.CLAUDE_CODE_OAUTH_TOKEN                      │
│       │                                                                     │
│       ▼                                                                     │
│  Spawn Coordinator                                                          │
│       │                                                                     │
│       ├── Token passed via environment variable                             │
│       └── ❌ NEVER REFRESHED after this point                               │
│       │                                                                     │
│       ▼                                                                     │
│  Coordinator spawns Experts                                                 │
│       │                                                                     │
│       ├── Each expert gets same token from env                              │
│       └── ❌ Token inherited, never updated                                 │
│       │                                                                     │
│       ▼                                                                     │
│  [8+ hours later]                                                           │
│       │                                                                     │
│       └── 💥 TOKEN EXPIRED → API calls fail → Task fails                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Evidence from Code

**1. Token validated only at task start:**

```typescript
// api/src/services/planning-agent-local.ts:89-130

async function ensureValidOAuthToken(): Promise<string> {
  const credPath = path.join(os.homedir(), '.claude', 'credentials.json');
  const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));

  // Check expiry
  if (creds.expiresAt && Date.now() > creds.expiresAt - 300000) {
    // Refresh token
    await execAsync('claude auth refresh');
    // Re-read credentials
    const newCreds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
    return newCreds.accessToken;
  }

  return creds.accessToken;
}

// Called ONCE here, at task creation:
export async function startPlanningAgent(taskId: string): Promise<void> {
  const token = await ensureValidOAuthToken();  // ◀─── ONLY CALL
  process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
  // ... spawn coordinator
}
```

**2. Token passed to subprocess via environment:**

```typescript
// worker/epic/agent-sdk.ts:204

export function spawnClaudeProcess(config: SpawnConfig): ChildProcess {
  return spawn('claude', args, {
    cwd: config.workingDir,
    env: {
      ...process.env,  // ◀─── Token inherited from parent env
      ANTHROPIC_API_KEY: config.apiKey,
    },
  });
}
```

**3. No refresh mechanism in coordinator:**

```typescript
// worker/epic/coordinator.ts - NO token refresh logic exists

export class EpicCoordinator {
  private token: string;  // Set once, never updated

  constructor(config: CoordinatorConfig) {
    this.token = process.env.CLAUDE_CODE_OAUTH_TOKEN!;  // Snapshot at construction
  }

  // No method to refresh token during execution
}
```

### Impact Analysis

| Task Duration | Risk Level | Likelihood of Failure |
|---------------|------------|----------------------|
| < 2 hours | Low | Token usually valid |
| 2-6 hours | Medium | May hit refresh window |
| 6-8 hours | High | Likely to fail near end |
| > 8 hours | Critical | Guaranteed failure |

**OAuth Token Lifetime:** 8 hours (Claude Max subscription)

### Recommended Solutions

#### Option 1: Periodic Token Refresh (Recommended)

Add a token refresh service that runs periodically during task execution.

```typescript
// api/src/services/token-refresh-service.ts

export class TokenRefreshService {
  private refreshInterval = 60 * 60 * 1000; // 1 hour
  private refreshTimer: NodeJS.Timer | null = null;
  private currentToken: string;

  async startForTask(taskId: string): Promise<void> {
    // Initial validation
    this.currentToken = await this.ensureValidToken();

    // Periodic refresh
    this.refreshTimer = setInterval(async () => {
      try {
        const newToken = await this.refreshToken();
        this.currentToken = newToken;

        // Notify running workers of new token
        await this.broadcastTokenUpdate(taskId, newToken);
      } catch (error) {
        logger.error('Token refresh failed', { taskId, error });
        // Task will fail on next API call with old token
      }
    }, this.refreshInterval);
  }

  async stopForTask(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private async broadcastTokenUpdate(taskId: string, token: string): Promise<void> {
    // Option A: Update coordination feed with new token
    await coordinationService.postSystemMessage(taskId, {
      type: 'token_refresh',
      token,
    });

    // Option B: Store in Redis/database, workers poll
    await redis.set(`task:${taskId}:oauth_token`, token, 'EX', 3600);
  }
}
```

#### Option 2: Worker Token Polling

Workers periodically check for updated tokens.

```typescript
// worker/epic/coordinator.ts (addition)

export class EpicCoordinator {
  private tokenRefreshInterval = 30 * 60 * 1000; // 30 minutes

  async start(): Promise<void> {
    // Start token polling
    setInterval(async () => {
      const latestToken = await this.fetchLatestToken();
      if (latestToken !== this.token) {
        this.token = latestToken;
        process.env.CLAUDE_CODE_OAUTH_TOKEN = latestToken;
        logger.info('Token updated mid-task');
      }
    }, this.tokenRefreshInterval);

    // ... existing start logic
  }

  private async fetchLatestToken(): Promise<string> {
    // Poll API for latest token
    const response = await fetch(`${this.apiBaseUrl}/api/tasks/${this.taskId}/token`);
    return response.json().token;
  }
}
```

#### Option 3: Proactive Token Refresh Before Expiry

Refresh token before it expires based on `expiresAt` timestamp.

```typescript
// api/src/services/planning-agent-local.ts (enhanced)

function scheduleTokenRefresh(expiresAt: number): void {
  const refreshTime = expiresAt - (30 * 60 * 1000); // 30 min before expiry
  const delay = refreshTime - Date.now();

  if (delay > 0) {
    setTimeout(async () => {
      const newToken = await refreshOAuthToken();
      // Broadcast to workers
    }, delay);
  }
}
```

### Implementation Priority

| Solution | Effort | Coverage | Recommendation |
|----------|--------|----------|----------------|
| Option 1: Periodic Refresh | Medium | Complete | ✅ Recommended |
| Option 2: Worker Polling | Medium | Complete | Alternative |
| Option 3: Proactive Refresh | Low | Partial | Quick win |

**Minimum Viable Fix:** Implement Option 3 (proactive refresh) as a quick win, then implement Option 1 for full coverage.

---

## Consolidated Recommendations

### Critical (Do First)

| # | Issue | Location | Effort | Impact |
|---|-------|----------|--------|--------|
| 1 | **Token refresh for long-running tasks** | `planning-agent-local.ts`, `coordinator.ts` | Medium | Tasks >8hr will fail |
| 2 | **Race condition in story claiming** | `coordination.ts` | Small | Duplicate work |
| 3 | **Retry guidance not reaching agent** | `executor.ts` | Small | User guidance ignored |

### High Priority

| # | Issue | Location | Effort | Impact |
|---|-------|----------|--------|--------|
| 4 | Token/credential management consolidation | Multiple files | Medium | Cleaner auth flow |
| 5 | Remove `"LOCAL_OAUTH_MODE"` sentinel | `config/index.ts` | Small | Type safety |
| 6 | Expand error classification patterns | `error-classifier.ts` | Medium | Better auto-retry |
| 7 | Blocker notification (email/Slack) | New service | Medium | Faster resolution |

### Medium Priority

| # | Issue | Location | Effort | Impact |
|---|-------|----------|--------|--------|
| 8 | Pending message loss on crash | `coordination-client.ts` | Small | Data integrity |
| 9 | Cache staleness in coordinator | `coordinator.ts` | Medium | Faster response |
| 10 | Configurable blocker timeout | `blocker-manager.ts` | Small | Flexibility |
| 11 | Feed message ordering guarantee | Database schema | Small | UI consistency |

### Low Priority (Nice to Have)

| # | Issue | Location | Effort | Impact |
|---|-------|----------|--------|--------|
| 12 | Unify tool name conventions | New file | Small | Maintainability |
| 13 | Consolidate marker extraction | New file | Small | Less duplication |
| 14 | Update Ollama provider | `package.json` | Small | Fix deprecated pkg |
| 15 | AI SDK 6 features (structured output) | Multiple | Medium | Better UX |

---

## Appendix: Quick Reference

### SDK Selection Rule

```typescript
if (config.primaryProvider === 'anthropic' && !config.providerRouting) {
  return 'agent-sdk';  // OAuth, parallel, free with Claude Max
}
return 'ai-sdk';  // API keys, sequential, multi-provider
```

### Error Categories

| Category | Auto-Retry | Examples |
|----------|------------|----------|
| typescript | ✅ Yes | TS compilation errors |
| lint | ✅ Yes | ESLint violations |
| test | ✅ Yes | Test failures |
| build | ❌ No | Webpack/Vite failures |
| auth | ❌ No | 401/403 errors |
| network | ❌ No | Timeouts, DNS |
| resource | ❌ No | Disk full, OOM |
| unknown | ❌ No | Unclassified |

### Token Lifetimes

| Auth Method | Lifetime | Refresh |
|-------------|----------|---------|
| OAuth (Claude Max) | 8 hours | `claude auth refresh` |
| API Key | Unlimited | N/A |

### Key Files

| File | Purpose |
|------|---------|
| `worker/epic/coordinator.ts` | Orchestrates parallel expert execution |
| `worker/epic/executor.ts` | Runs individual story execution |
| `worker/epic/blocker-manager.ts` | Error handling and escalation |
| `worker/epic/coordination-client.ts` | Worker-side API client |
| `api/src/routes/coordination.ts` | Feed and blocker endpoints |
| `api/src/services/planning-agent-local.ts` | Local mode planning agent |
