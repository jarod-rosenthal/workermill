/**
 * Remote Agent Planner
 *
 * Fetches the planning prompt from the cloud API, runs it through
 * Claude CLI locally (using the customer's Claude Max subscription),
 * and posts the raw output back for server-side validation.
 *
 * Logs are streamed to the cloud dashboard in real-time so the user
 * sees the same planning progress as cloud mode.
 */

import chalk from "chalk";
import { spawn } from "child_process";
import { findClaudePath, type AgentConfig } from "./config.js";
import { api } from "./api.js";

export interface PlanningTask {
  id: string;
  summary: string;
}

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
 * Run planning for a task: fetch prompt, execute Claude CLI, post result.
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
  const { prompt, model } = promptResponse.data;

  const cliModel = model || "sonnet";
  console.log(`${ts()} ${taskLabel} Running Claude CLI ${chalk.dim(`(model: ${chalk.yellow(cliModel)})`)}`);
  await postLog(task.id, `${PREFIX} Starting planning agent using anthropic/${cliModel}`);

  // 2. Run Claude CLI asynchronously with progress logging
  const claudePath =
    process.env.CLAUDE_CLI_PATH || findClaudePath() || "claude";

  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDE_CODE_OAUTH_TOKEN;

  const startTime = Date.now();
  let rawOutput: string;

  try {
    rawOutput = await runClaudeCli(
      claudePath,
      cliModel,
      prompt,
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
  await postLog(
    task.id,
    `${PREFIX} Planning complete (${formatElapsed(elapsed)}). Validating plan...`,
  );

  // 3. Post raw output back to cloud API for validation
  try {
    const result = await api.post("/api/agent/plan-result", {
      taskId: task.id,
      rawOutput,
      agentId: config.agentId,
    });

    const storyCount = result.data.storyCount;
    console.log(`${ts()} ${taskLabel} ${chalk.green("✓")} Plan validated: ${chalk.bold(storyCount)} stories → ${chalk.green("queued")}`);
    await postLog(
      task.id,
      `${PREFIX} Plan validated: ${storyCount} stories. Task queued for execution.`,
    );
    await postProgress(task.id, "complete", elapsed, "Planning complete", 0, 0);
    return true;
  } catch (error: unknown) {
    const err = error as { response?: { data?: { detail?: string } } };
    const detail = err.response?.data?.detail || String(error);
    console.error(`${ts()} ${taskLabel} ${chalk.red("✗")} Validation failed: ${detail.substring(0, 100)}`);
    await postLog(
      task.id,
      `${PREFIX} Plan validation failed: ${detail.substring(0, 200)}`,
      "error",
      "error",
    );
    return false;
  }
}
