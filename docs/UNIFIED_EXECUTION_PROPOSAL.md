# Unified Execution Proposal: AIClient Interface

> **Status:** Draft proposal - awaiting approval before implementation
>
> **Author:** Claude Code analysis session
>
> **Date:** 2026-02-01
>
> **Risk Review:** 2026-02-02 - See [Risk Assessment](#risk-assessment) section

## Problem Statement

WorkerMill currently has two execution modes that are functionally nearly identical:

| Mode | Location | SDK | Providers |
|------|----------|-----|-----------|
| **Epic Mode** | `worker/epic/` | Claude Agent SDK (CLI) | Anthropic only |
| **Multi-Expert Mode** | `worker/multi-expert/` | Vercel AI SDK | Anthropic, OpenAI, Google, Ollama |

Both modes:
- Clone a repository
- Fetch stories from the coordination API
- Execute stories with an AI agent
- Post decisions/questions to the coordination feed
- Run quality verification (lint, typecheck, tests)
- Create consolidated PRs
- Run inline review loops

The **only meaningful differences** are:
1. Which SDK executes the prompts
2. Parallel (Epic) vs sequential (Multi-Expert) story execution
3. Epic has advanced features (phased execution, checkpoints, memory) that Multi-Expert lacks

This duplication creates maintenance burden and makes it harder to add features consistently.

---

## Proposed Solution: AIClient Interface

Abstract the SDK execution behind a common interface. The orchestration logic becomes SDK-agnostic, and the only thing that varies is how prompts are executed.

```
┌─────────────────────────────────────────────────────────────┐
│                   Unified Coordinator                        │
│  (story orchestration, coordination feed, PR creation)       │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              │ client.execute(options)
                              │
              ┌───────────────┴───────────────┐
              │         AIClient              │
              │         interface             │
              └───────────────┬───────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ AnthropicAgent  │ │   AISdkClient   │ │  Future Client  │
│    Client       │ │                 │ │                 │
│                 │ │ (OpenAI, Google │ │                 │
│ (Claude CLI)    │ │  Gemini, Ollama)│ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

---

## Current Implementation Analysis

### Agent SDK (`worker/epic/agent-sdk.ts`)

**How it works:**
- Spawns Claude CLI as subprocess: `claude --print --verbose --output-format stream-json`
- Writes prompt to stdin
- Reads JSON stream from stdout via readline
- Parses events into `StreamMessage` objects
- Reports token usage to `/api/tasks/:id/usage/partial` every 30 seconds

**Input:** `AgentOptions`
```typescript
interface AgentOptions {
  prompt: string;
  expertConfig: ExpertConfig;  // persona, systemPrompt, model, tools
  repoPath: string;
  storyId: string;
  env?: Record<string, string>;
  onMessage?: (msg: StreamMessage) => void;
}
```

**Output:** `AgentResult`
```typescript
interface AgentResult {
  success: boolean;
  messages: StreamMessage[];
  error?: string;
}
```

**Tools available:** Read, Write, Edit, Bash, Glob, Grep (Claude Code native tools)

---

### AI SDK Executor (`worker/agents/ai-sdk-executor.js`)

**How it works:**
- Uses Vercel AI SDK `generateText`/`streamText`
- Supports provider routing: Anthropic, OpenAI, Google, Ollama
- Custom tool implementations in `tools.js`
- Emits markers to stdout: `::result::`, `::pr_url::`, `::input_tokens::`, etc.

**Input:** CLI arguments + environment variables
```bash
node ai-sdk-executor.js \
  --provider anthropic \
  --model claude-haiku-4-5-20251001 \
  --persona backend_developer \
  --prompt-file /tmp/task.txt
```

**Output:** Stdout with markers
```
::result::completed
::pr_url::https://github.com/owner/repo/pull/123
::input_tokens::1500
::output_tokens::2000
```

**Tools available:** bash, read_file, write_file, edit_file, glob, grep (custom implementations)

---

## Proposed Interface

### Core Types

```typescript
/**
 * AI Provider types
 */
type AIProvider = "anthropic" | "openai" | "google" | "gemini" | "ollama";

/**
 * Expert persona types
 */
type ExpertPersona =
  | "frontend_developer"
  | "backend_developer"
  | "security_engineer"
  | "qa_engineer"
  | "devops_engineer"
  | "tech_writer"
  | "api_developer"
  | "data_engineer"
  | "database_administrator"
  | "ml_engineer"
  | "mobile_developer_android"
  | "mobile_developer_ios"
  | "tech_lead"
  | "manager";

/**
 * Stream message (unchanged from existing types.ts)
 */
interface StreamMessage {
  type: "text" | "thinking" | "tool_use" | "tool_result" | "result" | "error";
  content?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  structuredOutput?: Record<string, unknown>;
}

/**
 * Token usage tracking
 */
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;  // Anthropic-specific
  cacheReadTokens?: number;      // Anthropic-specific
}
```

### AIClientOptions

```typescript
/**
 * Configuration for an AI client execution.
 * Combines inputs from both current implementations.
 */
interface AIClientOptions {
  /** The prompt to execute */
  prompt: string;

  /** System prompt/instructions for the agent */
  systemPrompt: string;

  /** Persona determines default behavior and tools */
  persona: ExpertPersona;

  /** Model to use (provider-specific format) */
  model: string;

  /** Working directory for file operations */
  workingDir: string;

  /** Story/task ID for coordination */
  storyId: string;

  /** Parent task ID for token reporting */
  parentTaskId: string;

  /** Additional environment variables */
  env?: Record<string, string>;

  /** Available tools (filtered by implementation) */
  tools?: string[];

  /**
   * Callback for streaming messages.
   * Called in real-time as the agent produces output.
   */
  onMessage?: (msg: StreamMessage) => void;

  /**
   * Callback for partial token usage.
   * Called periodically during execution (every ~30 seconds).
   */
  onTokenUsage?: (usage: TokenUsage) => void;
}
```

### AIClientResult

```typescript
/**
 * Result of an AI client execution.
 */
interface AIClientResult {
  /** Whether execution completed successfully */
  success: boolean;

  /** All messages produced during execution */
  messages: StreamMessage[];

  /** Error message if success is false */
  error?: string;

  /** Final token usage */
  tokenUsage: TokenUsage;

  /** Model that was actually used */
  modelUsed: string;

  /** Structured output (for review personas) */
  structuredOutput?: Record<string, unknown>;

  /**
   * Output markers extracted from agent output.
   */
  markers?: {
    result?: string;           // completed, deployed, review_requested, etc.
    prUrl?: string;            // https://github.com/...
    prNumber?: string;         // 123
    branch?: string;           // ai/OCS-123
    reviewDecision?: "approved" | "revision_needed" | "rejected";
    codeQualityScore?: number; // 1-10
    feedback?: string;
  };
}
```

### AIClient Interface

```typescript
/**
 * The AIClient interface - abstracts over Agent SDK and AI SDK.
 */
interface AIClient {
  /** The provider this client uses */
  readonly provider: AIProvider;

  /** Execute a prompt and return the result */
  execute(options: AIClientOptions): Promise<AIClientResult>;
}
```

### Factory Function

```typescript
interface AIClientConfig {
  provider: AIProvider;
  apiKeys: {
    anthropic?: string;
    openai?: string;
    google?: string;
    ollamaHost?: string;
  };
  apiConfig: {
    baseUrl: string;
    orgApiKey: string;
  };
  /** If true and provider is "anthropic", use Claude CLI (Agent SDK) */
  useAgentSdk?: boolean;
}

function createAIClient(config: AIClientConfig): AIClient;
```

---

## Implementation Mapping

### AnthropicAgentClient

Wraps `worker/epic/agent-sdk.ts` exactly as it works today:

| Interface | Implementation |
|-----------|----------------|
| `options.prompt` | Combined with `systemPrompt`, written to stdin |
| `options.systemPrompt` | Prepended to prompt |
| `options.persona` | Used in `ExpertConfig` |
| `options.model` | Mapped via `mapModel()` to CLI format |
| `options.workingDir` | Passed as `cwd` to spawn |
| `options.storyId` | Set as `STORY_ID` env var |
| `options.parentTaskId` | Set as `TASK_ID` env var, used for token API |
| `options.env` | Merged into spawn environment |
| `options.tools` | Filtered via `filterBuiltinTools()` |
| `options.onMessage` | Called from `parseStreamEvent()` |
| `options.onTokenUsage` | Called from `reportPartialTokenUsage()` |

### AISdkClient

Wraps `worker/agents/ai-sdk-executor.js` exactly as it works today:

| Interface | Implementation |
|-----------|----------------|
| `options.prompt` | Written to temp file, passed via `--prompt-file` |
| `options.systemPrompt` | Set as `AGENT_SYSTEM_PROMPT` env var |
| `options.persona` | Passed via `--persona` CLI arg |
| `options.model` | Passed via `--model` CLI arg |
| `options.workingDir` | Set as `AGENT_WORKING_DIR` env var |
| `options.storyId` | Set as `STORY_ID` env var |
| `options.parentTaskId` | Set as `TASK_ID` env var |
| `options.env` | Merged into spawn environment |
| `options.tools` | All tools available (implementation filters) |
| `options.onMessage` | Parsed from stdout events |
| `options.onTokenUsage` | Parsed from `::input_tokens::` markers |

---

## What Changes vs What Stays The Same

### Stays The Same (NO functional changes)

1. **Agent SDK behavior:**
   - Spawns Claude CLI with exact same arguments
   - Parses JSON stream the same way
   - Reports tokens to same API endpoint
   - Same tool filtering (Read, Write, Edit, Bash, Glob, Grep)

2. **AI SDK behavior:**
   - Uses same `generateText`/`streamText` calls
   - Same provider routing logic
   - Same tool definitions
   - Same marker emission

3. **Coordinator behavior:**
   - Still polls for stories, claims them, executes them
   - Still posts to coordination feed
   - Still creates PRs, runs quality checks
   - Still handles inline review loop

### Changes (abstraction only)

**Before:**
```typescript
// Epic coordinator (coordinator.ts)
import { runAgent } from "./agent-sdk.js";
const result = await runAgent(config, options);

// Multi-Expert coordinator (index.ts)
const child = spawn('node', ['ai-sdk-executor.js', ...args]);
// ...parse stdout for markers...
```

**After:**
```typescript
// Unified coordinator
const client = createAIClient({ provider: org.primaryProvider, ... });
const result = await client.execute(options);
// result.markers.prUrl, result.tokenUsage, etc.
```

---

## Migration Path

### Phase 1: Create Interface + Implementations (NO behavior changes)

- Create `worker/ai-clients/types.ts` with interface definitions
- Create `worker/ai-clients/anthropic-agent.ts` wrapping `agent-sdk.ts`
- Create `worker/ai-clients/ai-sdk-client.ts` wrapping `ai-sdk-executor.js`
- Both implementations pass existing behavior verification

### Phase 2: Update Epic Coordinator

- Replace direct `runAgent()` call with `client.execute()`
- Verify all existing tests pass
- Verify production behavior unchanged

### Phase 3: Update Multi-Expert Coordinator

- Replace subprocess spawn with `client.execute()`
- Verify all existing tests pass
- Verify production behavior unchanged

### Phase 4: Unify Coordinators

- Extract shared orchestration logic into single coordinator
- Mode selection becomes just `AIClient` selection
- Delete duplicate code from `worker/multi-expert/`

### Phase 5 (Optional): Feature Parity

- Port phased execution to unified coordinator (works with any client)
- Port checkpoints to unified coordinator
- Port memory client to unified coordinator
- These features become available for all providers

---

## Open Questions (Resolved)

1. **Token reporting:** Should `onTokenUsage` report to the API internally (like Agent SDK does) or just callback and let the coordinator handle it?

   > **Resolution:** Clients report internally to maintain current behavior. The `onTokenUsage` callback is for coordinator visibility only (logging, UI updates). This preserves the Agent SDK's direct HTTP POST behavior and avoids changing the Multi-Expert marker-based approach.

2. **Tool validation:** Should implementations filter to their supported tools, or should the interface validate tools per provider?

   > **Resolution:** Implementations filter internally. The interface accepts a `tools` array but each client applies its own filtering (Agent SDK uses `filterBuiltinTools()`, AI SDK allows all tools). This matches current behavior.

3. **Parallel vs sequential:** Should this be a coordinator config option, or should we always use one approach?

   > **Resolution:** Default to sequential execution (simpler, no file conflicts). Add `executionMode: "sequential" | "parallel"` as optional coordinator config. Parallel mode requires file locking coordination and should only be enabled for Anthropic provider initially.

4. **Streaming mode:** AI SDK has `STREAMING_MODE` flag. Should this be exposed in the interface?

   > **Resolution:** Always stream. Both implementations already stream by default. No interface flag needed.

---

## Risk Assessment

> **Added:** 2026-02-02 based on code review

### Critical Gaps Identified

#### 1. No Rollback Strategy

The original proposal lacks a plan for reverting if phases cause production issues.

**Required additions:**
- Feature flag `featureFlags.unifiedAiClient` to toggle between old and new paths
- Shadow mode capability to run both implementations and compare results
- Quick revert mechanism at each phase

```typescript
// Add to coordinator initialization
const useUnifiedClient = config.featureFlags?.unifiedAiClient ?? false;
if (useUnifiedClient) {
  return client.execute(options);
} else {
  return runAgent(config, options);  // Legacy path preserved
}
```

#### 2. No Testing Strategy

The proposal says "verify all existing tests pass" without specifying what tests exist or how to verify behavioral equivalence.

**Required test coverage:**
- [ ] Token reporting accuracy (cumulative vs incremental)
- [ ] Error recovery (Claude CLI crash, network timeout, API errors)
- [ ] Cancellation handling (SIGTERM, SIGKILL)
- [ ] Streaming latency verification
- [ ] Tool output format comparison
- [ ] End-to-end story execution comparison

#### 3. Token Reporting Divergence

**Current implementations differ fundamentally:**

| Aspect | Agent SDK | AI SDK |
|--------|-----------|--------|
| Reporting method | HTTP POST to `/api/tasks/:id/usage/partial` | Stdout markers (`::input_tokens::`) |
| Timing | Timer-based, every 30 seconds | On each streamText chunk |
| On crash | Sends final via `reportPartialTokenUsage()` | Lost if process dies before marker emission |
| Cache tokens | Tracks `cacheCreationTokens`, `cacheReadTokens` | Not tracked |

**Mitigation:** Document that `AnthropicAgentClient` posts internally while `AISdkClient` emits markers parsed by coordinator. Both behaviors preserved, just abstracted.

#### 4. Tool Implementation Differences

| Tool | Agent SDK (Claude CLI) | AI SDK (tools.js) |
|------|------------------------|-------------------|
| File paths | Native Claude Code path handling | Custom `resolveFilePath()` in tools.js |
| Bash | Native sandbox with timeout | Custom exec with 120s timeout |
| Glob | Native fast-glob integration | `fast-glob` library direct |
| Error format | Claude CLI error messages | Custom error strings |

**Risk:** Same prompt may produce different results depending on client.

**Mitigation:** Create comparison test suite that runs identical prompts through both clients and validates:
- Same files modified
- Similar token counts (within 10%)
- Same success/failure outcome

---

### Risk Matrix

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Token reporting divergence | High | Medium | Document behavior, add monitoring |
| Tool implementation differences | Medium | High | Comparison test suite |
| No rollback strategy | N/A | Critical | **P0** - Add before implementation |
| Large deletion (Phase 4) | Medium | High | Split into Phase 4a/4b |
| Parallel vs sequential deferred | High | Medium | Resolved - default sequential |
| Sacred patterns broken | Low | Critical | Explicit verification checklist |

---

### Sacred Patterns Verification

Per `CLAUDE.md`, these patterns must NOT be changed. Add explicit verification at each phase:

- [ ] **Log streaming:** PostgreSQL + SSE still works identically
- [ ] **Task orchestration:** Database polling with atomic claim unchanged
- [ ] **Worker entrypoint:** `post_log()` shell function still works
- [ ] **LLM Models:** No default model changes introduced

---

## Updated Migration Path

### Phase 0: Preparation (NEW - Required before implementation)

**Duration:** 1 week

- [ ] Add feature flag infrastructure (`featureFlags.unifiedAiClient` in Organization model)
- [ ] Create behavioral test suite capturing current Agent SDK and AI SDK behavior
- [ ] Document exact token reporting flow for both implementations
- [ ] Add observability metrics for comparison:
  - `worker.execution.tokens.reported` (by client type)
  - `worker.execution.duration` (by client type)
  - `worker.execution.errors` (by client type, error type)
- [ ] Create rollback runbook

### Phase 1: Create Interface + Implementations (NO behavior changes)

**Duration:** 1 week

- Create `worker/ai-clients/types.ts` with interface definitions
- Create `worker/ai-clients/anthropic-agent.ts` wrapping `agent-sdk.ts`
- Create `worker/ai-clients/ai-sdk-client.ts` wrapping `ai-sdk-executor.js`
- Both implementations pass behavioral verification tests from Phase 0
- **Gate:** All comparison tests pass before proceeding

### Phase 2: Update Epic Coordinator

**Duration:** 1 week

- Replace direct `runAgent()` call with `client.execute()` behind feature flag
- Run shadow mode: execute both old and new paths, compare results
- Verify all existing tests pass
- **Gate:** 48 hours of shadow mode with <1% divergence before enabling flag

### Phase 3: Update Multi-Expert Coordinator

**Duration:** 1 week

- Replace subprocess spawn with `client.execute()` behind feature flag
- Run shadow mode for comparison
- Verify all existing tests pass
- **Gate:** 48 hours of shadow mode with <1% divergence before enabling flag

### Phase 4a: Unify Coordinators (NEW - Split from original Phase 4)

**Duration:** 2 weeks

- Extract shared orchestration logic into `worker/orchestrator/coordinator.ts`
- Mode selection becomes `AIClient` selection
- **Keep legacy coordinators as fallback** (do not delete yet)
- Add deprecation logging to legacy paths
- **Gate:** 1 week of production traffic on unified coordinator

### Phase 4b: Remove Legacy Code (NEW - 2 weeks after 4a)

**Duration:** 1 week

- Delete `worker/multi-expert/` duplicate orchestration
- Delete legacy feature flag checks
- Update documentation
- **Gate:** No fallback to legacy in prior week

### Phase 5: Feature Parity (Committed, not optional)

**Duration:** 2-3 weeks

- Port phased execution to unified coordinator
- Port checkpoints to unified coordinator
- Port memory client to unified coordinator
- These features become available for all providers

---

### Rollback Triggers

Automatic rollback to legacy path if any of these occur:

| Metric | Threshold | Action |
|--------|-----------|--------|
| Token reporting accuracy | <95% match with legacy | Disable feature flag |
| Error rate increase | >10% above baseline | Disable feature flag |
| Execution time increase | >20% above baseline | Investigate, disable if not transient |
| Task completion rate | >5% drop | Immediate rollback |

---

## Missing Requirements (Added)

The following requirements were not addressed in the original proposal:

1. **Timeout handling:** Add `timeoutMs` option to `AIClientOptions` (default: 30 minutes)
2. **Graceful shutdown:** Document SIGTERM handling for each client
3. **Retry logic:** No automatic retry - clients return error, coordinator decides
4. **Context window overflow:** Add `AIClientCapabilities.maxContextTokens` for pre-validation
5. **Rate limiting:** Defer to provider SDKs (both handle internally)
6. **Observability:** Standardize log format with structured JSON
7. **Cost estimation:** Add `estimateCost(promptTokens: number, model: string): number` utility

---

## File Locations

| Current | Purpose |
|---------|---------|
| `worker/epic/agent-sdk.ts` | Agent SDK wrapper (Claude CLI) |
| `worker/epic/coordinator.ts` | Epic orchestration (~1900 lines) |
| `worker/epic/types.ts` | Type definitions |
| `worker/multi-expert/index.ts` | Multi-Expert orchestration (~2400 lines) |
| `worker/agents/ai-sdk-executor.js` | AI SDK executor |
| `worker/agents/tools.js` | Custom tool implementations |

| Proposed | Purpose |
|----------|---------|
| `worker/ai-clients/types.ts` | Interface definitions |
| `worker/ai-clients/anthropic-agent.ts` | Agent SDK implementation |
| `worker/ai-clients/ai-sdk-client.ts` | AI SDK implementation |
| `worker/ai-clients/index.ts` | Factory function |
| `worker/orchestrator/coordinator.ts` | Unified orchestration |

---

## Appendix: Current Code Statistics

| File | Lines | Purpose |
|------|-------|---------|
| `worker/epic/coordinator.ts` | ~1900 | Epic orchestration |
| `worker/multi-expert/index.ts` | ~2400 | Multi-Expert orchestration |
| `worker/epic/agent-sdk.ts` | ~436 | Agent SDK wrapper |
| `worker/agents/ai-sdk-executor.js` | ~1181 | AI SDK executor |
| `worker/epic/types.ts` | ~228 | Shared types |

**Estimated code reduction after unification:** ~2000 lines (eliminating duplicate orchestration logic)

---

## Appendix E: Additional Scope (Added 2026-02-02)

### Consumers NOT Addressed in Original Proposal

The original proposal only mentions `coordinator.ts` and `multi-expert/index.ts`, but there are **19 files** that use `runAgent` or `ai-sdk-executor`:

#### Worker-Side Consumers (Must Migrate)

| File | Uses | Migration Needed |
|------|------|------------------|
| `worker/epic/executor.ts` | `runAgent` | Yes - Phase 2 |
| `worker/epic/inline-reviewer.ts` | `runAgent` | Yes - Phase 2 |
| `worker/epic/inline-deployer.ts` | `runAgent` | Yes - Phase 2 |
| `worker/epic/inline-improver.ts` | `runAgent` | Yes - Phase 2 |
| `worker/multi-expert/inline-reviewer.ts` | `spawn ai-sdk-executor` | Yes - Phase 3 |
| `worker/standard/executor.ts` | `runAgent` (imports from epic) | Yes - Phase 2 |
| `worker/manager/agent-sdk.ts` | **DUPLICATE** of epic/agent-sdk.ts | **Consolidate first** |
| `worker/manager/reviewer.ts` | Manager's `runAgent` | Yes - after consolidation |

#### API-Side Agents (Out of Scope - Already Use AI SDK)

| File | Uses | Notes |
|------|------|-------|
| `api/src/services/planning-agent.ts` | `generateText` (AI SDK) | Already provider-agnostic |
| `api/src/services/critic-agent.ts` | `generateText`, `streamText` (AI SDK) | Already provider-agnostic |

These run in the API container, not workers. They're already using Vercel AI SDK directly and don't need the AIClient interface.

### Manager Mode: Duplicate Agent SDK

**Critical finding:** `worker/manager/agent-sdk.ts` is a near-copy of `worker/epic/agent-sdk.ts` with minor config differences.

| Aspect | Epic agent-sdk.ts | Manager agent-sdk.ts |
|--------|-------------------|----------------------|
| Config type | `EpicConfig` | `ManagerConfig` |
| Options type | `AgentOptions` | `AgentOptions` (different) |
| Token reporting | Same endpoint | Same endpoint |
| Behavior | Identical | Identical |

**Action required:** Before Phase 1, consolidate these into a single implementation to avoid maintaining two wrappers.

```
Phase 0.5 (NEW): Consolidate Manager agent-sdk.ts
- Merge worker/manager/agent-sdk.ts into worker/epic/agent-sdk.ts
- Use generic config interface that works for both
- Update worker/manager/reviewer.ts to import from epic
```

---

## Appendix F: Operational Concerns

### 1. Warm Pool Considerations

WorkerMill uses pre-warmed ECS containers (`api/src/services/warm-pool.ts`) that sit ready to claim tasks. These containers have code baked in.

**Risk:** During phased rollout, warm pool may have stale code.

**Mitigation:**
- Add version header to worker API calls: `X-Worker-Version: <git-sha>`
- API rejects claims from incompatible worker versions
- Force warm pool drain before enabling feature flag

```typescript
// Add to worker startup
const WORKER_VERSION = process.env.GIT_SHA || "unknown";
axios.defaults.headers["X-Worker-Version"] = WORKER_VERSION;

// Add to API claim endpoint
if (req.headers["x-worker-version"] !== CURRENT_COMPATIBLE_VERSION) {
  return res.status(409).json({ error: "Worker version incompatible, please restart" });
}
```

### 2. In-Flight Task Handling

What happens to tasks already running when deployment occurs?

| Scenario | Current Behavior | Proposed Behavior |
|----------|------------------|-------------------|
| API deploys, worker running | Worker continues, API accepts results | No change |
| Worker deploys mid-task | Task fails, marked as failed | No change |
| Feature flag changes mid-task | N/A (new) | Task continues with original path |

**Recommendation:** Feature flag should be read at task claim time, not per-story. Store in task metadata:
```typescript
// On task claim
task.metadata.useUnifiedClient = org.featureFlags?.unifiedAiClient ?? false;

// On story execution
const useUnified = task.metadata.useUnifiedClient; // Not re-read from org
```

### 3. Deployment Coordination

API and worker containers deploy independently. Version skew is possible.

| API Version | Worker Version | Compatibility |
|-------------|----------------|---------------|
| Old | Old | ✅ Works |
| New | Old | ⚠️ Old worker doesn't understand new feature flags |
| Old | New | ⚠️ New worker may use paths old API doesn't expect |
| New | New | ✅ Works |

**Mitigation:** Deploy in order:
1. API first (adds feature flag support, defaults to off)
2. Wait 5 minutes for warm pool drain
3. Worker second (reads feature flag)
4. Enable feature flag after both deployed

### 4. Cost/Billing Implications

Token tracking flows to billing:
```
Worker reports tokens → API /usage/partial → WorkerTask.cost updated → Org billing calculated
```

**Risk:** Different token reporting behavior could affect billing accuracy.

**Verification required:**
- [ ] Run parallel billing audit during shadow mode
- [ ] Compare total tokens reported: old path vs new path
- [ ] Verify cost calculations match within 1%

---

## Appendix G: Missing Documentation Updates

The proposal doesn't mention updating:

| Document | Updates Needed |
|----------|----------------|
| `CLAUDE.md` | Add AIClient to "Key files" section |
| `worker/AGENTS.md` | Update architecture diagrams |
| `docs/` (user-facing) | Update if execution behavior visible to users |
| `frontend/src/pages/Docs/` | Update architecture section |
| Architecture diagrams | New AIClient layer |
| Runbooks | Add unified client troubleshooting |

---

## Appendix H: Performance Baseline

**Missing from proposal:** No baseline metrics to compare against.

Capture before Phase 1:

| Metric | Current Value | Target (unified) |
|--------|---------------|------------------|
| Average story execution time | TBD | Same ±10% |
| Token reporting latency | TBD | Same |
| Memory usage per story | TBD | Same ±20% |
| Error rate | TBD | Same or lower |
| P95 execution time | TBD | Same ±15% |

**Add observability:**
```typescript
// Wrap execution with timing
const start = Date.now();
const result = await client.execute(options);
const duration = Date.now() - start;

metrics.histogram("worker.execution.duration", duration, {
  client: client.provider,
  persona: options.persona,
  success: result.success,
});
```

---

## Appendix I: Security Considerations

### API Key Handling

Both implementations pass API keys via environment variables. Verify:
- [ ] No API keys logged in new abstraction layer
- [ ] Keys not included in error messages
- [ ] Same key rotation behavior

### Token/Auth Changes

- [ ] `ORG_API_KEY` still used identically for coordination API calls
- [ ] No new auth paths introduced
- [ ] Audit log entries unchanged

---

## Updated Phase 0 Checklist

Based on gaps identified, Phase 0 must include:

- [ ] Consolidate `worker/manager/agent-sdk.ts` into `worker/epic/agent-sdk.ts`
- [ ] Add feature flag infrastructure
- [ ] Create behavioral test suite
- [ ] Capture performance baselines
- [ ] Add worker version header for warm pool compatibility
- [ ] Document exact token reporting flows
- [ ] Create deployment runbook with order of operations
- [ ] Set up parallel billing audit capability
- [ ] Update `CLAUDE.md` with new file locations
- [ ] Verify inline phases (reviewer, deployer, improver) are in scope

---

## Appendix J: Multi-Tenant Considerations

WorkerMill is multi-tenant. Each organization can have different:
- Primary provider (anthropic, openai, google, ollama)
- Provider routing per persona
- Feature flags
- API keys

**Ensure:**
- [ ] Feature flag is per-org, not global
- [ ] Shadow mode can be enabled per-org for gradual rollout
- [ ] Different orgs can be on different phases simultaneously
- [ ] Org A on legacy path doesn't affect Org B on unified path

**Recommended rollout:**
1. Enable for internal test org first
2. Enable for low-volume orgs
3. Enable for high-volume orgs last
4. Monitor per-org metrics throughout

---

## Appendix K: External Integration Impact

Verify these external integrations are unaffected:

| Integration | Interaction Point | Verification |
|-------------|-------------------|--------------|
| **Jira** | Coordination feed posts, status updates | Same payload format |
| **GitHub/GitLab/Bitbucket** | PR creation, file operations | Via SCM provider, unchanged |
| **Webhooks (inbound)** | Task creation | Not affected (API-side) |
| **Webhooks (outbound)** | Task completion | Same payload format |
| **SSE log streaming** | Worker posts logs | Same `POST /api/tasks/:id/logs` |

---

## Appendix L: Alerting/Monitoring Additions

Add alerts during migration:

| Alert | Condition | Action |
|-------|-----------|--------|
| Token reporting gap | No tokens reported for 10+ minutes on active task | Page on-call |
| Execution timeout spike | P95 execution time > 2x baseline | Investigate, consider rollback |
| Error rate spike | >20% increase in story failures | Auto-disable feature flag |
| Version mismatch | Worker version != expected for >5 minutes | Drain warm pool |
| Shadow mode divergence | >5% difference in old vs new results | Alert for investigation |

---

## Appendix M: Database Schema Changes

**Good news:** No schema changes required for core migration.

**Optional additions for observability:**

```sql
-- Add to WorkerTask for version tracking
ALTER TABLE worker_task ADD COLUMN IF NOT EXISTS
  execution_client VARCHAR(50);  -- "anthropic-agent" | "ai-sdk" | "unified"

-- Add to Organization for feature flags (if not exists)
-- Already exists in settings JSONB, no migration needed
```

---

## Summary of Gaps Identified

| Gap | Severity | Status |
|-----|----------|--------|
| Missing 17+ consumer files from scope | High | **Added to Appendix E** |
| Duplicate manager/agent-sdk.ts | High | **Added Phase 0.5** |
| No warm pool handling | Medium | **Added to Appendix F** |
| No in-flight task strategy | Medium | **Added to Appendix F** |
| No deployment coordination | Medium | **Added to Appendix F** |
| No billing verification | Medium | **Added to Appendix F** |
| No documentation updates | Low | **Added to Appendix G** |
| No performance baselines | Medium | **Added to Appendix H** |
| No security verification | Low | **Added to Appendix I** |
| No multi-tenant rollout plan | Medium | **Added to Appendix J** |
| No external integration verification | Low | **Added to Appendix K** |
| No alerting/monitoring | Medium | **Added to Appendix L** |

**Recommendation:** Address all High and Medium severity gaps before proceeding with implementation.

---

## Appendix N: Environment Variable Differences

The two implementations use **different environment variables**. The unified interface must normalize these.

### Agent SDK (epic/agent-sdk.ts)

Receives config via function arguments, passes to subprocess:

```typescript
const agentEnv = {
  ANTHROPIC_API_KEY: config.anthropicApiKey,
  API_BASE_URL: config.apiBaseUrl,
  ORG_API_KEY: config.orgApiKey,
  PARENT_TASK_ID: config.parentTaskId,
  TASK_ID: config.parentTaskId,
  STORY_ID: options.storyId,
  PERSONA: options.expertConfig.persona,
};
```

### AI SDK Executor (agents/ai-sdk-executor.js)

Reads from environment directly:

```javascript
const MAX_STEPS = parseInt(process.env.AGENT_MAX_STEPS || '100', 10);
const WORKING_DIR = process.env.AGENT_WORKING_DIR || process.cwd();
const VERBOSE = process.env.AGENT_VERBOSE === 'true';
const STREAMING_MODE = process.env.AGENT_STREAMING !== 'false';
const ORG_ID = process.env.ORG_ID || '';
const TASK_ID = process.env.TASK_ID || '';
// Provider-specific:
process.env.ANTHROPIC_API_KEY
process.env.OPENAI_API_KEY
process.env.GOOGLE_GENERATIVE_AI_API_KEY
process.env.OLLAMA_HOST
process.env.AGENT_SYSTEM_PROMPT
process.env.DIRECTIVES_DIR
```

### Normalization Required

| Purpose | Agent SDK | AI SDK | Unified |
|---------|-----------|--------|---------|
| Max iterations | N/A (CLI default) | `AGENT_MAX_STEPS` | Add to `AIClientOptions.maxSteps` |
| Working directory | `cwd` in spawn | `AGENT_WORKING_DIR` | Already in `AIClientOptions.workingDir` |
| Verbose logging | N/A | `AGENT_VERBOSE` | Add to `AIClientOptions.verbose` |
| Streaming | Always | `AGENT_STREAMING` | Always (per resolution) |
| System prompt | Combined with prompt | `AGENT_SYSTEM_PROMPT` | Already in `AIClientOptions.systemPrompt` |

---

## Appendix O: Signal Handling Differences

### Agent SDK

No explicit signal handling. Claude CLI handles signals internally. Parent process (coordinator) handles cleanup.

### AI SDK Executor

No explicit signal handling in the executor itself. The multi-expert coordinator kills the child process on shutdown:

```typescript
// In multi-expert/index.ts - on coordinator shutdown
child.kill("SIGTERM");
setTimeout(() => child.kill("SIGKILL"), 5000);
```

### Entrypoint Signal Handling

The shell entrypoint handles Spot interruption:

```bash
trap handle_spot_interruption SIGTERM
# Posts partial tokens, marks task for retry, exits cleanly
```

### Unified Client Requirements

- [ ] `AIClient.abort()` method to cancel execution
- [ ] Pass `AbortSignal` to implementations
- [ ] Implementations must clean up child processes on abort
- [ ] Final token report must be sent before exit

---

## Appendix P: Test Coverage Gap (CRITICAL)

**There are NO unit tests for the execution layer.**

| File | Test File | Coverage |
|------|-----------|----------|
| `worker/epic/agent-sdk.ts` | None | 0% |
| `worker/agents/ai-sdk-executor.js` | None | 0% |
| `worker/epic/coordinator.ts` | None | 0% |
| `worker/multi-expert/index.ts` | None | 0% |

Only test found: `worker/lib/checkpoint.test.sh` (shell script test for checkpoint logic)

**This is a major risk.** Without tests, we cannot verify behavioral equivalence.

### Required Before Phase 1

Create test harness that can:
1. Mock Claude CLI subprocess responses
2. Mock AI SDK provider responses
3. Verify token reporting calls
4. Verify coordination API calls
5. Verify output marker parsing

### Suggested Test Structure

```
worker/__tests__/
├── agent-sdk.test.ts        # Unit tests for Agent SDK wrapper
├── ai-sdk-client.test.ts    # Unit tests for AI SDK wrapper
├── unified-client.test.ts   # Integration tests for AIClient interface
└── fixtures/
    ├── claude-cli-responses.json
    └── ai-sdk-responses.json
```

---

## Appendix Q: Timeout Configuration

Different timeouts exist throughout the codebase:

| Context | Timeout | Location |
|---------|---------|----------|
| API calls to coordination | 5-10 seconds | Various |
| Blocking question wait | 2 minutes | `executor.ts:1056` |
| Deployment approval wait | 10 minutes | `inline-deployer.ts:356` |
| Bash command execution | 120 seconds | `tools/bash.js:43` |
| Max execution steps | 100 steps | `ai-sdk-executor.js:63` |

**No overall execution timeout** for a story. Stories can run indefinitely.

### Recommendation

Add `timeoutMs` to `AIClientOptions`:
- Default: 30 minutes per story
- Configurable per-org or per-task
- Implementation must enforce and clean up on timeout

---

## Appendix R: Retry Logic Inconsistency

`worker/lib/api-retry.ts` provides retry logic for API calls:

| Feature | Implementation |
|---------|----------------|
| Max retries | 3 |
| Initial delay | 1000ms |
| Max delay | 10000ms |
| Backoff | Exponential with jitter |
| Retryable statuses | 502, 503, 504 |

**Usage is inconsistent:**

| File | Uses `withRetry`? |
|------|-------------------|
| `worker/standard/executor.ts` | ✅ Yes (imports it) |
| `worker/epic/agent-sdk.ts` | ❌ No (direct axios) |
| `worker/agents/ai-sdk-executor.js` | ❌ No (not applicable - not making API calls) |
| `worker/epic/coordinator.ts` | ❌ Mixed (some calls wrapped, some not) |
| `worker/multi-expert/index.ts` | ❌ No (direct axios) |

### Recommendation

Unified coordinator should use `withRetry` for all API calls consistently.

---

## Appendix S: Local Development Considerations

### Current Local Dev Setup

Per `CLAUDE.md`:
1. Start bastion: `./bin/bastion start`
2. SSH tunnel: `./bin/bastion ssh`
3. Run API: `cd api && DATABASE_URL=... npm run dev`

**Worker containers are NOT run locally.** They run in ECS only.

### Testing Unified Client Locally

Options:
1. **Unit tests with mocks** - Test interface without real SDKs
2. **Integration test container** - Docker container with Claude CLI installed
3. **E2E on staging** - Deploy to staging cluster first

**Recommendation:** Add Docker Compose config for local worker testing:

```yaml
# docker-compose.worker-test.yml
services:
  worker-test:
    build: ./worker
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - API_BASE_URL=http://host.docker.internal:3001
    volumes:
      - ./worker:/app
```

---

## Appendix T: CI/CD Pipeline Analysis

### Current Pipeline (`.github/workflows/ci-cd.yml`)

The existing CI/CD workflow is **manual-only** (workflow_dispatch) with these jobs:

| Job | Runner | Trigger | What It Does |
|-----|--------|---------|--------------|
| `api-ci` | ubuntu-latest | Always | Type check, lint, build, unit tests (Vitest) |
| `frontend-ci` | ubuntu-latest | Always | Type check, lint, build |
| `e2e-tests` | self-hosted ECS | Manual checkbox | Playwright tests against production |
| `integration-tests` | self-hosted ECS | Manual checkbox | API integration tests with real DB |
| `deploy-api` | ubuntu-latest | Manual checkbox | Build & push to ECR, update ECS |
| `deploy-frontend` | ubuntu-latest | Manual checkbox | Build & sync to S3, invalidate CloudFront |
| `deploy-worker` | ubuntu-latest | Manual checkbox | Build & push worker image to ECR |

### Critical Gap: No Worker CI Job

**The worker has NO CI checks.** It only has a deploy job that builds and pushes the Docker image.

Current worker package.json scripts:
```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "tsc"
  }
  // No "test" script!
}
```

### Self-Hosted Runner Infrastructure

The pipeline uses **ephemeral ECS Fargate Spot runners** for tests requiring VPC access:

```yaml
runs-on: [self-hosted, linux, x64, ecs]
```

**How it works:**
1. GitHub `workflow_job` webhook → API `/api/webhooks/github-runner`
2. API gets runner registration token from GitHub API
3. API spawns ECS Fargate task with runner
4. Runner registers, executes job, terminates
5. Cost: ~$0.01-0.02 per test run

**This infrastructure can be reused for worker tests.**

### Required CI/CD Additions for Migration

#### 1. Add Worker CI Job

```yaml
worker-ci:
  name: Worker - Type Check & Unit Tests
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4

    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '22'
        cache: 'npm'
        cache-dependency-path: worker/package-lock.json

    - name: Install root worker dependencies
      working-directory: worker
      run: npm ci

    - name: Install epic dependencies
      working-directory: worker/epic
      run: npm ci

    - name: Install multi-expert dependencies
      working-directory: worker/multi-expert
      run: npm ci

    - name: Type Check (root)
      working-directory: worker
      run: npm run typecheck

    - name: Type Check (epic)
      working-directory: worker/epic
      run: npx tsc --noEmit

    - name: Type Check (multi-expert)
      working-directory: worker/multi-expert
      run: npx tsc --noEmit

    - name: Unit Tests
      working-directory: worker
      run: npm test
      # Will fail until we add tests!
```

#### 2. Add Worker Behavioral Tests (Self-Hosted)

For tests that need Claude CLI or real API calls:

```yaml
worker-behavioral-tests:
  name: Worker Behavioral Tests
  runs-on: [self-hosted, linux, x64, ecs]
  needs: [worker-ci]
  if: github.event_name == 'workflow_dispatch' && inputs.run_worker_tests == true
  steps:
    - uses: actions/checkout@v4

    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '22'

    - name: Install dependencies
      working-directory: worker
      run: npm ci && cd epic && npm ci && cd ../multi-expert && npm ci

    - name: Install Claude CLI
      run: npm install -g @anthropic-ai/claude-code

    - name: Run behavioral comparison tests
      working-directory: worker
      run: npm run test:behavioral
      env:
        ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        API_BASE_URL: https://workermill.com/api
        ORG_API_KEY: ${{ secrets.E2E_API_KEY }}

    - name: Upload comparison results
      uses: actions/upload-artifact@v4
      if: always()
      with:
        name: behavioral-test-results
        path: worker/test-results/
        retention-days: 14
```

#### 3. Add Shadow Mode Comparison Job

For Phase 2-3 validation:

```yaml
worker-shadow-mode:
  name: Shadow Mode Comparison
  runs-on: [self-hosted, linux, x64, ecs]
  needs: [worker-ci]
  if: github.event_name == 'workflow_dispatch' && inputs.run_shadow_mode == true
  steps:
    - uses: actions/checkout@v4

    - name: Setup environment
      # ... setup steps ...

    - name: Run shadow mode test
      working-directory: worker
      run: npm run test:shadow
      env:
        SHADOW_MODE: "true"
        ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

    - name: Analyze divergence
      run: |
        node worker/scripts/analyze-shadow-results.js
        DIVERGENCE=$(cat worker/test-results/divergence.txt)
        if [ "$DIVERGENCE" -gt "1" ]; then
          echo "::error::Shadow mode divergence ${DIVERGENCE}% exceeds 1% threshold"
          exit 1
        fi
```

#### 4. Update Workflow Dispatch Inputs

Add new manual triggers:

```yaml
workflow_dispatch:
  inputs:
    # ... existing inputs ...
    run_worker_tests:
      description: 'Run worker behavioral tests on self-hosted runner'
      required: false
      type: boolean
      default: false
    run_shadow_mode:
      description: 'Run shadow mode comparison tests'
      required: false
      type: boolean
      default: false
```

#### 5. Gate Worker Deployment on Tests

Update `deploy-worker` to require tests:

```yaml
deploy-worker:
  name: Deploy Worker Image to ECR
  needs: [worker-ci, worker-behavioral-tests]  # Add dependency
  runs-on: ubuntu-latest
  if: |
    always() &&
    inputs.deploy_worker == true &&
    needs.worker-ci.result == 'success' &&
    (needs.worker-behavioral-tests.result == 'success' || needs.worker-behavioral-tests.result == 'skipped')
```

### Package.json Updates Required

Add test scripts to worker packages:

```json
// worker/package.json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:behavioral": "vitest run --config vitest.behavioral.config.ts",
    "test:shadow": "vitest run --config vitest.shadow.config.ts"
  },
  "devDependencies": {
    "vitest": "^2.0.0",
    "@vitest/coverage-v8": "^2.0.0"
  }
}
```

### Test Requirements for PR Merge (Updated)

| Gate | Requirement | Enforced By |
|------|-------------|-------------|
| Type check | All worker packages pass `tsc --noEmit` | `worker-ci` job |
| Unit tests | All AIClient unit tests pass | `worker-ci` job |
| Behavioral tests | Legacy vs unified output matches | `worker-behavioral-tests` job |
| Shadow mode | <1% divergence | `worker-shadow-mode` job |
| Integration | No regression in API tests | `integration-tests` job |

### Migration Phase CI Requirements

| Phase | CI Job Required | Gate Criteria |
|-------|-----------------|---------------|
| Phase 0 | Add `worker-ci` job | Job runs successfully |
| Phase 1 | Add behavioral tests | 100% pass for both implementations |
| Phase 2 | Enable shadow mode | <1% divergence for Epic mode |
| Phase 3 | Shadow mode | <1% divergence for Multi-Expert mode |
| Phase 4a | All tests | All jobs green for 48 hours |
| Phase 4b | All tests | No regressions for 1 week |

---

## Appendix U: Dependency Version Constraints

Both implementations have SDK dependencies that must be compatible:

### Agent SDK Dependencies

```json
// Relies on Claude CLI installed globally
// Version: @anthropic-ai/claude-code (latest)
```

### AI SDK Dependencies

```json
{
  "ai": "^4.x",
  "@ai-sdk/anthropic": "^1.x",
  "@ai-sdk/openai": "^1.x",
  "@ai-sdk/google": "^1.x",
  "ollama-ai-provider": "^1.x"
}
```

### Version Lock Recommendation

Pin exact versions during migration to avoid unexpected behavior changes:

```json
{
  "ai": "4.0.18",
  "@ai-sdk/anthropic": "1.2.3",
  // etc.
}
```

---

## Appendix V: Fallback Behavior

What happens if the unified client fails to initialize?

| Scenario | Current Behavior | Proposed Behavior |
|----------|------------------|-------------------|
| Missing API key | Fails at execution time | Fail fast at client creation |
| Invalid provider | N/A | Throw `UnsupportedProviderError` |
| Claude CLI not found | Process spawn fails | Check on startup, clear error |
| AI SDK import fails | Process crashes | Catch, return clear error |

### Client Initialization Validation

```typescript
function createAIClient(config: AIClientConfig): AIClient {
  // Validate before returning client
  if (config.provider === "anthropic" && config.useAgentSdk) {
    // Check Claude CLI exists
    const result = spawnSync("claude", ["--version"]);
    if (result.error) {
      throw new Error("Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code");
    }
  }

  if (!config.apiKeys[config.provider]) {
    throw new Error(`Missing API key for provider: ${config.provider}`);
  }

  // Return appropriate implementation
  ...
}
```

---

## Updated Summary of All Gaps

| # | Gap | Severity | Appendix | Status |
|---|-----|----------|----------|--------|
| 1 | Missing 17+ consumer files | High | E | Added |
| 2 | Duplicate manager/agent-sdk.ts | High | E | Added |
| 3 | Warm pool stale code | Medium | F | Added |
| 4 | In-flight task handling | Medium | F | Added |
| 5 | Deployment coordination | Medium | F | Added |
| 6 | Billing verification | Medium | F | Added |
| 7 | Documentation updates | Low | G | Added |
| 8 | Performance baselines | Medium | H | Added |
| 9 | Security verification | Low | I | Added |
| 10 | Multi-tenant rollout | Medium | J | Added |
| 11 | External integration verification | Low | K | Added |
| 12 | Alerting/monitoring | Medium | L | Added |
| 13 | Environment variable differences | Medium | N | Added |
| 14 | Signal handling differences | Medium | O | Added |
| 15 | **No test coverage** | **Critical** | P | Added |
| 16 | Timeout configuration | Medium | Q | Added |
| 17 | Retry logic inconsistency | Low | R | Added |
| 18 | Local development setup | Low | S | Added |
| 19 | CI/CD pipeline changes | Medium | T | Added |
| 20 | Dependency version constraints | Low | U | Added |
| 21 | Fallback behavior | Medium | V | Added |

**Total gaps identified: 21**

**Critical blockers before implementation:**
1. Create test harness (Appendix P)
2. Consolidate manager/agent-sdk.ts (Appendix E)
3. Add feature flag infrastructure (Phase 0)
4. Capture performance baselines (Appendix H)

---

## Appendix W: Success Criteria

How do we know the migration is complete and successful?

### Phase Completion Criteria

| Phase | Success Criteria |
|-------|------------------|
| Phase 0 | Feature flag deployed, test harness created, baselines captured |
| Phase 0.5 | Manager agent-sdk.ts deleted, manager uses epic's |
| Phase 1 | Both AIClient implementations pass behavioral tests |
| Phase 2 | Epic mode works identically with new client (48hr shadow mode) |
| Phase 3 | Multi-Expert mode works identically with new client (48hr shadow mode) |
| Phase 4a | Unified coordinator handles 100% of production traffic |
| Phase 4b | Legacy code deleted, no regressions for 1 week |
| Phase 5 | All advanced features (phased, checkpoints, memory) work for all providers |

### Overall Success Metrics

| Metric | Target |
|--------|--------|
| Task completion rate | Same as baseline ±1% |
| Average execution time | Same as baseline ±10% |
| Token reporting accuracy | ≥99% |
| Error rate | Same or lower than baseline |
| Code reduction | ≥1500 lines deleted |
| Test coverage | ≥80% for new AIClient code |

---

## Appendix X: Timeline Estimate

Based on scope and complexity:

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 0: Preparation | 1 week | None |
| Phase 0.5: Consolidate manager SDK | 2-3 days | Phase 0 |
| Phase 1: Interface + implementations | 1 week | Phase 0.5 |
| Phase 2: Update Epic coordinator | 1 week | Phase 1 |
| Phase 3: Update Multi-Expert coordinator | 1 week | Phase 1 (parallel with Phase 2) |
| Phase 4a: Unify coordinators | 2 weeks | Phase 2 + Phase 3 |
| Phase 4b: Remove legacy code | 1 week | Phase 4a + 1 week bake time |
| Phase 5: Feature parity | 2-3 weeks | Phase 4b |

**Total estimated duration: 8-10 weeks**

**Critical path:** Phase 0 → 0.5 → 1 → 2/3 (parallel) → 4a → (bake) → 4b → 5

---

## Appendix Y: Resource Requirements

| Role | Effort | Responsibilities |
|------|--------|------------------|
| **Lead Engineer** | 60-80% | Design, implement AIClient, coordinate phases |
| **Platform Engineer** | 20-30% | Feature flags, monitoring, CI/CD updates |
| **QA/Test Engineer** | 30-40% | Test harness, behavioral verification, shadow mode analysis |
| **DevOps** | 10-20% | Deployment coordination, warm pool management |
| **On-call** | As needed | Monitor rollout, respond to issues |

---

## Appendix Z: Communication Plan

### Stakeholders

| Stakeholder | Impact | Communication |
|-------------|--------|---------------|
| Engineering team | High | Weekly standup updates |
| Product | Low | Notify when complete |
| On-call rotation | Medium | Runbook updates before Phase 4a |
| Customers | None | No user-facing changes |

### Key Milestones to Communicate

1. **Phase 0 complete** - "Migration infrastructure ready"
2. **Phase 1 complete** - "New abstraction layer tested"
3. **Phase 4a rollout** - "Unified coordinator going live"
4. **Phase 4b complete** - "Legacy code removed"

---

## Final Recommendation

This proposal has grown from a simple interface abstraction to a comprehensive migration plan. Before proceeding:

### Must Do (Blockers)
- [ ] Create test harness for behavioral verification
- [ ] Add feature flag infrastructure
- [ ] Consolidate duplicate agent-sdk.ts files
- [ ] Capture performance baselines
- [ ] Define rollback triggers and runbook

### Should Do (Risk Reduction)
- [ ] Add worker version header for warm pool compatibility
- [ ] Set up shadow mode capability
- [ ] Add alerting for migration metrics
- [ ] Update CI/CD pipeline with worker tests

### Nice to Have (Polish)
- [ ] Update architecture documentation
- [ ] Add local development Docker setup
- [ ] Create video walkthrough of new architecture

---

## Alternative Approaches Considered

Before committing to this migration, consider alternatives:

### Option A: Do Nothing

**Pros:**
- Zero risk
- No engineering investment
- Both modes work today

**Cons:**
- Continued maintenance burden (~4300 lines of duplicate logic)
- Features added to one mode must be manually ported to other
- Bug fixes must be applied twice
- Increasing technical debt

**Verdict:** Viable short-term but unsustainable as features grow.

### Option B: Deprecate Multi-Expert Mode

**Pros:**
- Simpler - just delete Multi-Expert entirely
- Epic mode is more feature-complete
- Reduces scope significantly

**Cons:**
- Loses multi-provider support (OpenAI, Google, Ollama)
- Some orgs may be using non-Anthropic providers
- Anthropic lock-in

**Verdict:** Only viable if multi-provider support is not needed.

### Option C: Deprecate Epic Mode

**Pros:**
- AI SDK already supports multiple providers
- Vercel AI SDK is more actively maintained ecosystem

**Cons:**
- Loses Claude CLI's native tool implementations
- Must port phased execution, checkpoints, memory
- More rewrite work than Option B

**Verdict:** Higher effort than Option B with same lock-in concerns.

### Option D: Full Rewrite (Not Recommended)

**Pros:**
- Clean slate design
- Could address all architectural issues at once

**Cons:**
- Massive scope and risk
- 6+ months of work
- Feature freeze during rewrite
- High chance of failure

**Verdict:** Not recommended. Incremental migration is safer.

### Chosen: Option E (This Proposal)

Incremental migration with feature flags, shadow mode, and phased rollout.

**Trade-offs accepted:**
- Longer timeline (8-10 weeks vs 2-4 weeks for deprecation)
- More complex than alternatives
- Requires test infrastructure investment

**Benefits gained:**
- Preserves all existing functionality
- Multi-provider support retained
- Advanced features available to all providers
- Rollback possible at each phase
- Lower risk than alternatives

---

## Incremental Value Checkpoints

If we must stop early, what value do we have at each phase?

| Stop After | Value Delivered |
|------------|-----------------|
| Phase 0 | Feature flags + test harness (reusable infrastructure) |
| Phase 0.5 | Reduced code duplication (manager SDK consolidated) |
| Phase 1 | Clean abstraction exists but not used |
| Phase 2 | Epic mode uses abstraction (single code path) |
| Phase 3 | Both modes use abstraction (ready to unify) |
| Phase 4a | Unified coordinator (major milestone - 50% code reduction) |
| Phase 4b | Legacy deleted (full cleanup) |
| Phase 5 | Feature parity (all features for all providers) |

**Minimum viable milestone:** Phase 4a delivers most of the value. Phases 4b and 5 are polish.

---

## Long-term Ownership

Post-migration responsibilities:

| Area | Owner | Frequency |
|------|-------|-----------|
| AIClient interface | Platform team | As needed |
| Claude CLI updates | Watch @anthropic-ai/claude-code releases | Monthly |
| Vercel AI SDK updates | Watch ai package releases | Monthly |
| Monitoring/alerting | On-call | Continuous |
| Documentation | Last modifier | As changed |

### SDK Update Policy

When underlying SDKs release updates:
1. Test in staging first
2. Run behavioral comparison against production baseline
3. If >1% divergence, investigate before production deploy
4. Pin versions in package.json until verified

---

## Document Revision History

| Date | Author | Changes |
|------|--------|---------|
| 2026-02-01 | Claude Code | Initial proposal |
| 2026-02-02 | Claude Code | Added risk assessment, resolved open questions |
| 2026-02-02 | Claude Code | Added appendices E-V (scope, operational, testing gaps) |
| 2026-02-02 | Claude Code | Added appendices W-Z (success criteria, timeline, resources) |

---

## Appendix B: Interface Additions from Risk Review

### AIClientCapabilities

Add provider capability metadata to handle provider-specific limitations:

```typescript
interface AIClientCapabilities {
  /** Whether provider supports prompt caching */
  supportsCaching: boolean;

  /** Maximum context window in tokens */
  maxContextTokens: number;

  /** Whether provider supports streaming responses */
  supportsStreaming: boolean;

  /** Whether provider supports structured output (JSON mode) */
  supportsStructuredOutput: boolean;

  /** Tool names supported by this client */
  supportedTools: string[];
}

interface AIClient {
  readonly provider: AIProvider;
  readonly capabilities: AIClientCapabilities;
  execute(options: AIClientOptions): Promise<AIClientResult>;
}
```

### Extended AIClientOptions

Add timeout and execution mode:

```typescript
interface AIClientOptions {
  // ... existing fields ...

  /** Execution timeout in milliseconds (default: 1800000 = 30 minutes) */
  timeoutMs?: number;

  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}
```

### Coordinator Configuration

Add execution mode to coordinator config:

```typescript
interface CoordinatorConfig {
  // ... existing fields ...

  /** Story execution mode */
  executionMode?: "sequential" | "parallel";

  /** Feature flags */
  featureFlags?: {
    unifiedAiClient?: boolean;
    shadowMode?: boolean;  // Run both old and new, compare results
  };
}
```

---

## Appendix C: Behavioral Test Cases

Required test cases for Phase 0 verification:

### Token Reporting Tests

```typescript
describe("Token Reporting Parity", () => {
  it("reports partial tokens every 30 seconds during long execution");
  it("reports final tokens on successful completion");
  it("reports accumulated tokens on error/crash");
  it("tracks cache tokens for Anthropic provider");
  it("handles network errors during token reporting gracefully");
});
```

### Tool Execution Tests

```typescript
describe("Tool Execution Parity", () => {
  it("reads files with identical content");
  it("writes files with identical formatting");
  it("handles file paths with spaces correctly");
  it("executes bash commands with same timeout behavior");
  it("returns consistent error messages for missing files");
  it("glob patterns return same file lists");
});
```

### Story Execution Tests

```typescript
describe("Story Execution Parity", () => {
  it("produces same PR for identical story + repo state");
  it("posts same coordination feed messages");
  it("handles quality check failures identically");
  it("inline review loop produces same iterations");
});
```

---

## Appendix D: Rollback Runbook

### Immediate Rollback (< 5 minutes)

1. Set feature flag to false:
   ```sql
   UPDATE organizations
   SET settings = jsonb_set(settings, '{featureFlags,unifiedAiClient}', 'false')
   WHERE settings->'featureFlags'->>'unifiedAiClient' = 'true';
   ```

2. Restart worker containers:
   ```bash
   aws ecs update-service --cluster workermill-dev --service workermill-dev-worker --force-new-deployment
   ```

3. Verify legacy path active in logs:
   ```bash
   aws logs tail "/ecs/workermill-dev/worker" --follow | grep "Legacy coordinator"
   ```

### Staged Rollback (if unified coordinator deployed)

1. Revert to previous task definition:
   ```bash
   aws ecs update-service --cluster workermill-dev --service workermill-dev-worker \
     --task-definition workermill-dev-worker:<previous-revision>
   ```

2. Monitor for stability:
   ```bash
   aws cloudwatch get-metric-statistics --namespace WorkerMill \
     --metric-name TaskCompletionRate --period 300 --statistics Average
   ```

### Post-Rollback Analysis

1. Collect divergence logs from shadow mode
2. Identify root cause of behavioral difference
3. Add regression test for identified issue
4. Re-attempt migration after fix verified
