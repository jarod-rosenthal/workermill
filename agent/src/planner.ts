/**
 * Remote Agent Planner
 *
 * Fetches the planning prompt from the cloud API, runs it through
 * Claude CLI locally (using the customer's Claude Max subscription),
 * and posts the raw output back for server-side validation.
 */

import { spawnSync } from "child_process";
import { findClaudePath, type AgentConfig } from "./config.js";
import { api } from "./api.js";

export interface PlanningTask {
  id: string;
  summary: string;
}

/**
 * Run planning for a task: fetch prompt, execute Claude CLI, post result.
 */
export async function planTask(
  task: PlanningTask,
  config: AgentConfig,
): Promise<boolean> {
  console.log(`[planner] Fetching planning prompt for task ${task.id}...`);

  // 1. Fetch the assembled planning prompt from the cloud API
  const promptResponse = await api.get("/api/agent/planning-prompt", {
    params: { taskId: task.id },
  });
  const { prompt, model } = promptResponse.data;

  console.log(`[planner] Running Claude CLI (model: ${model})...`);

  // 2. Run Claude CLI with the prompt
  const claudePath = process.env.CLAUDE_CLI_PATH || findClaudePath() || "claude";
  const cliModel = model || "sonnet";

  // Let Claude CLI manage its own auth via ~/.claude/.credentials.json
  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDE_CODE_OAUTH_TOKEN;

  let rawOutput: string;
  try {
    const result = spawnSync(
      claudePath,
      ["--print", "--model", cliModel, "--permission-mode", "bypassPermissions"],
      {
        input: prompt,
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024, // 50MB
        timeout: 600_000, // 10 minutes
        env: cleanEnv,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    if (result.status !== 0) {
      console.error(`[planner] Claude CLI failed (exit ${result.status}):`, result.stderr?.substring(0, 300));
      return false;
    }
    rawOutput = result.stdout;
  } catch (error: unknown) {
    console.error(`[planner] Claude CLI error:`, error instanceof Error ? error.message : String(error));
    return false;
  }

  console.log(`[planner] Claude CLI completed (${rawOutput.length} chars). Posting result...`);

  // 3. Post raw output back to cloud API for validation
  try {
    const result = await api.post("/api/agent/plan-result", {
      taskId: task.id,
      rawOutput,
    });

    console.log(
      `[planner] Plan accepted: ${result.data.storyCount} stories. Task status: ${result.data.status}`,
    );
    return true;
  } catch (error: unknown) {
    const err = error as { response?: { data?: { detail?: string } } };
    console.error("[planner] Plan validation failed:", err.response?.data?.detail || String(error));
    return false;
  }
}
