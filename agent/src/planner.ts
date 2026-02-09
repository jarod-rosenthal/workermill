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
import { spawn } from "child_process";
import { findClaudePath, type AgentConfig } from "./config.js";
import { api } from "./api.js";
import {
  parseExecutionPlan,
  applyFileCap,
  serializePlan,
  runCriticValidation,
  formatCriticFeedback,
  AUTO_APPROVAL_THRESHOLD,
  type ExecutionPlan,
} from "./plan-validator.js";

export interface PlanningTask {
  id: string;
  summary: string;
  description: string | null;
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

          if (event.type === "content_block_delta" && event.delta?.text) {
            fullText += event.delta.text;
            charsReceived += event.delta.text.length;

            // Phase: first text after tool calls → analyzing
            if (!firstTextSeen) {
              firstTextSeen = true;
              if (toolCallCount > 0 && !milestoneSent.analyzing) {
                transitionPhase("analyzing");
                milestoneSent.analyzing = true;
              }
            }

            // Phase: substantial text → generating_plan
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
          } else if (event.type === "assistant" && event.message?.content) {
            const text = typeof event.message.content === "string" ? event.message.content : "";
            if (text) {
              fullText += text;
              charsReceived += text.length;
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
      reject(new Error("Claude CLI timed out after 10 minutes"));
    }, 600_000);

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
): Promise<boolean> {
  const taskLabel = chalk.cyan(task.id.slice(0, 8));

  console.log(`${ts()} ${taskLabel} Fetching planning prompt...`);
  await postLog(task.id, `${PREFIX} Fetching planning prompt from cloud API...`);

  // 1. Fetch the assembled planning prompt from the cloud API
  const promptResponse = await api.get("/api/agent/planning-prompt", {
    params: { taskId: task.id },
  });
  const { prompt: basePrompt, model } = promptResponse.data;

  const cliModel = model || "sonnet";
  const claudePath =
    process.env.CLAUDE_CLI_PATH || findClaudePath() || "claude";

  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDE_CODE_OAUTH_TOKEN;

  const startTime = Date.now();

  // PRD for critic validation: use task description, fall back to summary
  const prd = task.description || task.summary;

  // 2. Planner-Critic iteration loop
  let currentPrompt = basePrompt;
  let bestPlan: ExecutionPlan | null = null;
  let bestScore = 0;

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    const iterLabel = MAX_ITERATIONS > 1 ? ` (attempt ${iteration}/${MAX_ITERATIONS})` : "";

    if (iteration > 1) {
      console.log(`${ts()} ${taskLabel} Running Claude CLI${iterLabel} ${chalk.dim(`(model: ${chalk.yellow(cliModel)})`)}`);
      await postLog(task.id, `${PREFIX} Re-planning${iterLabel} using anthropic/${cliModel}`);
    } else {
      console.log(`${ts()} ${taskLabel} Running Claude CLI ${chalk.dim(`(model: ${chalk.yellow(cliModel)})`)}`);
      await postLog(task.id, `${PREFIX} Starting planning agent using anthropic/${cliModel}`);
    }

    // 2a. Run Claude CLI to generate plan
    let rawOutput: string;
    try {
      rawOutput = await runClaudeCli(
        claudePath,
        cliModel,
        currentPrompt,
        cleanEnv,
        task.id,
        startTime,
      );
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
    console.log(`${ts()} ${taskLabel} ${chalk.green("✓")} Claude CLI done ${chalk.dim(`(${elapsed}s, ${rawOutput.length} chars)`)}`);

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
      const msg = `${PREFIX} File cap applied: ${truncatedCount} stories truncated to max 5 targetFiles`;
      console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} ${msg}`);
      await postLog(task.id, msg);
      for (const detail of details) {
        console.log(`${ts()} ${taskLabel}   ${chalk.dim(detail)}`);
      }
    }

    console.log(`${ts()} ${taskLabel} Plan: ${chalk.bold(plan.stories.length)} stories`);
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
    );

    // Track best plan across iterations
    if (criticResult && criticResult.score > bestScore) {
      bestPlan = plan;
      bestScore = criticResult.score;
    } else if (!criticResult && !bestPlan) {
      // Critic failed entirely — use this plan as fallback
      bestPlan = plan;
    }

    // 2e. Check critic result
    if (!criticResult) {
      // Critic failed (timeout, parse error, etc.) — post plan without critic gate
      const msg = `${PREFIX} Critic validation failed — posting plan without critic score`;
      console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} ${msg}`);
      await postLog(task.id, msg);
      return await postValidatedPlan(task.id, plan, config.agentId, taskLabel, elapsed);
    }

    if (criticResult.approved || criticResult.score >= AUTO_APPROVAL_THRESHOLD) {
      // Approved! Post the file-capped plan
      const msg = `${PREFIX} Critic approved (score: ${criticResult.score}/100)`;
      await postLog(task.id, msg);
      return await postValidatedPlan(task.id, plan, config.agentId, taskLabel, elapsed);
    }

    // 2f. Rejected — append critic feedback for next iteration
    if (iteration < MAX_ITERATIONS) {
      const feedback = formatCriticFeedback(criticResult);
      currentPrompt = basePrompt + "\n\n" + feedback;

      const msg = `${PREFIX} Critic rejected (score: ${criticResult.score}/100, threshold: ${AUTO_APPROVAL_THRESHOLD}). Re-planning with feedback...`;
      console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} ${msg}`);
      await postLog(task.id, msg);

      if (criticResult.risks.length > 0) {
        await postLog(task.id, `${PREFIX} Critic risks: ${criticResult.risks.join("; ")}`);
      }
    } else {
      // Final iteration — rejected
      const msg = `${PREFIX} Critic rejected after ${MAX_ITERATIONS} iterations (best score: ${bestScore}/100, threshold: ${AUTO_APPROVAL_THRESHOLD})`;
      console.error(`${ts()} ${taskLabel} ${chalk.red("✗")} ${msg}`);
      await postLog(task.id, msg, "error", "error");

      if (criticResult.risks.length > 0) {
        await postLog(task.id, `${PREFIX} Final risks: ${criticResult.risks.join("; ")}`, "error", "error");
      }
      if (criticResult.suggestions && criticResult.suggestions.length > 0) {
        await postLog(task.id, `${PREFIX} Suggestions: ${criticResult.suggestions.join("; ")}`, "error", "error");
      }
    }
  }

  // All iterations exhausted — fail
  return false;
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
): Promise<boolean> {
  const serialized = serializePlan(plan);

  try {
    const result = await api.post("/api/agent/plan-result", {
      taskId,
      rawOutput: serialized,
      agentId,
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
