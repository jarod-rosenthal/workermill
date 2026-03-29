/**
 * Remote Agent Planner
 *
 * Fetches the planning prompt from the cloud API, runs it through
 * Claude CLI locally (using the customer's Claude Max subscription),
 * validates with a Planner-Critic loop, and posts the approved plan
 * back for server-side processing.
 *
 * Guardrails (matching server-side planning pipeline):
 *   1. File cap: max targetFiles per story, synced from server (prevents scope explosion)
 *   2. Critic validation: LLM scores the plan, rejects below 85/100
 *   3. Max 3 Planner-Critic iterations before failure
 *
 * Logs are streamed to the cloud dashboard in real-time so the user
 * sees the same planning progress as cloud mode.
 */

import chalk from "chalk";

import { spawn, execFileSync } from "child_process";
import { tmpdir } from "os";
import { readFileSync, rmSync, existsSync } from "fs";
import { findClaudePath, type AgentConfig } from "./config.js";
import { api } from "./api.js";
import {
  parseExecutionPlan,
  applyFileCap,
  applyStoryCap,
  resolveFileOverlaps,
  fixInvalidPersonas,
  serializePlan,
  runCriticValidation,
  formatCriticFeedback,
  formatRefinementFeedback,
  stripFalsePersonaRisks,
  getCriticConfig,
  setCriticApprovalThreshold,
  AUTO_APPROVAL_THRESHOLD,
  SIMPLIFIED_FLOOR,
  type ExecutionPlan,
} from "./plan-validator.js";
import { generateText, type AIProvider } from "./providers.js";
import { generateTextWithTools } from "./ai-sdk-generate.js";
import type { ClaimCredentials } from "./spawner.js";
import { reportDiagnostic } from "./poller.js";

// ============================================================================
// TOKEN USAGE HELPERS (mirrors worker/epic/agent-sdk.ts patterns)
// ============================================================================

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/**
 * Extract token usage from a stream-json event.
 * Claude reports cumulative tokens, so we use Math.max to track the highest values.
 */
function extractTokenUsage(event: Record<string, unknown>, usage: TokenUsage): void {
  const paths = [
    event.usage,
    (event.message as Record<string, unknown>)?.usage,
    (event.result as Record<string, unknown>)?.usage,
  ];

  for (const u of paths) {
    if (u && typeof u === "object") {
      const d = u as Record<string, unknown>;
      if (typeof d.input_tokens === "number")
        usage.inputTokens = Math.max(usage.inputTokens, d.input_tokens);
      if (typeof d.output_tokens === "number")
        usage.outputTokens = Math.max(usage.outputTokens, d.output_tokens);
      if (typeof d.cache_creation_input_tokens === "number")
        usage.cacheCreationTokens = Math.max(usage.cacheCreationTokens, d.cache_creation_input_tokens);
      if (typeof d.cache_read_input_tokens === "number")
        usage.cacheReadTokens = Math.max(usage.cacheReadTokens, d.cache_read_input_tokens);
    }
  }
}

/**
 * Report partial token usage to the cloud API.
 */
async function reportPlanningUsage(
  taskId: string,
  usage: TokenUsage,
  model: string,
  mode: "add" | "greatest",
): Promise<void> {
  if (usage.inputTokens === 0 && usage.outputTokens === 0) return;
  try {
    await api.post(`/api/tasks/${taskId}/usage/partial`, {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      cacheReadTokens: usage.cacheReadTokens,
      model,
      mode,
    });
  } catch {
    // Fire and forget
  }
}

export interface PlanningTask {
  id: string;
  summary: string;
  description: string | null;
  githubRepo?: string;
  scmProvider?: string;
}

/** Max Planner-Critic iterations before giving up */
const MAX_ITERATIONS = 3;

/** Max retries for transient CLI/API errors (5xx, timeouts) within a single planning attempt */
const MAX_CLI_RETRIES = 2;

/** Check if an error message indicates a transient/retryable failure */
function isTransientError(errMsg: string): boolean {
  const transientPatterns = [
    /5\d{2}/,                  // Any 5xx status code
    /internal server error/i,
    /api_error/i,
    /timeout/i,
    /ETIMEDOUT/i,
    /ECONNRESET/i,
    /ECONNREFUSED/i,
    /socket hang up/i,
    /overloaded/i,
    /rate.?limit/i,
    /too many requests/i,
    /529/,                     // Anthropic overloaded
  ];
  return transientPatterns.some((p) => p.test(errMsg));
}

/** Timestamp prefix */
function ts(): string {
  return chalk.dim(new Date().toLocaleTimeString());
}

/**
 * Log queue — sends entries sequentially instead of N concurrent POSTs.
 * During planning, flushTextBuffer() can fire 15-30 postLog() calls in a burst.
 * Without queuing, those concurrent POSTs saturate the API's DB connection pool
 * (max 10), causing poll timeouts, transient 401s, and multi-second stalls.
 */
const logQueue: Array<{
  taskId: string;
  message: string;
  type: string;
  severity: string;
}> = [];
let logDrainPromise: Promise<void> | null = null;

async function drainLogQueue(): Promise<void> {
  while (logQueue.length > 0) {
    // Drain up to 50 entries per batch POST
    const batch = logQueue.splice(0, 50);
    try {
      await api.post("/api/control-center/logs/batch", { entries: batch }, { timeout: 5_000 });
    } catch {
      // Best-effort — drop on failure
    }
  }
}

/**
 * Post a log message to the cloud dashboard for real-time visibility.
 * Entries are queued and drained sequentially (max 1 in-flight POST).
 */
async function postLog(
  taskId: string,
  message: string,
  type: string = "system",
  severity: string = "info",
): Promise<void> {
  if (logQueue.length >= 200) logQueue.shift(); // drop oldest
  logQueue.push({ taskId, message, type, severity });
  if (!logDrainPromise) {
    logDrainPromise = drainLogQueue().finally(() => {
      logDrainPromise = null;
    });
  }
}

/**
 * Flush remaining log entries (call before cleanup).
 */
async function flushLogQueue(): Promise<void> {
  if (logDrainPromise) await logDrainPromise;
  if (logQueue.length > 0) {
    logDrainPromise = drainLogQueue().finally(() => {
      logDrainPromise = null;
    });
    await logDrainPromise;
  }
}

/**
 * Post planning progress to the cloud API for SSE relay to the dashboard.
 * This drives the animated progress bar (PlanningTerminalBar) in the frontend.
 */
async function postProgress(
  taskId: string,
  phase: PlanningPhase,
  elapsedSeconds: number,
  detail: string,
  charsGenerated: number,
  toolCallCount: number,
): Promise<void> {
  try {
    await api.post("/api/agent/planning-progress", {
      taskId,
      phase,
      elapsedSeconds,
      detail,
      charsGenerated,
      toolCallCount,
    });
  } catch {
    // Fire and forget
  }
}

type PlanningPhase = "initializing" | "reading_repo" | "analyzing" | "generating_plan" | "validating" | "complete";

/** Consistent prefix matching local workermill dashboard format */
const PREFIX = "[💡 planning_agent 🤖]";

/** Format elapsed seconds as human-readable string (e.g. "28s", "1m 25s") */
function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function phaseLabel(phase: PlanningPhase, elapsed: number): string {
  switch (phase) {
    case "initializing": return `${PREFIX} Starting planning agent...`;
    case "reading_repo": return `${PREFIX} Reading repository structure...`;
    case "analyzing": return `${PREFIX} Analyzing requirements...`;
    case "generating_plan": return `${PREFIX} Planning in progress — analyzing requirements and decomposing into steps (${formatElapsed(elapsed)} elapsed)`;
    case "validating": return `${PREFIX} Validating plan...`;
    case "complete": return `${PREFIX} Planning complete`;
  }
}

/**
 * Build a grounding prompt for the agent-side grounding pass.
 * Tells the LLM to resolve targetFilePatterns against the repo and emit ExecutionPlan JSON.
 */
function buildGroundingPromptLocal(
  task: PlanningTask,
  preComputedStories: Array<{ id: string; title: string; description: string; persona: string; priority: number; estimatedEffort: string; dependencies: string[]; targetFilePatterns: string[] }>,
  maxStories: number,
): string {
  const storiesJson = JSON.stringify(preComputedStories, null, 2);

  return `You are a grounding agent. The planning phase has already been completed by the decomposer.
Your ONLY job is to resolve file path patterns against the real repository and emit a valid ExecutionPlan.

## Task
**Title:** ${task.summary}
**Description:**
${task.description || "No description provided."}

## Pre-Computed Stories
The decomposer produced these stories with glob-style \`targetFilePatterns\`.
Resolve each pattern against the actual repository files using your tools (glob, grep, ls).

\`\`\`json
${storiesJson}
\`\`\`

## Instructions
1. For each story, use file search tools to resolve \`targetFilePatterns\` into actual file paths that exist (or will be created).
2. If a pattern matches nothing (new files to create), keep the pattern as-is — the worker will create it.
3. If a pattern is too broad (matches 20+ files), narrow it to the most relevant files (max ${Math.max(5, Math.ceil(maxStories / 2))} files per story).
4. Preserve the story structure exactly — do NOT add, remove, or reorder stories.
5. Map \`dependencies\` as-is (they reference story IDs like "story-0").

## Output Format
Emit ONLY a JSON block (wrapped in \`\`\`json fences) with this exact structure:

\`\`\`json
{
  "summary": "Grounded execution plan for: ${task.summary}",
  "stories": [
    {
      "id": "story-1",
      "title": "...",
      "description": "...",
      "persona": "...",
      "priority": 1,
      "estimatedEffort": "small|medium|large",
      "dependencies": ["story-0"],
      "targetFiles": ["actual/resolved/path.ts", "another/file.go"],
      "scope": "brief scope description"
    }
  ],
  "risks": [],
  "assumptions": []
}
\`\`\`

IMPORTANT:
- Story IDs must be "story-1", "story-2", etc. (1-indexed).
- \`targetFiles\` replaces \`targetFilePatterns\` with resolved paths.
- \`scope\` should be a brief (1-line) summary of the story's scope.
- Do NOT change titles, descriptions, personas, priorities, effort estimates, or dependencies.
- Do NOT add risks or assumptions — leave them as empty arrays.
- Do NOT include any text outside the JSON block.`;
}

/**
 * Run Claude CLI with stream-json output, posting real-time phase milestones
 * to the cloud dashboard — identical terminal experience to cloud planning.
 */
function runClaudeCli(
  claudePath: string,
  model: string,
  prompt: string,
  env: Record<string, string | undefined>,
  taskId: string,
  startTime: number,
  cwd?: string,
  extraArgs?: string[],
): Promise<string> {
  const taskLabel = chalk.cyan(taskId.slice(0, 8));

  return new Promise((resolve, reject) => {
    const cliArgs = [
        "--print",
        "--verbose",
        "--output-format", "stream-json",
        "--model", model,
        "--permission-mode", "bypassPermissions",
        "--strict-mcp-config",
        ...(extraArgs || []),
      ];

    const proc = spawn(
      claudePath,
      cliArgs,
      {
        cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );

    proc.stdin.write(prompt);
    proc.stdin.end();

    let fullText = "";
    let resultText = "";
    let stderrOutput = "";
    let charsReceived = 0;
    let toolCallCount = 0;
    let lastToolLogAt = 0;

    // Token usage accumulator — extract from stream events using Math.max
    const tokenUsage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
    let resultModel = model;

    // Buffered text streaming — flush complete lines to dashboard every 1s.
    // LLM deltas are tiny fragments; we accumulate until we see '\n', then
    // a 1s interval flushes all complete lines as log entries.  On exit we
    // flush whatever remains (including any incomplete trailing line).
    let textBuffer = "";

    function flushTextBuffer(final = false): void {
      if (!textBuffer) return;
      const parts = textBuffer.split("\n");
      // Keep the incomplete trailing fragment unless this is the final flush
      const incomplete = final ? "" : (parts.pop() || "");
      for (const line of parts) {
        if (line.trim()) {
          postLog(taskId, `${PREFIX} ${line}`, "output");
          // Echo planner thoughts to local terminal
          const truncated = line.trim().length > 160 ? line.trim().substring(0, 160) + "…" : line.trim();
          console.log(`${ts()} ${taskLabel} ${chalk.dim("💭")} ${chalk.dim(truncated)}`);
        }
      }
      textBuffer = incomplete;
    }

    // Phase detection state
    let currentPhase: PlanningPhase = "initializing";
    let firstTextSeen = false;
    const milestoneSent = { started: true, reading: false, analyzing: false, generating: false };

    // Post milestone when phase transitions (to dashboard terminal)
    function transitionPhase(newPhase: PlanningPhase): void {
      if (newPhase === currentPhase) return;
      currentPhase = newPhase;
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const msg = phaseLabel(newPhase, elapsed);
      postLog(taskId, msg);
      console.log(`${ts()} ${taskLabel} ${chalk.dim(msg)}`);
    }

    // Flush buffered LLM text to dashboard every 1s (complete lines only)
    const textFlushInterval = setInterval(() => flushTextBuffer(), 2_000);

    // SSE progress updates every 2s — drives PlanningTerminalBar in dashboard
    // (same cadence as local dev's progressInterval in planning-agent-local.ts)
    const sseProgressInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      postProgress(taskId, currentPhase, elapsed, phaseLabel(currentPhase, elapsed), charsReceived, toolCallCount);
    }, 3_000);

    // Phase transition logs + periodic DB logs (every 30s during generation)
    let lastProgressLogAt = 0;
    let lastHeartbeatAt = 0;
    const progressInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      // Time-based phase fallback (in case stream events are sparse)
      if (currentPhase === "initializing" && elapsed >= 5) {
        transitionPhase("reading_repo");
      } else if (currentPhase === "reading_repo" && elapsed >= 15 && !firstTextSeen) {
        transitionPhase("analyzing");
      }

      // Heartbeat during silent phases so the dashboard shows life
      if (currentPhase === "reading_repo" && elapsed - lastHeartbeatAt >= 15) {
        lastHeartbeatAt = elapsed;
        const msg = `${PREFIX} Exploring codebase (${toolCallCount} files examined, ${formatElapsed(elapsed)})`;
        postLog(taskId, msg);
        console.log(`${ts()} ${taskLabel} ${chalk.dim(msg)}`);
      }
      if (currentPhase === "analyzing" && elapsed - lastHeartbeatAt >= 15) {
        lastHeartbeatAt = elapsed;
        const msg = `${PREFIX} Analyzing architecture and dependencies (${formatElapsed(elapsed)})`;
        postLog(taskId, msg);
        console.log(`${ts()} ${taskLabel} ${chalk.dim(msg)}`);
      }

      // Periodic progress during generation
      if (currentPhase === "generating_plan" && elapsed - lastProgressLogAt >= 30) {
        lastProgressLogAt = elapsed;
        const msg = `${PREFIX} Planning in progress — analyzing requirements and decomposing into steps (${formatElapsed(elapsed)} elapsed)`;
        postLog(taskId, msg);
        console.log(`${ts()} ${taskLabel} ${chalk.dim(msg)}`);
      }
    }, 5_000);

    // Parse streaming JSON lines from Claude CLI
    let lineBuffer = "";

    proc.stdout.on("data", (data: Buffer) => {
      lineBuffer += data.toString();

      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const event = JSON.parse(trimmed);

          // Claude CLI stream-json wraps content in assistant message events
          if (event.type === "assistant" && event.message?.content) {
            const content = event.message.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === "text" && block.text) {
                  fullText += block.text;
                  charsReceived += block.text.length;
                  textBuffer += block.text;

                  if (!firstTextSeen) {
                    firstTextSeen = true;
                    if (toolCallCount > 0 && !milestoneSent.analyzing) {
                      transitionPhase("analyzing");
                      milestoneSent.analyzing = true;
                    }
                  }

                  if (charsReceived > 500 && !milestoneSent.generating) {
                    transitionPhase("generating_plan");
                    milestoneSent.generating = true;
                    lastProgressLogAt = Math.round((Date.now() - startTime) / 1000);
                  }
                } else if (block.type === "tool_use") {
                  toolCallCount++;
                  if (!milestoneSent.reading) {
                    transitionPhase("reading_repo");
                    milestoneSent.reading = true;
                  }
                  // Surface tool call names so the dashboard shows what the planner is doing
                  const toolName = block.name || "";
                  const now = Date.now();
                  if (now - lastToolLogAt >= 15_000) {
                    lastToolLogAt = now;
                    const toolMsg = toolName === "Read" ? "Reading file..."
                      : toolName === "Glob" ? "Searching files..."
                      : toolName === "Grep" || toolName === "Search" ? "Searching codebase..."
                      : toolName === "LS" || toolName === "ListDirectory" ? "Listing directory..."
                      : toolName === "Bash" ? "Running command..."
                      : `Exploring codebase (tool #${toolCallCount})...`;
                    postLog(taskId, `${PREFIX} ${toolMsg}`);
                    console.log(`${ts()} ${taskLabel} ${chalk.dim(`🔍 ${toolMsg}`)}`);
                  }
                }
              }
            } else if (typeof content === "string" && content) {
              fullText += content;
              charsReceived += content.length;
              textBuffer += content;
            }
          } else if (event.type === "content_block_delta" && event.delta?.text) {
            // Fallback: raw API streaming format
            fullText += event.delta.text;
            charsReceived += event.delta.text.length;
            textBuffer += event.delta.text;

            if (!firstTextSeen) {
              firstTextSeen = true;
              if (toolCallCount > 0 && !milestoneSent.analyzing) {
                transitionPhase("analyzing");
                milestoneSent.analyzing = true;
              }
            }

            if (charsReceived > 500 && !milestoneSent.generating) {
              transitionPhase("generating_plan");
              milestoneSent.generating = true;
              lastProgressLogAt = Math.round((Date.now() - startTime) / 1000);
            }
          } else if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
            toolCallCount++;
            if (!milestoneSent.reading) {
              transitionPhase("reading_repo");
              milestoneSent.reading = true;
            }
            // Surface tool call names so the dashboard shows what the planner is doing
            const toolName = event.content_block?.name || event.content_block?.tool_name || "";
            const now = Date.now();
            if (now - lastToolLogAt >= 15_000) {
              lastToolLogAt = now;
              const toolMsg = toolName === "Read" ? "Reading file..."
                : toolName === "Glob" ? "Searching files..."
                : toolName === "Grep" || toolName === "Search" ? "Searching codebase..."
                : toolName === "LS" || toolName === "ListDirectory" ? "Listing directory..."
                : toolName === "Bash" ? "Running command..."
                : `Exploring codebase (tool #${toolCallCount})...`;
              postLog(taskId, `${PREFIX} ${toolMsg}`);
              console.log(`${ts()} ${taskLabel} ${chalk.dim(`🔍 ${toolMsg}`)}`);
            }
          } else if (event.type === "result" && event.result) {
            resultText = typeof event.result === "string" ? event.result : "";
          }

          // Extract token usage from any event that carries it
          extractTokenUsage(event, tokenUsage);
          if (event.type === "result" && event.total_cost_usd !== undefined) {
            // Result event also carries model info
            if (event.modelUsage && typeof event.modelUsage === "object") {
              const models = Object.keys(event.modelUsage as Record<string, unknown>);
              if (models.length > 0) resultModel = models[0];
            }
          }
        } catch {
          // Not valid JSON — raw text, accumulate
          fullText += trimmed + "\n";
          charsReceived += trimmed.length;
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderrOutput += chunk.toString();
    });

    // Report partial token usage every 30s during planning
    const usageReportInterval = setInterval(() => {
      if (tokenUsage.inputTokens > 0 || tokenUsage.outputTokens > 0) {
        reportPlanningUsage(taskId, tokenUsage, resultModel, "greatest").catch(() => {});
      }
    }, 30_000);

    function cleanupAll(): void {
      clearInterval(progressInterval);
      clearInterval(sseProgressInterval);
      clearInterval(textFlushInterval);
      clearInterval(usageReportInterval);
      flushTextBuffer(true);
    }

    const timeout = setTimeout(() => {
      cleanupAll();
      proc.kill("SIGTERM");
      reject(new Error("Claude CLI timed out after 20 minutes"));
    }, 1_200_000);

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      cleanupAll();

      // Emit final "validating" phase to dashboard
      const elapsedAtClose = Math.round((Date.now() - startTime) / 1000);
      postProgress(taskId, "validating", elapsedAtClose, "Validating plan...", charsReceived, toolCallCount);

      // Final usage report
      reportPlanningUsage(taskId, tokenUsage, resultModel, "greatest").catch(() => {});

      if (code !== 0) {
        reject(
          new Error(
            `Claude CLI failed (exit ${code}): ${stderrOutput.substring(0, 300)}`,
          ),
        );
      } else {
        // fullText accumulates text from ALL assistant turns (tool-use conversations
        // produce multiple turns). resultText is ONLY the last text block of the
        // last assistant message (from the stream-json "result" event). When the
        // planner uses tools, the JSON plan is often in an earlier turn — resultText
        // won't contain it. Always prefer fullText which has everything.
        resolve(fullText || resultText);
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      cleanupAll();
      reject(err);
    });
  });
}

/**
 * Resolve the API key for a given provider from claim credentials.
 * For Ollama, returns the base URL instead of an API key.
 */
function resolveProviderApiKey(
  provider: AIProvider,
  credentials?: ClaimCredentials,
): string | undefined {
  if (!credentials) return undefined;
  switch (provider) {
    case "anthropic":
      return credentials.anthropicApiKey;
    case "openai":
      return credentials.openaiApiKey;
    case "google":
      return credentials.googleApiKey;
    case "ollama":
      return credentials.ollamaBaseUrl || "http://localhost:11434";
    default:
      return undefined;
  }
}

/**
 * Build a git clone URL with authentication for the given SCM provider.
 */
function buildCloneUrl(
  repo: string,
  token: string,
  scmProvider: string,
  bitbucketUsername?: string,
): string {
  // If repo is already a full URL, inject auth credentials into it
  if (repo.startsWith("https://") || repo.startsWith("http://")) {
    const url = new URL(repo);
    switch (scmProvider) {
      case "bitbucket":
        url.username = bitbucketUsername || "x-bitbucket-api-token-auth";
        break;
      case "gitlab":
        url.username = "oauth2";
        break;
      case "github":
      default:
        url.username = "x-access-token";
        break;
    }
    url.password = token;
    // Ensure .git suffix
    if (!url.pathname.endsWith(".git")) {
      url.pathname += ".git";
    }
    return url.toString();
  }

  // Short form: owner/repo
  switch (scmProvider) {
    case "bitbucket":
      return `https://${encodeURIComponent(bitbucketUsername || "x-bitbucket-api-token-auth")}:${encodeURIComponent(token)}@bitbucket.org/${repo}.git`;
    case "gitlab":
      return `https://oauth2:${token}@gitlab.com/${repo}.git`;
    case "github":
    default:
      return `https://x-access-token:${token}@github.com/${repo}.git`;
  }
}

// ============================================================================
// WSL + Windows Credential Manager helpers
// ============================================================================

/** Cached WSL detection result */
let _isWSL: boolean | null = null;

/** Detect WSL via /proc/version containing "microsoft" (no subprocess spawn). */
function isWSL(): boolean {
  if (_isWSL !== null) return _isWSL;
  try {
    const procVersion = readFileSync("/proc/version", "utf8");
    _isWSL = /microsoft/i.test(procVersion);
  } catch {
    _isWSL = false;
  }
  return _isWSL;
}

/** Known paths where Windows Git Credential Manager lives. */
const GCM_PATHS = [
  "/mnt/c/Program Files/Git/mingw64/bin/git-credential-manager.exe",
  "/mnt/c/Program Files/Git/mingw64/libexec/git-core/git-credential-manager.exe",
];

/** Find Windows Git Credential Manager executable accessible from WSL. */
function findWindowsGcm(): string | null {
  for (const p of GCM_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

/** Build a plain clone URL (no auth credentials embedded). */
function buildPlainCloneUrl(repo: string, scmProvider: string): string {
  // Already a full URL — strip any embedded credentials and ensure .git suffix
  if (repo.startsWith("https://") || repo.startsWith("http://")) {
    const url = new URL(repo);
    url.username = "";
    url.password = "";
    if (!url.pathname.endsWith(".git")) {
      url.pathname += ".git";
    }
    return url.toString();
  }

  // Short form: owner/repo
  switch (scmProvider) {
    case "bitbucket":
      return `https://bitbucket.org/${repo}.git`;
    case "gitlab":
      return `https://gitlab.com/${repo}.git`;
    case "github":
    default:
      return `https://github.com/${repo}.git`;
  }
}

/**
 * Clone a repo using Windows Credential Manager from WSL.
 * Returns the temp directory path on success, or null on failure.
 */
function cloneWithGcm(
  repo: string,
  scmProvider: string,
  gcmPath: string,
  taskId: string,
): string | null {
  const taskLabel = chalk.cyan(taskId.slice(0, 8));
  const tmpDir = `${tmpdir()}/workermill-planning-${taskId.slice(0, 8)}-${Date.now()}`;
  const plainUrl = buildPlainCloneUrl(repo, scmProvider);

  try {
    console.log(
      `${ts()} ${taskLabel} ${chalk.dim("Cloning repo via Windows Credential Manager...")}`,
    );
    execFileSync(
      "git",
      [
        "-c",
        `credential.helper=${gcmPath}`,
        "clone",
        "--depth",
        "1",
        "--single-branch",
        plainUrl,
        tmpDir,
      ],
      { stdio: ["pipe", "pipe", "pipe"], timeout: 300_000, windowsHide: true },
    );
    console.log(
      `${ts()} ${taskLabel} ${chalk.green("✓")} Repo cloned via Windows credential store`,
    );
    return tmpDir;
  } catch {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    return null;
  }
}

/**
 * Clone the target repo to a temp directory so the planner can explore with tools.
 * Returns the path on success, or null on failure.
 */
async function cloneTargetRepo(
  repo: string,
  token: string,
  scmProvider: string,
  taskId: string,
  bitbucketUsername?: string,
): Promise<string | null> {
  const taskLabel = chalk.cyan(taskId.slice(0, 8));
  const tmpDir = `${tmpdir()}/workermill-planning-${taskId.slice(0, 8)}-${Date.now()}`;

  try {
    const cloneUrl = buildCloneUrl(repo, token, scmProvider, bitbucketUsername);
    // Log repo (redact token) so we can debug clone failures
    const safeUrl = cloneUrl.replace(/\/\/[^@\s]+@/, "//***@");
    console.log(
      `${ts()} ${taskLabel} ${chalk.dim(`Cloning repo for planner: ${safeUrl}`)}`,
    );
    execFileSync("git", ["clone", "--depth", "1", "--single-branch", cloneUrl, tmpDir], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 300_000,
      windowsHide: true,
    });
    console.log(
      `${ts()} ${taskLabel} ${chalk.green("✓")} Repo cloned to ${chalk.dim(tmpDir)}`,
    );
    return tmpDir;
  } catch (error) {
    // Extract stderr from the git process for the real error
    const stderr = (error as { stderr?: Buffer })?.stderr?.toString()?.trim() || "";
    const errMsg = error instanceof Error ? error.message : String(error);
    const detail = stderr || errMsg;
    // Redact tokens from error output
    const safeDetail = detail.replace(/ghp_[A-Za-z0-9]+/g, "ghp_***").replace(/ghs_[A-Za-z0-9]+/g, "ghs_***").replace(/x-token-auth:[^@]+/g, "x-token-auth:***");
    console.error(
      `${ts()} ${taskLabel} ${chalk.yellow("⚠")} Clone failed, planner will run without repo access: ${safeDetail.substring(0, 300)}`,
    );
    reportDiagnostic("warn", "planner", `Repo clone failed: ${safeDetail.substring(0, 200)}`);
    // Cleanup partial clone
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }

    // On WSL, retry without embedded token using Windows Credential Manager
    if (isWSL()) {
      const gcmPath = findWindowsGcm();
      if (gcmPath) {
        const gcmResult = cloneWithGcm(repo, scmProvider, gcmPath, taskId);
        if (gcmResult) return gcmResult;
      }
    }

    return null;
  }
}

/**
 * Apply mechanical post-processing fixes to a plan after critic approval.
 * These fixes enforce hard limits (file cap, overlaps, personas) that the
 * planner should have respected but might not have. Running them AFTER the
 * critic means the critic sees the planner's actual output and gives useful
 * feedback about structural issues, rather than scoring a mutated plan.
 */
function applyMechanicalFixes(
  plan: ExecutionPlan,
  validPersonas: string[],
  taskLabel: string,
  criticConfig: { maxTargetFiles: number } | null,
): void {
  const { truncatedCount, details } = applyFileCap(plan);
  if (truncatedCount > 0) {
    const msg = `File guideline: ${truncatedCount} stories exceed recommended ${criticConfig?.maxTargetFiles ?? 15} targetFiles (not truncated)`;
    console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} ${msg}`);
    for (const detail of details) {
      console.log(`${ts()} ${taskLabel}   ${chalk.dim(detail)}`);
    }
  }

  const { resolvedCount: overlapCount, details: overlapDetails } = resolveFileOverlaps(plan);
  if (overlapCount > 0) {
    const msg = `File overlap resolved: ${overlapCount} shared file(s) de-duped across stories`;
    console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} ${msg}`);
    for (const detail of overlapDetails) {
      console.log(`${ts()} ${taskLabel}   ${chalk.dim(detail)}`);
    }
  }

  const { fixedCount: personaFixCount, details: personaFixDetails } = fixInvalidPersonas(plan, validPersonas);
  if (personaFixCount > 0) {
    const msg = `Persona fix: ${personaFixCount} invalid persona(s) replaced with "backend_developer"`;
    console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} ${msg}`);
    for (const detail of personaFixDetails) {
      console.log(`${ts()} ${taskLabel}   ${chalk.dim(detail)}`);
    }
  }
}

/**
 * Run planning for a task with Planner-Critic validation loop.
 *
 * Flow:
 *   1. Fetch planning prompt from cloud API
 *   2. Clone target repo (if available) so planner can explore with tools
 *   3. Run Claude CLI to generate plan
 *   4. Run critic validation on RAW plan (before mechanical fixes)
 *   5. If critic approves: apply mechanical fixes (file cap, overlaps, personas), then post
 *   6. If critic rejects: re-run planner with feedback (up to MAX_ITERATIONS)
 *   7. After MAX_ITERATIONS without approval: post best plan if score >= 50 (fallback)
 *   8. If no plan scored >= 50: fail the task
 */
export async function planTask(
  task: PlanningTask,
  config: AgentConfig,
  credentials?: ClaimCredentials,
): Promise<boolean> {
  const taskLabel = chalk.cyan(task.id.slice(0, 8));

  const repoLabel = task.githubRepo ? ` for ${task.githubRepo}` : "";
  console.log(`${ts()} ${taskLabel} Fetching planning prompt${repoLabel}...`);
  await postLog(task.id, `${PREFIX} Fetching planning prompt${repoLabel}...`);

  // 1. Fetch the assembled planning prompt from the cloud API
  let promptResponse;
  try {
    promptResponse = await api.get("/api/agent/planning-prompt", {
      params: { taskId: task.id },
    });
  } catch (fetchErr: unknown) {
    const axiosErr = fetchErr as { response?: { status?: number; data?: { error?: string; detail?: string } } };
    if (axiosErr.response?.status === 422) {
      // Task has no requirements — escalate instead of failing
      const reason = axiosErr.response.data?.error || "Task has no requirements";
      const detail = axiosErr.response.data?.detail || "";
      const msg = `${PREFIX} ${reason}${detail ? ` — ${detail}` : ""}`;
      console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} ${msg}`);
      await postLog(task.id, msg);
      try {
        await api.post("/api/agent/plan-failed", {
          taskId: task.id,
          agentId: config.agentId,
          reason,
          status: "escalated",
        });
      } catch { /* best effort */ }
      return false;
    }
    throw fetchErr;
  }
  const { prompt: basePrompt, model, provider: planningProvider, maxStories: apiMaxStories, storyCap: apiStoryCap, maxTargetFiles: apiMaxTargetFiles, planningMode: apiPlanningMode, validPersonas: apiValidPersonas, preComputedStories: apiPreComputedStories, criticApprovalThreshold: apiCriticThreshold } = promptResponse.data;
  const validPersonas: string[] = Array.isArray(apiValidPersonas) ? apiValidPersonas : [];
  const isSimplifiedMode = apiPlanningMode === "simplified";
  if (isSimplifiedMode) {
    console.log(`${ts()} ${taskLabel} Planning mode: ${chalk.yellow("simplified")} (single pass + refinement)`);
    await postLog(task.id, `${PREFIX} Planning mode: simplified — critic feedback will be incorporated but never blocks`);
  }
  const maxStories: number = typeof apiMaxStories === "number" ? apiMaxStories : 8;
  // storyCap: higher truncation ceiling for PRD tasks (separate from prompt hint)
  const storyCap: number = typeof apiStoryCap === "number" ? apiStoryCap : maxStories;

  const cliModel = model;
  const provider: AIProvider = (planningProvider || "anthropic") as AIProvider;
  const isAnthropicPlanning = provider === "anthropic";
  const claudePath =
    process.env.CLAUDE_CLI_PATH || findClaudePath() || "claude";

  const cleanEnv = { ...process.env };
  // Strip all Claude Code session vars — if the agent was started from within
  // a Claude Code terminal, these trigger the nested-session guard and the
  // spawned CLI refuses to start.
  delete cleanEnv.CLAUDE_CODE_OAUTH_TOKEN;
  delete cleanEnv.CLAUDECODE;
  delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;

  // Resolve provider API key for non-Anthropic planning
  const providerApiKey = resolveProviderApiKey(provider, credentials);

  const startTime = Date.now();

  // PRD for critic validation: use task description, fall back to summary
  const prd = task.description || task.summary;

  // Clone target repo so the planner can explore with tools
  let repoPath: string | null = null;

  if (task.githubRepo) {
    const scmProvider = task.scmProvider || "github";
    const scmToken =
      scmProvider === "bitbucket"
        ? credentials?.scmToken || config.bitbucketToken
        : scmProvider === "gitlab"
          ? credentials?.scmToken || config.gitlabToken
          : credentials?.githubToken || config.githubToken;

    if (scmToken) {
      const bbUsername = scmProvider === "bitbucket"
        ? "x-bitbucket-api-token-auth"
        : undefined;
      repoPath = await cloneTargetRepo(
        task.githubRepo,
        scmToken,
        scmProvider,
        task.id,
        bbUsername,
      );
      if (!repoPath) {
        // Clone failed — treat as planning failure instead of producing a low-quality plan
        const failMsg = `Failed to clone repository ${task.githubRepo} (${scmProvider}). Cannot plan without repo access.`;
        console.error(`${ts()} ${taskLabel} ${chalk.red("✗")} ${failMsg}`);
        await postLog(task.id, `${PREFIX} ${failMsg}`, "error", "error");
        try {
          await api.post("/api/agent/plan-failed", {
            taskId: task.id,
            agentId: config.agentId,
            reason: failMsg,
          });
        } catch { /* best effort */ }
        return false;
      }
    } else {
      // No SCM token — on WSL, try Windows Credential Manager directly
      if (isWSL()) {
        const gcmPath = findWindowsGcm();
        if (gcmPath) {
          repoPath = cloneWithGcm(task.githubRepo, scmProvider, gcmPath, task.id);
        }
      }
      if (!repoPath) {
        console.log(
          `${ts()} ${taskLabel} ${chalk.yellow("⚠")} No SCM token for ${scmProvider}, planner will run without repo access`,
        );
      }
    }
  }

  // 1b. Grounding pass — if decomposer provided pre-computed stories, skip the
  //     full planner-critic loop and just resolve targetFilePatterns against the real repo.
  const preComputedStories = Array.isArray(apiPreComputedStories) && apiPreComputedStories.length > 0
    ? apiPreComputedStories
    : null;

  if (preComputedStories && repoPath) {
    console.log(`${ts()} ${taskLabel} ${chalk.magenta("⚡")} Decomposer-planned mode: ${preComputedStories.length} pre-computed stories — running grounding pass`);
    await postLog(task.id, `${PREFIX} Decomposer-planned mode: ${preComputedStories.length} pre-computed stories. Running fast grounding pass instead of full planning.`);

    try {
      const groundingPrompt = buildGroundingPromptLocal(task, preComputedStories, maxStories);
      const providerLabel = `${provider}/${cliModel}`;
      console.log(`${ts()} ${taskLabel} Running grounding pass ${chalk.dim(`(${chalk.yellow(providerLabel)})`)}`);
      await postLog(task.id, `${PREFIX} Grounding pass: resolving file patterns against repo using ${providerLabel}`);

      let groundingOutput: string;
      if (isAnthropicPlanning) {
        groundingOutput = await runClaudeCli(
          claudePath,
          cliModel,
          groundingPrompt,
          cleanEnv,
          task.id,
          startTime,
          repoPath,
        );
      } else {
        // Non-Anthropic providers: use AI SDK with tools
        groundingOutput = await generateTextWithTools({
          provider,
          model: cliModel,
          apiKey: providerApiKey || "",
          prompt: groundingPrompt,
          workingDir: repoPath,
        });
      }

      // Parse the grounding output as ExecutionPlan
      const groundedPlan = parseExecutionPlan(groundingOutput);

      // Apply guardrails
      applyFileCap(groundedPlan);
      applyStoryCap(groundedPlan, storyCap);
      resolveFileOverlaps(groundedPlan);
      if (validPersonas.length > 0) {
        fixInvalidPersonas(groundedPlan, validPersonas);
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`${ts()} ${taskLabel} ${chalk.green("✓")} Grounding pass complete in ${elapsed}s — posting plan`);
      await postLog(task.id, `${PREFIX} Grounding pass complete (${elapsed}s). Posting plan.`);

      const posted = await postValidatedPlan(
        task.id,
        groundedPlan,
        config.agentId,
        taskLabel,
        elapsed,
        undefined,
        undefined,
        [],
        0,
        (Date.now() - startTime),
        0,
      );

      // Clean up cloned repo
      if (repoPath) {
        try { rmSync(repoPath, { recursive: true, force: true }); } catch { /* best effort */ }
      }

      return posted;
    } catch (groundErr: unknown) {
      // Grounding failed — fall back to full planner-critic loop
      const errMsg = groundErr instanceof Error ? groundErr.message : String(groundErr);
      console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} Grounding pass failed: ${errMsg.substring(0, 120)}`);
      await postLog(task.id, `${PREFIX} ⚠️ Grounding pass failed: ${errMsg.substring(0, 120)}. Falling back to full planning.`, "warning");
    }
  } else if (preComputedStories && !repoPath) {
    console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} Pre-computed stories present but no repo clone — falling back to full planning`);
    await postLog(task.id, `${PREFIX} ⚠️ Pre-computed stories available but repo clone failed. Falling back to full planning.`, "warning");
  }

  // 2. Planner-Critic iteration loop
  let currentPrompt = basePrompt;
  let bestPlan: ExecutionPlan | null = null;
  let bestScore = 0;

  // Track critic history across iterations for analytics
  const criticHistory: Array<{
    iteration: number;
    score: number;
    approved: boolean;
    risks: string[];
    suggestions?: string[];
    filesCapApplied?: number;
  }> = [];
  let totalFileCapTruncations = 0;

  // Pre-fetch critic config so applyFileCap and thresholds use server values from the start
  const criticConfig = await getCriticConfig(typeof apiMaxTargetFiles === "number" ? apiMaxTargetFiles : undefined);
  if (!criticConfig) {
    console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} Could not fetch critic config — critic validation will be skipped`);
    await postLog(task.id, `${PREFIX} ⚠️ Could not fetch critic config from API — critic validation will be skipped`);
  }

  // Apply local/org threshold override if provided
  if (typeof apiCriticThreshold === "number" && apiCriticThreshold >= 50 && apiCriticThreshold <= 100) {
    setCriticApprovalThreshold(apiCriticThreshold);
  }

  try {
  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    const iterLabel = MAX_ITERATIONS > 1 ? ` (attempt ${iteration}/${MAX_ITERATIONS})` : "";

    const providerLabel = `${provider}/${cliModel}`;
    if (iteration > 1) {
      console.log(`${ts()} ${taskLabel} Running planner${iterLabel} ${chalk.dim(`(${chalk.yellow(providerLabel)})`)}`);
      await postLog(task.id, `${PREFIX} Re-planning${iterLabel} using ${providerLabel}`);
    } else {
      console.log(`${ts()} ${taskLabel} Running planner ${chalk.dim(`(${chalk.yellow(providerLabel)})`)}`);
      await postLog(task.id, `${PREFIX} Starting planning agent${repoLabel} using ${providerLabel}`);
    }

    // 2a. Generate plan via Claude CLI (Anthropic) or HTTP API (other providers)
    // Give repo access on ALL iterations so the planner can verify file paths
    // when addressing critic feedback. The critic feedback template already tells
    // the planner to keep tool usage minimal.
    const iterationCwd = repoPath || undefined;

    let rawOutput!: string;
    let cliSuccess = false;
    for (let cliAttempt = 1; cliAttempt <= MAX_CLI_RETRIES + 1; cliAttempt++) {
      try {
        if (isAnthropicPlanning) {
          rawOutput = await runClaudeCli(
            claudePath,
            cliModel,
            currentPrompt,
            cleanEnv,
            task.id,
            startTime,
            iterationCwd,
          );
        } else {
          if (!providerApiKey) {
            throw new Error(`No API key available for provider "${provider}". Configure it in Settings > Integrations.`);
          }
          const genStart = Math.round((Date.now() - startTime) / 1000);
          await postProgress(task.id, "generating_plan", genStart, "Generating plan via AI SDK...", 0, 0);
          // Use AI SDK with tool access to cloned repo (only on first attempt)
          rawOutput = await generateTextWithTools({
            provider,
            model: cliModel,
            apiKey: providerApiKey,
            prompt: currentPrompt,
            workingDir: iterationCwd,
            enableTools: !!iterationCwd,
            maxSteps: 10,
          });
          // Post "validating" phase so the dashboard progress bar transitions correctly
          const genEnd = Math.round((Date.now() - startTime) / 1000);
          await postProgress(task.id, "validating", genEnd, "Validating plan...", rawOutput.length, 0);
        }
        cliSuccess = true;
        break; // Success — exit retry loop
      } catch (error: unknown) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const errMsg = error instanceof Error ? error.message : String(error);

        // Retry on transient errors (5xx, timeouts, connection resets)
        if (isTransientError(errMsg) && cliAttempt <= MAX_CLI_RETRIES) {
          const backoffSec = cliAttempt * 10; // 10s, 20s
          console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} Transient error (attempt ${cliAttempt}/${MAX_CLI_RETRIES + 1}), retrying in ${backoffSec}s: ${errMsg.substring(0, 100)}`);
          await postLog(
            task.id,
            `${PREFIX} Transient API error (attempt ${cliAttempt}/${MAX_CLI_RETRIES + 1}), retrying in ${backoffSec}s...`,
            "output",
            "warning",
          );
          await new Promise((r) => setTimeout(r, backoffSec * 1000));
          continue;
        }

        // Non-transient error or final retry exhausted — fail
        console.error(`${ts()} ${taskLabel} ${chalk.red("✗")} Failed after ${elapsed}s: ${errMsg.substring(0, 100)}`);
        await postLog(
          task.id,
          `${PREFIX} Planning failed after ${formatElapsed(elapsed)}: ${errMsg.substring(0, 200)}`,
          "error",
          "error",
        );
        // Report failure to server so the task doesn't stay stuck in "planning"
        try {
          await api.post("/api/agent/plan-failed", {
            taskId: task.id,
            agentId: config.agentId,
            reason: `Planning CLI/API error after ${formatElapsed(elapsed)}: ${errMsg.substring(0, 300)}`,
          });
        } catch { /* best effort */ }
        return false;
      }
    }
    if (!cliSuccess) {
      // Should not reach here, but safety net
      return false;
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const doneLabel = isAnthropicPlanning ? "Claude CLI" : `${provider} API`;
    console.log(`${ts()} ${taskLabel} ${chalk.green("✓")} ${doneLabel} done ${chalk.dim(`(${elapsed}s, ${rawOutput.length} chars)`)}`);

    // 2b. Parse plan from raw output
    let plan: ExecutionPlan;
    try {
      plan = parseExecutionPlan(rawOutput);
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`${ts()} ${taskLabel} ${chalk.red("✗")} Plan parse failed: ${errMsg.substring(0, 100)}`);
      await postLog(
        task.id,
        `${PREFIX} Failed to parse execution plan from Claude output: ${errMsg.substring(0, 200)}`,
        "error",
        "error",
      );
      // If we can't parse the plan, post raw output and let server-side try
      const rawPosted = await postRawPlan(task.id, rawOutput, config.agentId, taskLabel, elapsed);
      if (!rawPosted) {
        // Both local and server-side parsing failed — report plan-failed
        try {
          await api.post("/api/agent/plan-failed", {
            taskId: task.id,
            agentId: config.agentId,
            reason: `Plan parse failed locally and on server: ${errMsg.substring(0, 300)}`,
          });
        } catch { /* best effort */ }
      }
      return rawPosted;
    }

    // 2c. Apply story cap BEFORE critic (story count is a hard org limit)
    const { droppedCount: storyDropCount, details: storyDropDetails } = applyStoryCap(plan, storyCap);
    if (storyDropCount > 0) {
      const msg = `${PREFIX} Story cap applied: ${storyDropCount} stories dropped (max ${storyCap})`;
      console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} ${msg}`);
      await postLog(task.id, msg);
      for (const detail of storyDropDetails) {
        console.log(`${ts()} ${taskLabel}   ${chalk.dim(detail)}`);
      }
    }

    console.log(`${ts()} ${taskLabel} Plan: ${chalk.bold(plan.stories.length)} stories (max ${maxStories})`);
    await postLog(
      task.id,
      `${PREFIX} Plan generated: ${plan.stories.length} stories (${formatElapsed(elapsed)}). Running critic validation...`,
    );

    // 2d. Run critic validation on the RAW plan (before mechanical fixes).
    // This lets the critic see what the planner actually produced and give
    // useful feedback about file counts and overlaps, rather than scoring a
    // mutated plan the planner never wrote.
    const criticResult = await runCriticValidation(
      claudePath,
      cliModel,
      prd,
      plan,
      cleanEnv,
      taskLabel,
      provider,
      providerApiKey,
      task.id,
    );

    // Strip false-positive persona risks (critic may confuse PRD text with plan data)
    if (criticResult) {
      const { stripped, details: strippedDetails } = stripFalsePersonaRisks(criticResult, plan);
      if (stripped > 0) {
        for (const d of strippedDetails) {
          console.log(`${ts()} ${taskLabel} ${chalk.dim(d)}`);
        }
        await postLog(task.id, `${PREFIX} Filtered ${stripped} false-positive persona risk(s) from critic output`);
      }
    }

    // Track best plan across iterations
    if (criticResult && criticResult.score > bestScore) {
      bestPlan = plan;
      bestScore = criticResult.score;
    } else if (!criticResult && !bestPlan) {
      // Critic failed entirely — use this plan as fallback
      bestPlan = plan;
    }

    // Record critic history for this iteration
    if (criticResult) {
      criticHistory.push({
        iteration,
        score: criticResult.score,
        approved: criticResult.approved || criticResult.score >= AUTO_APPROVAL_THRESHOLD,
        risks: criticResult.risks,
        suggestions: criticResult.suggestions,
      });
    }

    // 2e. Check critic result
    if (!criticResult) {
      // Critic failed (timeout, parse error, etc.) — apply mechanical fixes then post
      applyMechanicalFixes(plan, validPersonas, taskLabel, criticConfig);
      const msg = `${PREFIX} ⚠️ CRITIC BYPASSED — Critic validation failed (timeout/parse error). Posting plan WITHOUT quality gate.`;
      console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} ${msg}`);
      await postLog(task.id, msg, "error", "warning");
      const planningDurationMs = Date.now() - startTime;
      return await postValidatedPlan(task.id, plan, config.agentId, taskLabel, elapsed, undefined, undefined, criticHistory, totalFileCapTruncations, planningDurationMs, iteration);
    }

    if (isSimplifiedMode && criticResult.score < SIMPLIFIED_FLOOR) {
      const msg = `${PREFIX} Simplified mode — score ${criticResult.score}/100 below floor (${SIMPLIFIED_FLOOR}). Will reject unless critic explicitly approved.`;
      console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} ${msg}`);
      await postLog(task.id, msg, "system", "warning");
    }

    if (criticResult.approved || criticResult.score >= AUTO_APPROVAL_THRESHOLD ||
        (isSimplifiedMode && criticResult.score >= SIMPLIFIED_FLOOR)) {
      // In simplified mode: auto-approve if score >= floor (60)
      // In strict mode: only approved if score >= threshold
      const modeLabel = isSimplifiedMode && !criticResult.approved && criticResult.score < AUTO_APPROVAL_THRESHOLD
        ? "Simplified mode — auto-approved"
        : "Critic approved";
      const msg = `${PREFIX} ${modeLabel} (score: ${criticResult.score}/100)`;
      console.log(`${ts()} ${taskLabel} ${chalk.green("✓")} ${msg}`);
      await postLog(task.id, msg);
      if (criticResult.risks.length > 0) {
        const risksMsg = `${PREFIX} Critic risks: ${criticResult.risks.join("; ")}`;
        console.log(`${ts()} ${taskLabel}   ${chalk.dim(risksMsg)}`);
        await postLog(task.id, risksMsg);
      }
      if (criticResult.suggestions && criticResult.suggestions.length > 0) {
        const sugMsg = `${PREFIX} Critic suggestions: ${criticResult.suggestions.join("; ")}`;
        console.log(`${ts()} ${taskLabel}   ${chalk.dim(sugMsg)}`);
        await postLog(task.id, sugMsg);
      }

      // Refinement pass: always send critic feedback back to the planner to
      // incorporate suggestions — even in simplified mode and even when approved.
      // The critic's job is to improve the plan; ignoring feedback defeats the purpose.
      const hasFeedback =
        (criticResult.risks.length > 0) ||
        (criticResult.suggestions && criticResult.suggestions.length > 0) ||
        (criticResult.storyFeedback && criticResult.storyFeedback.length > 0);

      let finalPlan = plan;
      if (hasFeedback) {
        await postLog(task.id, `${PREFIX} Running refinement pass — incorporating reviewer suggestions...`);
        console.log(`${ts()} ${taskLabel} Running refinement pass...`);

        const refinementPrompt = basePrompt + formatRefinementFeedback(criticResult, plan);

        try {
          let refinedOutput: string;
          if (isAnthropicPlanning) {
            // No tools for refinement — the approved plan is in the prompt,
            // critic feedback is appended, just emit the refined JSON.
            // Without --tools "" Claude CLI re-explores the repo (47+ tool calls).
            refinedOutput = await runClaudeCli(
              claudePath,
              cliModel,
              refinementPrompt,
              cleanEnv,
              task.id,
              startTime,
              undefined,
              ["--tools", ""],
            );
          } else {
            if (!providerApiKey) {
              throw new Error(`No API key for "${provider}"`);
            }
            refinedOutput = await generateTextWithTools({
              provider,
              model: cliModel,
              apiKey: providerApiKey,
              prompt: refinementPrompt,
              enableTools: false,
              maxSteps: 10,
            });
          }

          const refinedPlan = parseExecutionPlan(refinedOutput);
          finalPlan = refinedPlan;
          const refElapsed = Math.round((Date.now() - startTime) / 1000);
          console.log(`${ts()} ${taskLabel} ${chalk.green("✓")} Refinement complete ${chalk.dim(`(${refElapsed}s)`)}`);
          await postLog(task.id, `${PREFIX} Refinement complete — plan updated with reviewer suggestions`);
        } catch (refineErr) {
          const errMsg = refineErr instanceof Error ? refineErr.message : String(refineErr);
          console.warn(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} Refinement failed, using original plan: ${errMsg.substring(0, 100)}`);
          await postLog(task.id, `${PREFIX} ⚠️ Refinement pass failed (${errMsg.substring(0, 100)}) — using original approved plan`);
          // Fall through with original plan
        }
      }

      // Apply mechanical fixes (file cap, overlaps, personas) AFTER critic
      // approval so the critic sees the planner's actual output.
      applyMechanicalFixes(finalPlan, validPersonas, taskLabel, criticConfig);

      const planningDurationMs = Date.now() - startTime;
      const finalElapsed = Math.round((Date.now() - startTime) / 1000);
      return await postValidatedPlan(task.id, finalPlan, config.agentId, taskLabel, finalElapsed, criticResult.score, criticResult.risks, criticHistory, totalFileCapTruncations, planningDurationMs, iteration);
    }

    // 2f. Rejected — accumulate critic feedback for next iteration
    if (iteration < MAX_ITERATIONS) {
      const feedback = formatCriticFeedback(criticResult);
      // Accumulate ALL critic feedback across iterations so the planner
      // doesn't repeat mistakes from earlier attempts
      currentPrompt = currentPrompt + "\n\n" + feedback;

      const msg = `${PREFIX} Critic rejected (score: ${criticResult.score}/100, threshold: ${AUTO_APPROVAL_THRESHOLD}). Re-planning with feedback...`;
      console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} ${msg}`);
      await postLog(task.id, msg);

      if (criticResult.risks.length > 0) {
        const risksMsg = `${PREFIX} Critic risks: ${criticResult.risks.join("; ")}`;
        console.log(`${ts()} ${taskLabel}   ${chalk.dim(risksMsg)}`);
        await postLog(task.id, risksMsg);
      }
      if (criticResult.suggestions && criticResult.suggestions.length > 0) {
        const sugMsg = `${PREFIX} Critic suggestions: ${criticResult.suggestions.join("; ")}`;
        console.log(`${ts()} ${taskLabel}   ${chalk.dim(sugMsg)}`);
        await postLog(task.id, sugMsg);
      }
    } else {
      // Final iteration — rejected
      const msg = `${PREFIX} Critic rejected after ${MAX_ITERATIONS} iterations (best score: ${bestScore}/100, threshold: ${AUTO_APPROVAL_THRESHOLD})`;
      console.error(`${ts()} ${taskLabel} ${chalk.red("✗")} ${msg}`);
      await postLog(task.id, msg, "error", "error");

      if (criticResult.risks.length > 0) {
        const risksMsg = `${PREFIX} Final risks: ${criticResult.risks.join("; ")}`;
        console.error(`${ts()} ${taskLabel}   ${risksMsg}`);
        await postLog(task.id, risksMsg, "error", "error");
      }
      if (criticResult.suggestions && criticResult.suggestions.length > 0) {
        const sugMsg = `${PREFIX} Suggestions: ${criticResult.suggestions.join("; ")}`;
        console.error(`${ts()} ${taskLabel}   ${sugMsg}`);
        await postLog(task.id, sugMsg, "error", "error");
      }
    }
  }

  // All iterations exhausted — try best-plan fallback before failing.
  // If we have a plan that scored >= BEST_PLAN_FALLBACK_THRESHOLD, post it
  // with a warning instead of discarding it entirely.
  const BEST_PLAN_FALLBACK_THRESHOLD = 50;
  if (bestPlan && bestScore >= BEST_PLAN_FALLBACK_THRESHOLD) {
    // Apply mechanical fixes to fallback plan before posting
    applyMechanicalFixes(bestPlan, validPersonas, taskLabel, criticConfig);
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const msg = `${PREFIX} Best-plan fallback: posting plan with score ${bestScore}/100 (below ${AUTO_APPROVAL_THRESHOLD} threshold, above ${BEST_PLAN_FALLBACK_THRESHOLD} minimum)`;
    console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} ${msg}`);
    await postLog(task.id, msg);
    const planningDurationMs = Date.now() - startTime;
    const fallbackPosted = await postValidatedPlan(task.id, bestPlan, config.agentId, taskLabel, elapsed, bestScore, [`Best-plan fallback: critic rejected after ${MAX_ITERATIONS} iterations`], criticHistory, totalFileCapTruncations, planningDurationMs, MAX_ITERATIONS);
    if (fallbackPosted) {
      return true;
    }
    // Fallback post failed (404, 409, etc.) — fall through to plan-failed
    // so the task doesn't stay stuck in "planning" status forever.
    console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} ${PREFIX} Fallback post rejected by server, reporting plan-failed`);
    await postLog(task.id, `${PREFIX} Fallback plan rejected by server — reporting failure`);
  }

  // No usable plan (or fallback rejected) — report failure to server so
  // the task doesn't stay in "planning" status forever (infinite retry loop).
  try {
    const failReason = bestPlan && bestScore >= BEST_PLAN_FALLBACK_THRESHOLD
      ? `Best-plan fallback rejected by server after ${MAX_ITERATIONS} iterations (best score: ${bestScore}/100)`
      : `Critic rejected after ${MAX_ITERATIONS} iterations (best score: ${bestScore}/100, threshold: ${AUTO_APPROVAL_THRESHOLD}, fallback minimum: ${BEST_PLAN_FALLBACK_THRESHOLD})`;
    await api.post("/api/agent/plan-failed", {
      taskId: task.id,
      agentId: config.agentId,
      reason: failReason,
      criticHistory,
    });
  } catch {
    // Best-effort — if the endpoint doesn't exist yet, the task will still
    // be picked up again, but at least we tried.
  }
  return false;
  } finally {
    // Drain any remaining log entries before cleanup
    await flushLogQueue();

    // Cleanup temp clone
    if (repoPath) {
      try {
        rmSync(repoPath, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Post a validated (file-capped) plan to the cloud API.
 * Re-serializes the plan as a JSON code block since the server-side
 * parseExecutionPlan() expects that format.
 */
async function postValidatedPlan(
  taskId: string,
  plan: ExecutionPlan,
  agentId: string,
  taskLabel: string,
  elapsed: number,
  criticScore?: number,
  criticRisks?: string[],
  criticHistory?: Array<{
    iteration: number;
    score: number;
    approved: boolean;
    risks: string[];
    suggestions?: string[];
    filesCapApplied?: number;
  }>,
  fileCapTruncations?: number,
  planningDurationMs?: number,
  criticIterations?: number,
): Promise<boolean> {
  const serialized = serializePlan(plan);

  try {
    const result = await api.post("/api/agent/plan-result", {
      taskId,
      rawOutput: serialized,
      agentId,
      criticScore,
      criticRisks,
      criticHistory,
      criticIterations,
      fileCapTruncations,
      planningDurationMs,
    });

    const storyCount = result.data.storyCount;
    console.log(`${ts()} ${taskLabel} ${chalk.green("✓")} Plan validated: ${chalk.bold(storyCount)} stories → ${chalk.green("queued")}`);
    await postLog(
      taskId,
      `${PREFIX} Plan validated: ${storyCount} stories. Task queued for execution.`,
    );
    await postProgress(taskId, "complete", elapsed, "Planning complete", 0, 0);
    return true;
  } catch (error: unknown) {
    const err = error as { response?: { status?: number; data?: { detail?: string; error?: string } } };
    const detail = err.response?.data?.error || err.response?.data?.detail || String(error);
    const statusCode = err.response?.status ? ` (${err.response.status})` : "";
    console.error(`${ts()} ${taskLabel} ${chalk.red("✗")} Server validation failed${statusCode}: ${detail.substring(0, 100)}`);
    await postLog(
      taskId,
      `${PREFIX} Server-side plan validation failed${statusCode}: ${detail.substring(0, 200)}`,
      "error",
      "error",
    );
    return false;
  }
}

/**
 * Post raw (unparsed) plan output to the cloud API as a fallback.
 * Used when local plan parsing fails — let the server try.
 */
async function postRawPlan(
  taskId: string,
  rawOutput: string,
  agentId: string,
  taskLabel: string,
  elapsed: number,
): Promise<boolean> {
  try {
    const result = await api.post("/api/agent/plan-result", {
      taskId,
      rawOutput,
      agentId,
    });

    const storyCount = result.data.storyCount;
    console.log(`${ts()} ${taskLabel} ${chalk.green("✓")} Plan validated (server-side): ${chalk.bold(storyCount)} stories → ${chalk.green("queued")}`);
    await postLog(
      taskId,
      `${PREFIX} Plan validated: ${storyCount} stories. Task queued for execution.`,
    );
    await postProgress(taskId, "complete", elapsed, "Planning complete", 0, 0);
    return true;
  } catch (error: unknown) {
    const err = error as { response?: { data?: { detail?: string } } };
    const detail = err.response?.data?.detail || String(error);
    console.error(`${ts()} ${taskLabel} ${chalk.red("✗")} Validation failed: ${detail.substring(0, 100)}`);
    await postLog(
      taskId,
      `${PREFIX} Plan validation failed: ${detail.substring(0, 200)}`,
      "error",
      "error",
    );
    return false;
  }
}
