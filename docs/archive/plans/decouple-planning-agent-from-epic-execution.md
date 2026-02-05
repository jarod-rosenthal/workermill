# Decouple Planning Agent Provider from Epic Execution SDK

## Overview

Enable the Planning Agent to use a different AI provider (e.g., Gemini 3 Pro Preview) while Epic execution continues to use the Claude Agent SDK exclusively.

## Current State

The infrastructure for multi-provider support is already built:

| Component | Where it runs | Current SDK | Configurable? |
|-----------|--------------|-------------|---------------|
| **Planning Agent** | API (orchestrator-v2) | Vercel AI SDK | ✅ Yes - org settings |
| **Critic Agent** | API (orchestrator-v2) | Vercel AI SDK | ✅ Yes - same as Planning |
| **Epic Execution** | Worker container | Claude Agent SDK | ⚠️ Coupled to planning provider |

### Organization Settings (already exist)

- `planningAgentProvider`: "anthropic" | "openai" | "google" | "ollama"
- `planningAgentModel`: e.g., "gemini-3-pro-preview", "claude-sonnet-4-5-20250929"

### The Problem

In `api/src/services/orchestrator-v2.ts:773`, the routing logic couples the two phases:

```typescript
const useAgentSdk = planningProvider === "anthropic" && taskProvider === "anthropic";
```

This means:
- If Planning Agent is set to **Gemini** → routes Epic execution to AI SDK
- The Claude Agent SDK (proven working) gets bypassed

But these phases are **independent**:
1. **Planning** happens first - plan is stored in `task.executionPlanV2`
2. **Execution** happens second - experts work on stories using Claude CLI

## Proposed Change

### Location

`api/src/services/orchestrator-v2.ts` - lines 758-794

### Before

```typescript
// Check for Epic parallel execution mode
// When executionMode is 'parallel', use the Epic Coordinator for parallel multi-agent execution
// Auto-route based on org's planningAgentProvider AND task's workerProvider:
// - Both Anthropic → Agent SDK (spawnEpicContainer) - proven working
// - Either non-Anthropic → AI SDK (spawnMultiExpertContainer) - multi-provider support
// This ensures we don't try to use Agent SDK (Claude Code CLI) with non-Anthropic providers
if (task.executionMode === "parallel") {
  // Fetch org to check planningAgentProvider setting
  const orgRepo = getOrgRepo();
  const org = await orgRepo.findOne({ where: { id: task.orgId } });
  const planningProvider = org?.planningAgentProvider || "anthropic";
  const taskProvider = task.workerProvider || "anthropic";

  // Agent SDK (Claude Code CLI) ONLY works with Anthropic
  // If either planning or task provider is non-anthropic, use AI SDK
  const useAgentSdk = planningProvider === "anthropic" && taskProvider === "anthropic";
  // ...
}
```

### After

```typescript
// Check for Epic parallel execution mode
// When executionMode is 'parallel', use the Epic Coordinator for parallel multi-agent execution
//
// SDK selection is based ONLY on the task's workerProvider (execution provider):
// - Anthropic → Agent SDK (Claude Code CLI) - proven working, full tool access
// - Non-Anthropic → AI SDK (Vercel AI SDK) - multi-provider support
//
// The Planning Agent provider is independent - it already ran before execution starts.
// This allows using Gemini/GPT for planning while using Claude Agent SDK for execution.
if (task.executionMode === "parallel") {
  const orgRepo = getOrgRepo();
  const org = await orgRepo.findOne({ where: { id: task.orgId } });
  const planningProvider = org?.planningAgentProvider || "anthropic";
  const taskProvider = task.workerProvider || "anthropic";

  // Agent SDK (Claude Code CLI) ONLY works with Anthropic for EXECUTION
  // Planning provider doesn't affect this - planning already completed
  const useAgentSdk = taskProvider === "anthropic";
  // ...
}
```

### Key Change

```diff
- const useAgentSdk = planningProvider === "anthropic" && taskProvider === "anthropic";
+ const useAgentSdk = taskProvider === "anthropic";
```

## Target Configuration

After this change, the following configuration becomes possible:

| Phase | Provider | Model | SDK |
|-------|----------|-------|-----|
| **Planning** | Google | `gemini-3-pro-preview` | Vercel AI SDK |
| **Critic** | Google | `gemini-3-pro-preview` | Vercel AI SDK |
| **Epic Execution** | Anthropic | `claude-sonnet-4` (or haiku/opus) | Claude Agent SDK |

## Configuration Steps (Post-Implementation)

1. **Settings → Planning Agent (Project Manager)**
   - Provider: Google
   - Model: Gemini 3 Pro Preview

2. **Task execution** (via Jira labels or org default)
   - Worker model stays Anthropic (haiku/sonnet/opus labels)
   - Epic label triggers parallel execution

## Benefits

- **Blind spot detection**: Different AI for planning may catch issues Claude misses
- **Cost optimization**: Use cheaper models for planning, powerful models for execution
- **No functionality loss**: Claude Agent SDK execution remains unchanged
- **Backward compatible**: Default behavior unchanged (both default to Anthropic)

## Files to Modify

1. `api/src/services/orchestrator-v2.ts` - Decouple routing logic (single line change + comment update)

## Testing

1. Set Planning Agent to Google/Gemini in Settings
2. Create a Jira ticket with `workermill` + `epic` labels
3. Verify:
   - Planning phase uses Gemini (check API logs)
   - Epic execution uses Claude Agent SDK (check worker logs for `[AgentSDK]` prefix)
   - Full terminal output visible in dashboard

## Prerequisites

- ✅ Gemini API key configured in Secrets Manager (`workermill/{env}/gemini-api-key`)
- ✅ Vercel AI SDK already integrated for Planning Agent
- ✅ Frontend Settings UI already supports Google provider selection
