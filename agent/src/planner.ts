/**
 * Remote Agent Planner
 *
 * Fetches the planning prompt from the cloud API, runs it through
 * Claude CLI locally (using the customer's Claude Max subscription),
 * validates with a Planner-Critic loop, and posts the approved plan
 * back for server-side processing.
 *
 * Guardrails (matching server-side planning pipeline):
 *   1. File cap: max 5 targetFiles per story (prevents scope explosion)
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
  serializePlan,
  runCriticValidation,
  formatCriticFeedback,
  AUTO_APPROVAL_THRESHOLD,
  type ExecutionPlan,
} from "./plan-validator.js";
import { generateText, type AIProvider } from "./providers.js";
import type { ClaimCredentials } from "./spawner.js";

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
 * Post a log message to the cloud dashboard for real-time visibility.
 */
async function postLog(
  taskId: string,
  message: string,
  type: string = "system",
  severity: string = "info",
): Promise<void> {
  try {
    await api.post("/api/control-center/logs", {
      taskId,
      type,
      message,
      severity,
    });
  } catch {
    // Fire and forget — don't block planning on log failures
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
): Promise<string> {
  const taskLabel = chalk.cyan(taskId.slice(0, 8));

  return new Promise((resolve, reject) => {
    const proc = spawn(
      claudePath,
      [
        "--print",
        "--verbose",
        "--output-format", "stream-json",
        "--model", model,
        "--permission-mode", "bypassPermissions",
      ],
      {
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
            }
          } else if (event.type === "content_block_delta" && event.delta?.text) {
            // Fallback: raw API streaming format
            fullText += event.delta.text;
            charsReceived += event.delta.text.length;

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

    const timeout = setTimeout(() => {
      clearInterval(progressInterval);
      clearInterval(sseProgressInterval);
      proc.kill("SIGTERM");
      reject(new Error("Claude CLI timed out after 20 minutes"));
    }, 1_200_000);

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      clearInterval(progressInterval);
      clearInterval(sseProgressInterval);

      // Emit final "validating" phase to dashboard
      const elapsedAtClose = Math.round((Date.now() - startTime) / 1000);
      postProgress(taskId, "validating", elapsedAtClose, "Validating plan...", charsReceived, toolCallCount);

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
      clearInterval(progressInterval);
      clearInterval(sseProgressInterval);
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
 * Clone the target repo to a temp directory for team planning analysis.
 * Returns the path on success, or null on failure (fallback to single-agent).
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
      `${ts()} ${taskLabel} ${chalk.dim("Cloning repo for team planning...")}`,
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
      `${ts()} ${taskLabel} ${chalk.yellow("⚠")} Clone failed, falling back to single-agent: ${errMsg.substring(0, 100)}`,
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
 * Run an analyst agent via Claude CLI with tool access to the cloned repo.
 * Returns the analyst's report text, or an empty string on failure.
 */
function runAnalyst(
  name: string,
  claudePath: string,
  model: string,
  prompt: string,
  repoPath: string,
  env: Record<string, string | undefined>,
  timeoutMs: number = 900_000,
): Promise<string> {
  const label = chalk.blue(`[${name}]`);

  return new Promise((resolve) => {
    console.log(`${ts()} ${label} Starting (${chalk.dim(model)})...`);

    const proc = spawn(
      claudePath,
      [
        "--print",
        "--verbose",
        "--output-format", "stream-json",
        "--model", model,
        "--permission-mode", "bypassPermissions",
      ],
      {
        cwd: repoPath,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    // Write prompt via stdin (same as runClaudeCli)
    proc.stdin.write(prompt);
    proc.stdin.end();

    let resultText = "";
    let fullText = "";
    let stderrOutput = "";
    let lineBuffer = "";
    let toolCalls = 0;
    let timedOut = false;
    const startMs = Date.now();

    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrOutput += text;
      // Show stderr in real-time so we can see what's happening
      for (const line of text.split("\n").filter((l: string) => l.trim())) {
        console.log(`${ts()} ${label} ${chalk.red("stderr:")} ${line.trim()}`);
      }
    });

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
                  // Log analyst reasoning (first line, truncated)
                  const thought = block.text.trim().split("\n")[0].substring(0, 120);
                  if (thought) {
                    console.log(`${ts()} ${label} ${chalk.dim("💭")} ${chalk.dim(thought)}`);
                  }
                } else if (block.type === "tool_use") {
                  toolCalls++;
                  const toolName = block.name || "unknown";
                  // Show tool name + input preview (file path, pattern, etc.)
                  const inputStr = block.input ? JSON.stringify(block.input) : "";
                  const inputPreview = inputStr.length > 80 ? inputStr.substring(0, 80) + "…" : inputStr;
                  console.log(`${ts()} ${label} ${chalk.dim(`Tool: ${toolName}`)}${inputPreview ? chalk.dim(` ${inputPreview}`) : ""} (${toolCalls} total)`);
                }
              }
            } else if (typeof content === "string") {
              fullText += content;
            }
          } else if (event.type === "content_block_delta" && event.delta?.text) {
            // Fallback: raw API streaming format (may appear in some CLI versions)
            fullText += event.delta.text;
          } else if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
            toolCalls++;
            const toolName = event.content_block?.name || "unknown";
            console.log(`${ts()} ${label} ${chalk.dim(`Tool: ${toolName}`)} (${toolCalls} total)`);
          } else if (event.type === "result" && event.result) {
            resultText =
              typeof event.result === "string" ? event.result : "";
          }
        } catch {
          fullText += trimmed + "\n";
        }
      }
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      const elapsed = Math.round((Date.now() - startMs) / 1000);
      console.log(
        `${ts()} ${label} ${chalk.yellow("⚠ Timed out")} after ${elapsed}s (${toolCalls} tool calls, ${fullText.length} chars)`,
      );
      resolve(resultText || fullText || "");
    }, timeoutMs);

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      const elapsed = Math.round((Date.now() - startMs) / 1000);
      if (timedOut) return; // already resolved

      const output = resultText || fullText || "";
      if (code === 0 && output.length > 0) {
        console.log(
          `${ts()} ${label} ${chalk.green("✓ Done")} in ${elapsed}s (${toolCalls} tool calls, ${output.length} chars)`,
        );
      } else if (code !== 0) {
        console.log(
          `${ts()} ${label} ${chalk.red(`✗ Exited ${code}`)} after ${elapsed}s — ${stderrOutput.substring(0, 150) || "no stderr"}`,
        );
      } else {
        console.log(
          `${ts()} ${label} ${chalk.yellow("⚠ Empty output")} after ${elapsed}s (${toolCalls} tool calls)`,
        );
      }
      resolve(output);
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      console.log(
        `${ts()} ${label} ${chalk.red("✗ Spawn failed:")} ${err.message}`,
      );
      resolve("");
    });
  });
}

/** Analyst prompt templates */
const CODEBASE_ANALYST_PROMPT = `You are a codebase analyst. Your job is to explore this repository using tools and report what you find.

IMPORTANT: You MUST use tools to explore the repository. Do NOT guess or make assumptions.

Step 1: Run Glob with pattern "**/*" to see the top-level directory structure.
Step 2: Read key files: package.json, tsconfig.json, README.md, .env.example, or equivalents.
Step 3: Run Glob on src/ or the main source directory to understand the code layout.
Step 4: Read 2-3 representative source files to understand patterns and frameworks.

After exploring, write a report covering:
1. Directory structure and organization
2. Languages, frameworks, and key dependencies (from package.json, requirements.txt, etc.)
3. Existing test files and testing patterns (search for test/, __tests__, *.test.*, *.spec.*)
4. CI/CD configuration (search for .github/workflows/, Jenkinsfile, etc.)
5. Configuration files and environment setup

Keep your report under 2000 words. Only report facts you verified with tools.`;

function makeRequirementsAnalystPrompt(task: PlanningTask): string {
  return `You are a requirements analyst. Analyze the following task and the repository to identify what needs to be built.

Task: ${task.summary}
${task.description ? `\nDescription:\n${task.description}` : ""}

IMPORTANT: You MUST use tools to understand the existing codebase before analyzing requirements.

Step 1: Run Glob with pattern "**/*" to see what already exists in the repository.
Step 2: Read any existing README, docs, or configuration to understand the current state.
Step 3: Search for any code related to the task requirements using Grep.

After exploring, write a report covering:
1. Explicit acceptance criteria — what MUST be built based on the description
2. Implicit requirements — what's assumed but not stated (auth, error handling, etc.)
3. What already exists vs what needs to be created (based on your file exploration)
4. Ambiguities that could lead to wrong implementation
5. Suggested components/modules and which persona should own each

Keep your report under 1500 words.`;
}

function makeRiskAssessorPrompt(task: PlanningTask): string {
  return `You are a risk assessor. Your job is to search this repository for potential risks and blockers for a development task.

Task: ${task.summary}
${task.description ? `\nDescription:\n${task.description}` : ""}

IMPORTANT: You MUST use tools to search the codebase. Do NOT guess file paths or make assumptions.

Step 1: Run Glob with pattern "**/*" to see the full repository structure.
Step 2: Use Grep to search for code related to the task (relevant keywords, APIs, components).
Step 3: Read files that are likely to be modified or affected by this task.
Step 4: Search for existing tests (Grep for "test", "spec", "describe", "it(") to find test coverage.

After exploring, write a report covering:
1. Specific files that will need to be modified (exact paths from your search)
2. Files with heavy coupling or shared dependencies (imports you found)
3. Existing tests that will need updating (exact file paths)
4. Environment, config, or migration requirements
5. Deployment or infrastructure risks

Keep your report under 1500 words. Only report facts you verified with tools.`;
}

/**
 * Run team planning: spawn 3 parallel analyst agents, then synthesize
 * their reports into an enhanced planning prompt for the final planner.
 *
 * Falls back to single-agent planning if anything goes wrong.
 */
/**
 * Run team analysis: spawn 3 parallel analyst agents once, then return
 * an enhanced prompt with their reports appended. Returns null if all
 * analysts fail (caller should fall back to basePrompt).
 *
 * This runs ONCE before the planner-critic loop — analyst prompts don't
 * include critic feedback, so re-running them on iteration 2+ is waste.
 */
async function runTeamAnalysis(
  task: PlanningTask,
  basePrompt: string,
  claudePath: string,
  model: string,
  env: Record<string, string | undefined>,
  repoPath: string,
  taskId: string,
  startTime: number,
): Promise<string | null> {
  const taskLabel = chalk.cyan(taskId.slice(0, 8));

  console.log(
    `${ts()} ${taskLabel} ${chalk.magenta("◆ Team planning")} — running 3 analysts in parallel...`,
  );
  await postLog(
    taskId,
    `${PREFIX} Team planning: running codebase, requirements, and risk analysts in parallel...`,
  );
  await postProgress(
    taskId,
    "reading_repo",
    Math.round((Date.now() - startTime) / 1000),
    "Running parallel analysis agents...",
    0,
    0,
  );

  const analysisModel = model;
  const MAX_TEAM_RETRIES = 3;

  let codebaseReport = "";
  let requirementsReport = "";
  let riskReport = "";

  for (let attempt = 1; attempt <= MAX_TEAM_RETRIES; attempt++) {
    if (attempt > 1) {
      console.log(
        `${ts()} ${taskLabel} ${chalk.magenta("◆ Team planning")} — retry ${attempt}/${MAX_TEAM_RETRIES}...`,
      );
      await postLog(
        taskId,
        `${PREFIX} Team analysis retry ${attempt}/${MAX_TEAM_RETRIES}...`,
      );
    }

    const [codebaseResult, requirementsResult, riskResult] =
      await Promise.allSettled([
        codebaseReport ? Promise.resolve(codebaseReport) : runAnalyst(
          "Codebase",
          claudePath,
          analysisModel,
          CODEBASE_ANALYST_PROMPT,
          repoPath,
          env,
        ),
        requirementsReport ? Promise.resolve(requirementsReport) : runAnalyst(
          "Requirements",
          claudePath,
          analysisModel,
          makeRequirementsAnalystPrompt(task),
          repoPath,
          env,
        ),
        riskReport ? Promise.resolve(riskReport) : runAnalyst(
          "Risk",
          claudePath,
          analysisModel,
          makeRiskAssessorPrompt(task),
          repoPath,
          env,
        ),
      ]);

    if (!codebaseReport && codebaseResult.status === "fulfilled") {
      codebaseReport = codebaseResult.value;
    }
    if (!requirementsReport && requirementsResult.status === "fulfilled") {
      requirementsReport = requirementsResult.value;
    }
    if (!riskReport && riskResult.status === "fulfilled") {
      riskReport = riskResult.value;
    }

    const successCount = [codebaseReport, requirementsReport, riskReport].filter(
      (r) => r.length > 0,
    ).length;
    const analysisElapsed = Math.round((Date.now() - startTime) / 1000);

    console.log(
      `${ts()} ${taskLabel} Analysis attempt ${attempt}: ${successCount}/3 reports (${analysisElapsed}s)`,
    );

    if (successCount > 0) {
      console.log(
        `${ts()} ${taskLabel} ${chalk.green("✓")} Analysis complete: ${successCount}/3 reports (${analysisElapsed}s)`,
      );
      await postLog(
        taskId,
        `${PREFIX} Team analysis complete: ${successCount}/3 reports in ${formatElapsed(analysisElapsed)}. Synthesizing plan...`,
      );
      await postProgress(
        taskId,
        "analyzing",
        analysisElapsed,
        "Synthesizing analysis reports...",
        0,
        0,
      );
      break;
    }

    if (attempt === MAX_TEAM_RETRIES) {
      console.log(
        `${ts()} ${taskLabel} ${chalk.yellow("⚠")} All analysts failed after ${MAX_TEAM_RETRIES} attempts, falling back to single-agent planning`,
      );
      await postLog(
        taskId,
        `${PREFIX} All analysis agents failed after ${MAX_TEAM_RETRIES} attempts — falling back to single-agent planning`,
      );
      return null;
    }
  }

  // Build enhanced prompt with analysis reports
  const sections: string[] = [];

  if (codebaseReport) {
    sections.push(`## Codebase Analysis (from automated analysis)\n\n${codebaseReport}`);
  }
  if (requirementsReport) {
    sections.push(`## Requirements Analysis\n\n${requirementsReport}`);
  }
  if (riskReport) {
    sections.push(`## Risk Assessment\n\n${riskReport}`);
  }

  return (
    basePrompt +
    "\n\n" +
    sections.join("\n\n") +
    "\n\n" +
    "Use these analyses to produce a more accurate execution plan.\n" +
    "Prefer actual file paths discovered in the codebase analysis over guessed paths."
  );
}

/**
 * Run planning for a task with Planner-Critic validation loop.
 *
 * Flow:
 *   1. Fetch planning prompt from cloud API
 *   2. Run Claude CLI to generate plan
 *   3. Parse plan, apply file cap (max 5 files per story)
 *   4. Run critic validation via Claude CLI
 *   5. If critic approves (score >= 85): post validated plan to API
 *   6. If critic rejects: re-run planner with feedback (up to MAX_ITERATIONS)
 *   7. After MAX_ITERATIONS without approval: fail the task
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

  const cliModel = model || "sonnet";
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

  // Run team analysis ONCE before the planner-critic loop.
  // Analyst prompts don't include critic feedback, so re-running them
  // on iteration 2+ wastes compute (they'd produce the same reports).
  let repoPath: string | null = null;
  let enhancedBasePrompt = basePrompt;

  if (isAnthropicPlanning && config.teamPlanningEnabled && task.githubRepo) {
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
        `${ts()} ${taskLabel} ${chalk.yellow("⚠")} No SCM token for ${scmProvider}, skipping team planning`,
      );
    }

    if (repoPath) {
      const analystModel = config.analystModel || "sonnet";
      console.log(`${ts()} ${taskLabel} Analysts using model: ${chalk.yellow(analystModel)} (planner: ${chalk.yellow(cliModel)})`);
      const analysisResult = await runTeamAnalysis(
        task,
        basePrompt,
        claudePath,
        analystModel,
        cleanEnv,
        repoPath,
        task.id,
        startTime,
      );
      if (analysisResult) {
        enhancedBasePrompt = analysisResult;
      }
      // else: all analysts failed, fall back to basePrompt
    }
  }

  // 2. Planner-Critic iteration loop
  // Use enhancedBasePrompt (with analyst reports) as the base for all iterations.
  // Critic feedback gets appended on re-plan, but analyst reports are fixed.
  let currentPrompt = enhancedBasePrompt;
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
        );
      } else {
        if (!providerApiKey) {
          throw new Error(`No API key available for provider "${provider}". Configure it in Settings > Integrations.`);
        }
        const genStart = Math.round((Date.now() - startTime) / 1000);
        await postProgress(task.id, "generating_plan", genStart, "Generating plan via API...", 0, 0);
        rawOutput = await generateText(provider, cliModel, currentPrompt, providerApiKey);
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
      const msg = `${PREFIX} File cap applied: ${truncatedCount} stories truncated to max 5 targetFiles`;
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
      const msg = `${PREFIX} Critic validation failed — posting plan without critic score`;
      console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} ${msg}`);
      await postLog(task.id, msg);
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

    // 2f. Rejected — append critic feedback for next iteration
    if (iteration < MAX_ITERATIONS) {
      const feedback = formatCriticFeedback(criticResult);
      currentPrompt = enhancedBasePrompt + "\n\n" + feedback;

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

  // All iterations exhausted — fail
  return false;
  } finally {
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
    const err = error as { response?: { data?: { detail?: string } } };
    const detail = err.response?.data?.detail || String(error);
    console.error(`${ts()} ${taskLabel} ${chalk.red("✗")} Server validation failed: ${detail.substring(0, 100)}`);
    await postLog(
      taskId,
      `${PREFIX} Server-side plan validation failed: ${detail.substring(0, 200)}`,
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
