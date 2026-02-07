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
 * Run Claude CLI asynchronously, posting progress logs to the dashboard.
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
      ["--print", "--model", model, "--permission-mode", "bypassPermissions"],
      {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    proc.stdin.write(prompt);
    proc.stdin.end();

    let fullOutput = "";
    let stderrOutput = "";

    // Post progress every 15 seconds (event loop is free since spawn is async)
    const progressInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const charsInfo = fullOutput.length > 0 ? `, ${fullOutput.length} chars` : "";
      const msg = `Planning in progress... (${elapsed}s elapsed${charsInfo})`;
      postLog(taskId, msg);
      console.log(`${ts()} ${taskLabel} ${chalk.dim(msg)}`);
    }, 15_000);

    proc.stdout.on("data", (chunk: Buffer) => {
      fullOutput += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderrOutput += chunk.toString();
    });

    const timeout = setTimeout(() => {
      clearInterval(progressInterval);
      proc.kill("SIGTERM");
      reject(new Error("Claude CLI timed out after 10 minutes"));
    }, 600_000);

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      clearInterval(progressInterval);
      if (code !== 0) {
        reject(
          new Error(
            `Claude CLI failed (exit ${code}): ${stderrOutput.substring(0, 300)}`,
          ),
        );
      } else {
        resolve(fullOutput);
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      clearInterval(progressInterval);
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
  await postLog(task.id, "Fetching planning prompt from cloud API...");

  // 1. Fetch the assembled planning prompt from the cloud API
  const promptResponse = await api.get("/api/agent/planning-prompt", {
    params: { taskId: task.id },
  });
  const { prompt, model } = promptResponse.data;

  const cliModel = model || "sonnet";
  console.log(`${ts()} ${taskLabel} Running Claude CLI ${chalk.dim(`(model: ${chalk.yellow(cliModel)})`)}`);
  await postLog(task.id, `Starting planning agent (model: ${cliModel})...`);

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
      `Planning agent failed after ${elapsed}s: ${errMsg.substring(0, 200)}`,
      "error",
      "error",
    );
    return false;
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`${ts()} ${taskLabel} ${chalk.green("✓")} Claude CLI done ${chalk.dim(`(${elapsed}s, ${rawOutput.length} chars)`)}`);
  await postLog(
    task.id,
    `Planning complete (${elapsed}s, ${rawOutput.length} chars). Validating plan...`,
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
      `Plan validated: ${storyCount} stories. Task queued for execution.`,
    );
    return true;
  } catch (error: unknown) {
    const err = error as { response?: { data?: { detail?: string } } };
    const detail = err.response?.data?.detail || String(error);
    console.error(`${ts()} ${taskLabel} ${chalk.red("✗")} Validation failed: ${detail.substring(0, 100)}`);
    await postLog(
      task.id,
      `Plan validation failed: ${detail.substring(0, 200)}`,
      "error",
      "error",
    );
    return false;
  }
}
