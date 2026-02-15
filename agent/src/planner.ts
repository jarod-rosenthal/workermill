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

import { spawn, execSync } from "child_process";
import { findClaudePath, type AgentConfig } from "./config.js";
import { api } from "./api.js";
import {
  parseExecutionPlan,
  applyFileCap,
  applyStoryCap,
  resolveFileOverlaps,
  serializePlan,
  runCriticValidation,
  formatCriticFeedback,
  getCriticConfig,
  AUTO_APPROVAL_THRESHOLD,
  type ExecutionPlan,
} from "./plan-validator.js";
import { generateText, type AIProvider } from "./providers.js";
import { generateTextWithTools } from "./ai-sdk-generate.js";
import type { ClaimCredentials } from "./spawner.js";

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
const PREFIX = "[🗺️ planning_agent 🤖]";

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
): Promise<string> {
  const taskLabel = chalk.cyan(taskId.slice(0, 8));

  return new Promise((resolve, reject) => {
    const cliArgs = [
        "--print",
        "--verbose",
        "--output-format", "stream-json",
        "--model", model,
        "--permission-mode", "bypassPermissions",
      ];

    const proc = spawn(
      claudePath,
      cliArgs,
      {
        cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    proc.stdin.write(prompt);
    proc.stdin.end();

    let fullText = "";
    let resultText = "";
    let stderrOutput = "";
    let charsReceived = 0;
    let toolCallCount = 0;

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
    const textFlushInterval = setInterval(() => flushTextBuffer(), 500);

    // SSE progress updates every 2s — drives PlanningTerminalBar in dashboard
    // (same cadence as local dev's progressInterval in planning-agent-local.ts)
    const sseProgressInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      postProgress(taskId, currentPhase, elapsed, phaseLabel(currentPhase, elapsed), charsReceived, toolCallCount);
    }, 2_000);

    // Phase transition logs + periodic DB logs (every 30s during generation)
    let lastProgressLogAt = 0;
    const progressInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      // Time-based phase fallback (in case stream events are sparse)
      if (currentPhase === "initializing" && elapsed >= 5) {
        transitionPhase("reading_repo");
      } else if (currentPhase === "reading_repo" && elapsed >= 15 && !firstTextSeen) {
        transitionPhase("analyzing");
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
        // Prefer the result event's text (authoritative), fall back to accumulated deltas
        resolve(resultText || fullText);
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
): string {
  switch (scmProvider) {
    case "bitbucket":
      return `https://x-token-auth:${token}@bitbucket.org/${repo}.git`;
    case "gitlab":
      return `https://oauth2:${token}@gitlab.com/${repo}.git`;
    case "github":
    default:
      return `https://x-access-token:${token}@github.com/${repo}.git`;
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
): Promise<string | null> {
  const taskLabel = chalk.cyan(taskId.slice(0, 8));
  const tmpDir = `/tmp/workermill-planning-${taskId.slice(0, 8)}-${Date.now()}`;

  try {
    const cloneUrl = buildCloneUrl(repo, token, scmProvider);
    console.log(
      `${ts()} ${taskLabel} ${chalk.dim("Cloning repo for planner...")}`,
    );
    execSync(`git clone --depth 1 --single-branch "${cloneUrl}" "${tmpDir}"`, {
      stdio: "ignore",
      timeout: 60_000,
    });
    console.log(
      `${ts()} ${taskLabel} ${chalk.green("✓")} Repo cloned to ${chalk.dim(tmpDir)}`,
    );
    return tmpDir;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(
      `${ts()} ${taskLabel} ${chalk.yellow("⚠")} Clone failed, planner will run without repo access: ${errMsg.substring(0, 100)}`,
    );
    // Cleanup partial clone
    try {
      execSync(`rm -rf "${tmpDir}"`, { stdio: "ignore" });
    } catch {
      /* ignore */
    }
    return null;
  }
}

/**
 * Run planning for a task with Planner-Critic validation loop.
 *
 * Flow:
 *   1. Fetch planning prompt from cloud API
 *   2. Clone target repo (if available) so planner can explore with tools
 *   3. Run Claude CLI to generate plan
 *   4. Parse plan, apply file cap (max 5 files per story)
 *   5. Run critic validation via Claude CLI
 *   6. If critic approves (score >= 80): post validated plan to API
 *   7. If critic rejects: re-run planner with feedback (up to MAX_ITERATIONS)
 *   8. After MAX_ITERATIONS without approval: post best plan if score >= 50 (fallback)
 *   9. If no plan scored >= 50: fail the task
 */
export async function planTask(
  task: PlanningTask,
  config: AgentConfig,
  credentials?: ClaimCredentials,
): Promise<boolean> {
  const taskLabel = chalk.cyan(task.id.slice(0, 8));

  console.log(`${ts()} ${taskLabel} Fetching planning prompt...`);
  await postLog(task.id, `${PREFIX} Fetching planning prompt from cloud API...`);

  // 1. Fetch the assembled planning prompt from the cloud API
  const promptResponse = await api.get("/api/agent/planning-prompt", {
    params: { taskId: task.id },
  });
  const { prompt: basePrompt, model, provider: planningProvider, maxStories: apiMaxStories } = promptResponse.data;
  const maxStories: number = typeof apiMaxStories === "number" ? apiMaxStories : 8;

  const cliModel = model;
  const provider: AIProvider = (planningProvider || "anthropic") as AIProvider;
  const isAnthropicPlanning = provider === "anthropic";
  const claudePath =
    process.env.CLAUDE_CLI_PATH || findClaudePath() || "claude";

  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDE_CODE_OAUTH_TOKEN;

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
        ? config.bitbucketToken
        : scmProvider === "gitlab"
          ? config.gitlabToken
          : config.githubToken;

    if (scmToken) {
      repoPath = await cloneTargetRepo(
        task.githubRepo,
        scmToken,
        scmProvider,
        task.id,
      );
    } else {
      console.log(
        `${ts()} ${taskLabel} ${chalk.yellow("⚠")} No SCM token for ${scmProvider}, planner will run without repo access`,
      );
    }
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
  const criticConfig = await getCriticConfig();
  if (!criticConfig) {
    console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} Could not fetch critic config — critic validation will be skipped`);
    await postLog(task.id, `${PREFIX} ⚠️ Could not fetch critic config from API — critic validation will be skipped`);
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
      await postLog(task.id, `${PREFIX} Starting planning agent using ${providerLabel}`);
    }

    // 2a. Generate plan via Claude CLI (Anthropic) or HTTP API (other providers)
    let rawOutput: string;
    try {
      if (isAnthropicPlanning) {
        rawOutput = await runClaudeCli(
          claudePath,
          cliModel,
          currentPrompt,
          cleanEnv,
          task.id,
          startTime,
          repoPath || undefined,
        );
      } else {
        if (!providerApiKey) {
          throw new Error(`No API key available for provider "${provider}". Configure it in Settings > Integrations.`);
        }
        const genStart = Math.round((Date.now() - startTime) / 1000);
        await postProgress(task.id, "generating_plan", genStart, "Generating plan via AI SDK...", 0, 0);
        // Use AI SDK with tool access to cloned repo (if available)
        rawOutput = await generateTextWithTools({
          provider,
          model: cliModel,
          apiKey: providerApiKey,
          prompt: currentPrompt,
          workingDir: repoPath || undefined,
          enableTools: !!repoPath, // Only enable tools if we have a cloned repo
          maxSteps: 10,
        });
        // Post "validating" phase so the dashboard progress bar transitions correctly
        const genEnd = Math.round((Date.now() - startTime) / 1000);
        await postProgress(task.id, "validating", genEnd, "Validating plan...", rawOutput.length, 0);
      }
    } catch (error: unknown) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`${ts()} ${taskLabel} ${chalk.red("✗")} Failed after ${elapsed}s: ${errMsg.substring(0, 100)}`);
      await postLog(
        task.id,
        `${PREFIX} Planning failed after ${formatElapsed(elapsed)}: ${errMsg.substring(0, 200)}`,
        "error",
        "error",
      );
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
      return await postRawPlan(task.id, rawOutput, config.agentId, taskLabel, elapsed);
    }

    // 2c. Apply file cap (max 5 files per story)
    const { truncatedCount, details } = applyFileCap(plan);
    if (truncatedCount > 0) {
      totalFileCapTruncations += truncatedCount;
      const msg = `${PREFIX} File cap applied: ${truncatedCount} stories truncated to max ${criticConfig?.maxTargetFiles ?? 5} targetFiles`;
      console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} ${msg}`);
      await postLog(task.id, msg);
      for (const detail of details) {
        console.log(`${ts()} ${taskLabel}   ${chalk.dim(detail)}`);
      }
    }

    // 2c2. Apply story cap (max stories from org calibration)
    const { droppedCount: storyDropCount, details: storyDropDetails } = applyStoryCap(plan, maxStories);
    if (storyDropCount > 0) {
      const msg = `${PREFIX} Story cap applied: ${storyDropCount} stories dropped (max ${maxStories})`;
      console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} ${msg}`);
      await postLog(task.id, msg);
      for (const detail of storyDropDetails) {
        console.log(`${ts()} ${taskLabel}   ${chalk.dim(detail)}`);
      }
    }

    // 2c3. Resolve file overlaps (assign each shared file to first story only)
    const { resolvedCount: overlapCount, details: overlapDetails } = resolveFileOverlaps(plan);
    if (overlapCount > 0) {
      const msg = `${PREFIX} File overlap resolved: ${overlapCount} shared file(s) de-duped across stories`;
      console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} ${msg}`);
      await postLog(task.id, msg);
      for (const detail of overlapDetails) {
        console.log(`${ts()} ${taskLabel}   ${chalk.dim(detail)}`);
      }
    }

    console.log(`${ts()} ${taskLabel} Plan: ${chalk.bold(plan.stories.length)} stories (max ${maxStories})`);
    await postLog(
      task.id,
      `${PREFIX} Plan generated: ${plan.stories.length} stories (${formatElapsed(elapsed)}). Running critic validation...`,
    );

    // 2d. Run critic validation
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
        filesCapApplied: truncatedCount > 0 ? truncatedCount : undefined,
      });
    }

    // 2e. Check critic result
    if (!criticResult) {
      // Critic failed (timeout, parse error, etc.) — post plan without critic gate
      const msg = `${PREFIX} ⚠️ CRITIC BYPASSED — Critic validation failed (timeout/parse error). Posting plan WITHOUT quality gate.`;
      console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} ${msg}`);
      await postLog(task.id, msg, "error", "warning");
      const planningDurationMs = Date.now() - startTime;
      return await postValidatedPlan(task.id, plan, config.agentId, taskLabel, elapsed, undefined, undefined, criticHistory, totalFileCapTruncations, planningDurationMs, iteration);
    }

    if (criticResult.approved || criticResult.score >= AUTO_APPROVAL_THRESHOLD) {
      // Approved! Post the file-capped plan
      const msg = `${PREFIX} Critic approved (score: ${criticResult.score}/100)`;
      console.log(`${ts()} ${taskLabel} ${chalk.green("✓")} ${msg}`);
      await postLog(task.id, msg);
      if (criticResult.risks.length > 0) {
        const risksMsg = `${PREFIX} Critic risks (non-blocking): ${criticResult.risks.join("; ")}`;
        console.log(`${ts()} ${taskLabel}   ${chalk.dim(risksMsg)}`);
        await postLog(task.id, risksMsg);
      }
      const planningDurationMs = Date.now() - startTime;
      return await postValidatedPlan(task.id, plan, config.agentId, taskLabel, elapsed, criticResult.score, criticResult.risks, criticHistory, totalFileCapTruncations, planningDurationMs, iteration);
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
        execSync(`rm -rf "${repoPath}"`, { stdio: "ignore" });
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
