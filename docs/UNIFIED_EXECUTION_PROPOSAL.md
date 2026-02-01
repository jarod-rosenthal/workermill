# Unified Execution Proposal: AIClient Interface

> **Status:** Draft proposal - awaiting approval before implementation
>
> **Author:** Claude Code analysis session
>
> **Date:** 2026-02-01

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

## Open Questions

1. **Token reporting:** Should `onTokenUsage` report to the API internally (like Agent SDK does) or just callback and let the coordinator handle it?

2. **Tool validation:** Should implementations filter to their supported tools, or should the interface validate tools per provider?

3. **Parallel vs sequential:** Should this be a coordinator config option, or should we always use one approach?

4. **Streaming mode:** AI SDK has `STREAMING_MODE` flag. Should this be exposed in the interface?

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
