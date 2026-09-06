# Architecture

A technical overview of how WorkerMill CLI works.

## Stack

- **Language:** TypeScript, ESM
- **Terminal UI:** React + [Ink](https://github.com/vadimdemedes/ink)
- **AI:** [Vercel AI SDK](https://sdk.vercel.ai) v6 — provider-agnostic streaming and tool calling
- **CLI framework:** Commander.js
- **Test runner:** Vitest

The CLI talks directly to each provider — no WorkerMill server, no account, no cloud proxy. Your API keys stay in `~/.workermill/cli.json` or environment variables.

## Two Execution Modes

### Single-agent chat (`useAgent.ts`)

Default mode. You type, one model responds, tools run, response streams. Used for conversation, one-off fixes, exploration, and the `/as` command (single expert).

Flow:
```
user input → AI SDK streamText → tool calls → permission check → tool execution → response stream → UI render
```

### Multi-expert orchestration (`useOrchestrator.ts` + `orchestrator.ts`)

Triggered by `/build`. A team of specialized models works together.

Flow:
```
ticket/spec → [spec check] → planner → [plan critic] → specialist workers
  → definition-of-done check → quality gates → tech lead reviewer → commit
```

Bracketed stages are off by default (`review.specCheck`, `review.critic`).

- **Planner** reads the codebase and decomposes the task into scoped stories with specific files, acceptance criteria, and definition-of-done contracts (`requiredFiles`, `requiredTests`, `requiredCommands`)
- **Plan critic** (optional) scores the plan 1-10 on completeness, feasibility, dependencies, scope, and risk before any worker starts, refining it until it passes or 3 rounds are spent. This adds model calls and can identify planning issues before implementation; it does not guarantee lower total cost.
- **Workers** execute stories one at a time using their persona's system prompt
- **Definition-of-done** — after each story, the orchestrator validates that required files and tests exist and required commands pass. Missing artifacts block completion with machine-readable failure codes
- **Quality gates** — static gates from config plus planner-generated verification commands run before review
- **Reviewer** reads the diffs against the original spec and scores the code; a failing score sends work back for revision

#### Orchestrator module structure

The orchestrator is decomposed into focused modules under `src/orchestrator/`:

| Module | Responsibility |
|--------|---------------|
| `types.ts` | Interfaces: Story, OrchestrationOutput, OrchestrationResult, etc. |
| `utils.ts` | Error classification, rate limiting, prompt helpers, abort signals |
| `planning.ts` | Spec check, planner prompt, plan critic, story parsing/normalization, QA participation, topological sort |
| `execution.ts` | Story execution loop, tool setup, contract validation, retry/revision |
| `review.ts` | Tech lead review, revision passes, must-fix tracking, standalone review |
| `gates.ts` | Quality gates, LSP diagnostics |
| `candidate.ts` | Scoped candidate preparation before final verification |
| `completion.ts` | Evidence rechecks, push, PR creation, ticket transitions |

`orchestrator.ts` is the coordinator — setup, sequencing, and public API re-exports.

Each role can use a different model via `/settings route <persona> <provider>`.

## Configuration

Config lives at `~/.workermill/cli.json`:

```json
{
  "providers": {
    "anthropic": { "model": "claude-sonnet-4-6", "apiKey": "{env:ANTHROPIC_API_KEY}" },
    "ollama":    { "model": "qwen3-coder:30b", "host": "http://localhost:11434" }
  },
  "default": "ollama",
  "routing": {
    "planner":   "anthropic",
    "tech_lead": "anthropic"
  },
  "review": {
    "enabled": true,
    "maxRevisions": 3,
    "approvalThreshold": 9
  },
  "permissions": {
    "allow": ["bash(git *)", "read_file(*)"],
    "deny":  ["bash(rm *)"]
  }
}
```

Project overrides can live in `.workermill/config.json` at the repo root.

## Tools

Tools live in `src/engine/tools/`.

Built-in tools:

- **File:** `read_file`, `write_file`, `edit_file`, `multi_edit_file`, `patch`, `glob`, `grep`, `ls`, `view_image`, `download_file`
- **Shell:** `bash` (asynchronous foreground process), `bash_background`, `bash_output`, `bash_kill`
- **Git:** `git` (branch, commit, diff, log — blocks destructive ops)
- **Code:** `lsp` (Language Server Protocol integration), `verify` (run build/test commands)
- **Web:** `fetch` (HTTP), `web_search` (provider-specific)
- **Agentic:** `sub_agent` (spawn a child agent with worktree isolation), `todo` (task tracking), `memory` (persistent cross-session memory)
- **Tickets:** `ticket` (fetch, list/search, comment, and transition GitHub/Jira/Linear issues)

### Memory tool

The `memory` tool gives agents persistent, file-based memory across sessions. Agents check their memory directory at conversation start and save project patterns, corrections, and preferences as they work. Memory is stored per-project under `~/.workermill/projects/<id>/memories/` as plain markdown files. Works with every provider.

Each tool has metadata in `src/engine/tools/tool-metadata.ts` — `isReadOnly`, `isDestructive`, `acceptEditsApproved`, `concurrencySafe` — from which the permission system derives its read-only and accept-edits tool sets, and the concurrency scheduler decides what can run in parallel. It is an internal registry, not a tool agents can call.

### Filesystem scope and command processes

`src/engine/path-policy.ts` canonicalizes explicit file-tool paths, following existing symlinks and resolving the nearest existing parent of new files. Multi-file patches validate every target before writing. Additional file or directory access must be supplied explicitly through `createToolDefinitions` options as `extraPathGrants`, with `read` or `read_write` access; an absolute image path is not itself a grant. Full-disk mode disables containment checks, not canonicalization. Application memory uses a separate state-directory scope.

These path checks are not an OS sandbox: they do not contain arbitrary shell code or eliminate filesystem races. Git worktrees separate changes, not permissions.

`src/engine/process-runner.ts` owns shell processes by run ID. It accepts an abort signal, timeout, and output bound; on cancellation it sends TERM followed by KILL to the Unix process group. Output truncation is reported explicitly. Native Windows execution requires WSL. Adapters must pass their own run ID and signal to get run-scoped cancellation; an omitted ID uses the legacy foreground-bash cancellation scope.

Pass `runId`, `signal`, `scope`, and global-user `sandboxCapabilities` in the fourth argument to `createToolDefinitions`. Reuse the same canonical scope for the run: do not recreate grants from raw paths for each command. Tools bind that scope to `runScopedProcess`; gate callers can use `createScopedCommandRunner` with the same scope and capabilities. Explicit OS setup or teardown failure is non-success, never permission to retry the raw command. The runtime has [documented filesystem and network exceptions](configuration.md#sandboxcapabilities).

Background commands use the same process lifecycle in path/full-disk mode, retain at most 100 KiB of output, and have a 15-minute deadline. OS mode rejects background commands because the singleton sandbox configuration must remain leased for the entire command. Retrieve or cancel a background shell with its owning run ID; run cleanup must await `cleanupScopedBackgroundProcesses(runId)`. Global cleanup is reserved for CLI exit. A Git worktree or a background shell ID does not grant additional permissions.

Attempt finalizers must await dispatched tool promises, not just process exit: a tool may still be writing a file or running hooks after its model stream fails. `createAttemptResources` tracks those promises, aborts failed attempts before draining, and attempts every registered cleanup callback. A cleanup failure remains non-success; retry and final verification must not race the previous attempt's tools. Worker retries retain partial and pre-existing edits rather than restoring a HEAD snapshot that cannot distinguish user work.

### Browser and HTTP ownership

`createBrowserRunResources({ runId, workspace, signal })` gives each model turn a private Chrome profile and DevTools endpoint. Await `dispose()` in the owner's finalizer; `close()` alone permits reopening within that turn. Explicit `/browser` controls own a separate session. Parent cancellation rejects pending CDP requests and closes only its own process group. Discovery and CDP responses have deadlines and size bounds. Cleanup failures retain ownership for inspection and are reported by the awaited finalizer. Linux Chrome under WSL uses this Unix lifecycle; Windows `.exe` Chrome is rejected. Browser automation is not OS-sandbox containment.

Network-tool deadlines cover headers and response bodies. `fetch` buffers at most 512 KiB; web search and ticket API responses at most 1 MiB. Downloads stream at most 100 MiB within two minutes, use a private temporary file beside the destination, and publish only after the full response succeeds. Cancellation or failure preserves an existing destination and removes the owned temporary file. Ticket operations use instance-local credential snapshots; cancellation prevents subsequent requests but cannot undo a remote mutation already accepted by a service.

### Child agents and recovering their work

An isolated `sub_agent` gets a unique branch and checkout beneath `.workermill/worktrees/`. It inherits the parent's permission restrictions and cancellation signal, but has its own run ID and tool closures. A full-disk parent does not give a child full-disk access. Non-isolated children are read-only; children cannot spawn further children. The default child limit is 20 steps (configurable from 1 to 50), with a five-minute deadline.

Child command processes are stopped, and dispatched tool calls are awaited before inspecting the checkout. Git inspection runs through the child's selected process boundary because Git clean filters can execute code; inspection has a five-second bound. Failed or cancelled children skip Git inspection and preserve their checkout. Dirty, committed-only, or uninspectable work is also preserved. Automatic removal is limited to successful checkouts confirmed to have no changes or new commits. The result reports the branch and worktree path; it does not automatically merge child work into the parent.

To inspect a preserved result, use its reported path with `git -C <child-path> status`, `git -C <child-path> log -1`, and `git -C <child-path> diff`. Review and commit any uncommitted work there before selectively cherry-picking its commits into your target branch. Remove the worktree and branch only after deciding that their contents are no longer needed.

OS-mode children run shell and registered Git commands through the OS boundary. Git commits require narrow write access to the child's administrative directory, its unique branch/log namespace, and the **shared Git object store**. The parent checkout, Git configuration, hooks, and unrelated refs are not write grants. Because the object store is shared, this is not complete Git-metadata isolation; use a separate repository copy for hostile workloads requiring that guarantee. Path-only mode checks explicit tool paths but cannot contain arbitrary shell code.

## MCP (Model Context Protocol)

The CLI auto-detects MCP servers from:

- `mcp` section in `~/.workermill/cli.json`
- Docker Desktop's MCP gateway (if installed and running)

MCP tools are namespaced as `mcp__<server>__<tool>` and appear alongside built-in tools. Tool schemas are sanitized on registration — the CLI forces `type: "object"` on any schema that omits it (required by Anthropic's API).

For run-scoped adapters, `createMCPRunResources({ runId, workspace, signal })` owns a separate server collection. Register configuration and await `ensureStarted()` for lazy startup, or await `startAll()` directly; get tools from that instance and always await its idempotent `close()` in cleanup. Closing one instance does not stop another instance's same-named server. Startup and requests have deadlines, stdio response buffering is bounded, and close reports teardown failures. The legacy global functions remain for callers awaiting migration; `stopAllMCPServers()` is emergency CLI-exit cleanup, not a run finalizer. MCP server subprocesses are not thereby placed inside the tool OS sandbox.

Language-server resources follow the same ownership rule. The tool registry lazily creates an LSP instance for its run ID, canonical workspace, and abort signal. Adapters must await `shutdownLSPRun(runId)` to close every instance created by that run, including hidden registry instances; an explicitly acquired `createLSPRunResources(...)` also exposes `close()`. Global `lsp.shutdown()` is emergency CLI-exit cleanup. LSP subprocesses are not placed inside the tool OS sandbox, and stopping a local client is not a rollback of remote-service side effects.

## Permission System

Four modes, cycled with `Shift+Tab`:

| Mode | Behavior |
|------|----------|
| `default` | Read-only tools are allowed; other tools normally prompt |
| `acceptEdits` | Approve ordinary file edits; shell commands still normally prompt |
| `plan` | Deny mutation even if a write tool is exposed or explicitly allowed |
| `bypassPermissions` | Approve ordinary calls; explicit deny/ask rules and safety checks still apply |

On top of modes, **rule-based permissions** accept pattern matching:

- `bash(git *)` — allow any git subcommand
- `write_file(*.env)` — deny writes to env files
- `read_file(.ssh/*)` — deny reads from ssh directory

Rule matching evaluates deny → ask → allow. An ask rule takes precedence over an allow rule.

In chat, “don't ask again” for a shell command saves a command-family rule, not permission for every shell command. Verification and background commands retain their own command-family scope. These narrow rules remain active for the session if settings cannot be saved. Trust is session-only and cannot override an explicit deny. Concurrent permission requests are shown one at a time; cancellation dismisses the active request and invalidates its response.

### Adding a tool execution entry point

Use `decideToolPermission` from `src/engine/tool-policy.ts` for decisions and `executeToolCall` from `src/engine/tool-executor.ts` to execute an authorized call. Supply a per-run context with a canonical `PathScope`, abort signal, current permission-state getter, and optional prompt/hook/checkpoint callbacks. Keep UI and model-stream concerns in the caller; shared policy must not import React at runtime.

The executor checks permission and cancellation before callbacks. Authorized calls run the pre-hook before checkpointing and mutation, then post-hook and completion callbacks, releasing the workspace mutation lock even on errors. A denied call invokes none of those callbacks. Without a prompt callback, an ask decision throws `ToolExecutionError` with code `permission_required`; it never assumes approval. Tool closures must propagate the same signal to subprocesses and other cancellable operations.

Prompt, pre-hook, checkpoint, post-hook, and event callbacks receive the executing `ToolExecutionContext` as their final argument. Resolve paths and hook working directories from that argument, not a captured parent directory: the same callbacks can serve an isolated child with a different workspace and run ID.

Do not copy the decision table into new adapters or wrap already-governed tools repeatedly. Deferred and MCP tools need the same boundary as built-ins; unknown tools are not assumed read-only. See `tool-policy.test.ts` and `tool-executor.test.ts` for executable contract examples.

Planner and reviewer tool contexts are read-only, even if a custom persona lists write, shell, or child-agent tools. Revision workers use ordinary mutating-worker permissions: an explicit deny still wins over session trust. Each review attempt and revision has its own run ID, and its tool context shares the model attempt's timeout signal. A cancelled attempt cannot use its tools to continue writing. This policy boundary does not establish that the review is correct or that later repository changes remain verified.

## Context Management

Long conversations hit context window limits. Three layers of compaction run automatically:

1. **Micro-compaction** (no model call) — truncates old tool output at 50% context usage
2. **LLM summarization** — summarizes older messages when micro-compaction isn't enough
3. **Hard truncation** — drops oldest messages if summarization fails

Before any compaction, the CLI scans message history for `::learning::` and `::remember::` markers and persists them to the current project's memory directory under `~/.workermill/projects/<project-id>/memories/` so the agent's discoveries aren't lost.

Chat and manual compaction share one active-operation controller. Pass its signal to summarization, reject late results after cancellation, and keep the conversation unchanged on cancellation. A mounted chat session removes its exit listener and aborts its current operation on unmount. These contracts are exercised by `useAgent-runtime.test.ts` and `compaction.test.ts`.

## Safety

- **Dangerous command detection** — shared policy requires confirmation for destructive patterns even in trust mode; headless execution returns `permission_required`
- **Sensitive file detection** — shared policy asks before sensitive writes, including `.env`, `.ssh/`, and Git configuration; explicit deny rules still win
- **Rate limit handling** — detects HTTP 429 from any provider, extracts `retry-after`, retries up to 3 times with a visible countdown
- **Tool call loop detection** — aborts the model early if it repeats the same tool call 4+ times in a 6-call window

## Session Persistence

Sessions save to `~/.workermill/projects/<project-id>/sessions/<id>.json` after every turn. Resume with `wm --resume`. The CLI tracks the working directory, model state, and full message history. Manage sessions from the command line with `wm session list`, `wm session show <id>`, and `wm session delete <id>`.

## Hooks

Pre- and post-tool hooks run shell commands or HTTP requests around tool execution. Configured in `~/.workermill/cli.json` under `hooks`. Pre-hooks can block tool execution by returning a non-zero exit code. Post-hooks can add feedback to the conversation.

## Costs & Tokens

`CostTracker` reports recorded model usage and estimated per-role costs via `/cost` and the status bar. Pricing data lives in `src/providers/*/pricing.ts`. These figures are not provider invoices or a complete billing ledger; missing usage and unknown pricing must not be interpreted as free execution.

## What the CLI Is Not

- Not a hosted service — no persistent WorkerMill daemon is required; a CLI run can still start subprocesses, MCP servers, and optional live-view services
- Not a SaaS — no account, no cloud sync, no telemetry
- Not an IDE plugin — it's a terminal-native tool
