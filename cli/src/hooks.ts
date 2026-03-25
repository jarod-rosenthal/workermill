import { execSync } from "child_process";
import type { HooksConfig } from "./config.js";
import * as logger from "./logger.js";

export function runHooks(
  phase: "pre" | "post",
  toolName: string,
  hooks: HooksConfig | undefined,
  workingDir: string,
): void {
  if (!hooks) return;
  const hookList = phase === "pre" ? hooks.pre : hooks.post;
  if (!hookList) return;

  for (const hook of hookList) {
    // Check if this hook applies to this tool
    if (hook.tools && hook.tools.length > 0 && !hook.tools.includes("*") && !hook.tools.includes(toolName)) {
      continue;
    }

    try {
      execSync(hook.command, {
        cwd: workingDir,
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 30000, // 30s max per hook
        env: { ...process.env, WORKERMILL_TOOL: toolName, WORKERMILL_PHASE: phase },
      });
    } catch (err) {
      logger.error(`Hook failed (${phase} ${toolName}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
