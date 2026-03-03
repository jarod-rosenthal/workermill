/**
 * Inline Integration Fix Agent for Epic Mode
 *
 * Runs quality gates on the consolidated feature branch after all story branches
 * are merged but BEFORE the Tech Lead review. If gates fail, spawns a fix agent
 * with full access to the consolidated branch to resolve cross-story integration issues.
 * Follows the InlineCIFixer pattern.
 */

import axios from "axios";
import { execSync, spawn } from "child_process";
import { existsSync, readdirSync, statSync } from "fs";
import { runAgent, type AgentOptions, type AgentResult } from "./agent-sdk.js";
import { runGateCommand } from "./gate-utils.js";
import type { EpicConfig, StreamMessage } from "./types.js";
import {
  createAIClient,
  type AIClient,
  type AIClientOptions,
} from "./ai-client-types.js";

/**
 * Integration fix decision from the agent.
 */
export type IntegrationFixDecision = "passed" | "fixed" | "unfixable";

/**
 * Result of an inline integration fix attempt.
 */
export interface IntegrationFixResult {
  success: boolean;
  decision: IntegrationFixDecision;
  summary: string;
  error?: string;
}

/**
 * System prompt for the Integration Fix Agent.
 */
const INTEGRATION_FIX_SYSTEM_PROMPT = `You are an Integration Fix Agent. Multiple AI experts worked on separate story branches in parallel. Their code has been merged into a consolidated branch, but the merge introduced integration issues.

Fix ALL quality gate failures. You have access to ALL files in the repository.

***REMOVED******REMOVED*** Common Integration Issues

- Missing props/types from one story expected by another
- Duplicate test query selectors or test IDs
- Conflicting imports or re-exports
- Merge artifacts (<<<< ==== >>>>)
- Incompatible function signatures across story boundaries
- Missing dependencies that one story assumed another would provide

***REMOVED******REMOVED*** Rules

- Fix EVERY failing command, not just the first
- Run each command after fixing to verify
- Do NOT refactor beyond what's needed to pass gates
- Commit with message "fix: resolve integration issues from story consolidation"
- Push to current branch

***REMOVED******REMOVED*** Organization Guidelines

If the following org-level guidelines were provided, follow them:

{{ORG_GUIDELINES}}

***REMOVED******REMOVED*** Output Format

After fixing (or determining it's unfixable), you MUST output these markers:

\`\`\`
INTEGRATION_FIX_DECISION: passed | fixed | unfixable
\`\`\`

Then add:
\`\`\`
INTEGRATION_FIX_SUMMARY: <description of what you fixed or why it's unfixable>
\`\`\`

***REMOVED******REMOVED*** Communication Style

Write in a professional, direct tone. Do NOT open messages with filler words or pleasantries like "Perfect!", "Great!", "Awesome!", "Sure!", "Absolutely!", or similar. Start with the substance — what you found, your assessment, or what needs to change. Be concise and informative.
`;

/**
 * Inline Integration Fix Agent for Epic mode.
 *
 * Runs quality gates on the consolidated branch after PR creation.
 * If gates fail, spawns an agent to fix cross-story integration issues.
 */
export class InlineIntegrationFixer {
  private config: EpicConfig;
  private repoPath: string;
  private logsApi: ReturnType<typeof axios.create>;
  private allOutput: string = "";
  private aiClient: AIClient | null = null;
  private model: string;

  constructor(config: EpicConfig, repoPath: string) {
    this.config = config;
    this.repoPath = repoPath;
    this.model = process.env.MANAGER_MODEL || config.model || "";

    this.logsApi = axios.create({
      baseURL: config.apiBaseUrl,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.orgApiKey,
      },
      timeout: 5000,
    });

    if (config.useUnifiedClient) {
      this.aiClient = createAIClient({
        provider: "anthropic",
        apiKeys: { anthropic: config.anthropicApiKey },
        apiConfig: {
          baseUrl: config.apiBaseUrl,
          orgApiKey: config.orgApiKey,
        },
        useAgentSdk: true,
        githubToken: config.githubToken,
      });
    }
  }

  /**
   * Execute an agent using either the unified AIClient or legacy runAgent.
   */
  private async executeAgent(
    options: AgentOptions,
    storyId: string,
    onMessage?: (msg: StreamMessage) => void
  ): Promise<AgentResult> {
    if (
      this.config.useUnifiedClient &&
      this.aiClient &&
      options.expertConfig
    ) {
      const clientOptions: AIClientOptions = {
        prompt: options.prompt,
        systemPrompt: options.expertConfig.systemPrompt,
        persona: options.expertConfig.persona,
        model: options.expertConfig.model,
        workingDir: options.repoPath,
        storyId,
        parentTaskId: this.config.parentTaskId,
        env: options.env,
        tools: options.expertConfig.tools,
        onMessage,
      };
      const result = await this.aiClient.execute(clientOptions);
      return {
        success: result.success,
        messages: result.messages,
        error: result.error,
        structuredOutput: result.structuredOutput,
      };
    }
    return runAgent(this.config, { ...options, onMessage });
  }

  /**
   * Post a log message to the WorkerMill dashboard.
   */
  private async postLog(
    message: string,
    type: "system" | "manager" | "tool" | "output" | "error" = "output"
  ): Promise<void> {
    const prefix = "[🔗 integration_agent 🤖]";
    console.log(`${prefix} ${message}`);

    try {
      await this.logsApi.post("/api/control-center/logs", {
        taskId: this.config.parentTaskId,
        type,
        message: `${prefix} ${message}`,
        severity: type === "error" ? "error" : "info",
      });
    } catch {
      // Fire and forget - don't block on log failures
    }
  }

  /**
   * Run quality gates on the consolidated branch and fix if needed.
   */
  async fix(
    prNumber: number,
    qualityGateCommands: NonNullable<EpicConfig["qualityGateCommands"]>
  ): Promise<IntegrationFixResult> {
    this.allOutput = "";

    if (!qualityGateCommands || qualityGateCommands.length === 0) {
      return { success: true, decision: "passed", summary: "No quality gates configured" };
    }

    await this.postLog("Starting integration quality gate check", "system");
    await this.postLog(`PR ***REMOVED***${prNumber} — checking ${qualityGateCommands.length} gate(s)`, "system");

    try {
      // Install subdirectory deps first (same pattern as executor.ts)
      await this.installSubdirectoryDeps();

      // Re-run tool installer if available (Docker containers only)
      this.runToolInstaller();

      // Run all quality gate commands
      const gateResult = await this.runAllGates(qualityGateCommands);

      if (gateResult.passed) {
        await this.postLog("All integration gates passed", "system");
        return { success: true, decision: "passed", summary: "All quality gates passed on consolidated branch" };
      }

      // Gates failed — spawn fix agent
      await this.postLog(`Integration gate failed: ${gateResult.failedCommand}`, "error");
      await this.postLog("Spawning Integration Fix Agent...", "system");

      const fixResult = await this.runFixAgent(prNumber, qualityGateCommands, gateResult.output, gateResult.failedCommand);

      if (!fixResult.success) {
        await this.postLog(`Fix agent failed: ${fixResult.error}`, "error");
        return {
          success: false,
          decision: "unfixable",
          summary: `Fix agent execution failed: ${fixResult.error}`,
          error: fixResult.error,
        };
      }

      const decision = this.parseDecision();
      const summary = this.parseSummary();

      // Verify gates pass after fix
      if (decision === "fixed") {
        await this.postLog("Verifying gates pass after fix...", "system");
        const verifyResult = await this.runAllGates(qualityGateCommands);
        if (!verifyResult.passed) {
          await this.postLog("Gates still failing after fix attempt", "error");
          return {
            success: false,
            decision: "unfixable",
            summary: `Fix agent reported fixed but gates still fail: ${verifyResult.failedCommand}`,
          };
        }
        await this.postLog("Verified — all gates passing after fix", "system");
      }

      await this.postLog(`Decision: ${decision}`, "system");
      await this.postLog(`Summary: ${summary}`, "system");

      return {
        success: decision === "fixed",
        decision,
        summary,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.postLog(`Integration fix failed: ${errorMessage}`, "error");

      return {
        success: false,
        decision: "unfixable",
        summary: `Integration fix error: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  /**
   * Run all quality gate commands (not filtered by trigger — full integration check).
   */
  private async runAllGates(
    gates: NonNullable<EpicConfig["qualityGateCommands"]>
  ): Promise<{ passed: boolean; output: string; failedCommand: string }> {
    for (const gate of gates) {
      // Skip gate if the trigger directory doesn't exist in the repo.
      // Prevents failures like `cd web && npm run lint` when the `web/` directory
      // hasn't been created yet by any story in this run.
      const triggerPrefix = gate.trigger.replace(/\*\*/g, "").replace(/\*/g, "").replace(/\/+$/, "");
      if (triggerPrefix && !existsSync(`${this.repoPath}/${triggerPrefix}`)) {
        await this.postLog(`[Integration Gate] ⏭️ ${gate.name} gate skipped — directory '${triggerPrefix}/' does not exist`, "system");
        continue;
      }

      // For Go gates, skip if go.mod doesn't exist in the target directory.
      const hasGoCommand = gate.commands.some((c) => /\bgo\s+(vet|test|build)\b/.test(c));
      if (hasGoCommand) {
        const goModPath = triggerPrefix
          ? `${this.repoPath}/${triggerPrefix}/go.mod`
          : `${this.repoPath}/go.mod`;
        if (!existsSync(goModPath)) {
          await this.postLog(`[Integration Gate] ⏭️ ${gate.name} gate skipped — no go.mod found`, "system");
          continue;
        }
      }

      await this.postLog(`[Integration Gate] Running ${gate.name} (${gate.commands.length} commands)`, "system");

      for (let cmd of gate.commands) {
        // Fix common LLM mistake: gofmt doesn't support Go's "..." wildcard
        cmd = cmd.replace(
          /\bgofmt\b(.+?)\.\/([^\s]*)\.\.\./g,
          "gofmt$1./$2"
        );

        try {
          const result = await this.runGateCommand(cmd, this.repoPath, 300_000);
          const output = [result.stdout, result.stderr]
            .filter(Boolean)
            .join("\n");

          // Handle watch-mode processes
          const wasWatchMode =
            /waiting for file changes|press [hq] to/i.test(output);
          if (wasWatchMode) {
            const testsPassedPatterns = [
              /Tests?\s+\d+\s+passed/i,
              /Test Files?\s+\d+\s+passed/i,
              /Test Suites?:\s+\d+\s+passed/i,
            ];
            if (
              testsPassedPatterns.some((p) => p.test(output)) &&
              !/\d+\s+failed/i.test(output)
            ) {
              await this.postLog(`[Integration Gate] ✅ ${cmd}`, "system");
            } else {
              await this.postLog(`[Integration Gate] ❌ ${cmd}\n${output}`, "error");
              return { passed: false, output, failedCommand: cmd };
            }
          } else {
            await this.postLog(`[Integration Gate] ✅ ${cmd}`, "system");
          }
        } catch (error: unknown) {
          const stderr =
            error instanceof Error && "stderr" in error
              ? String((error as { stderr: unknown }).stderr).slice(0, 2000)
              : String(error).slice(0, 2000);
          const stdout =
            error instanceof Error && "stdout" in error
              ? String((error as { stdout: unknown }).stdout).slice(0, 2000)
              : "";
          const output = [stdout, stderr].filter(Boolean).join("\n");

          // "No test files found" is not a real failure
          const noTestsPatterns = [
            /no test files found/i,
            /no tests found/i,
            /no test suites found/i,
            /no tests to run/i,
            /collected 0 items/i,
          ];
          if (noTestsPatterns.some((p) => p.test(output))) {
            await this.postLog(`[Integration Gate] ⏭️ ${cmd} — no test files, skipping`, "system");
            continue;
          }

          await this.postLog(`[Integration Gate] ❌ ${cmd}\n${output}`, "error");
          return { passed: false, output, failedCommand: cmd };
        }
      }
    }

    return { passed: true, output: "", failedCommand: "" };
  }

  /**
   * Delegate to shared gate-utils.ts runGateCommand.
   */
  private runGateCommand(
    cmd: string,
    cwd: string,
    timeoutMs: number = 300_000
  ): Promise<{ stdout: string; stderr: string }> {
    return runGateCommand(cmd, cwd, timeoutMs);
  }

  /**
   * Install npm/yarn/pnpm deps in subdirectories that have package.json but no node_modules.
   * Reused from executor.ts findSubdirsNeedingInstall pattern.
   */
  private async installSubdirectoryDeps(): Promise<void> {
    try {
      const dirsToInstall = this.findSubdirsNeedingInstall(this.repoPath, 3);
      for (const dir of dirsToInstall) {
        const lockType = existsSync(`${dir}/pnpm-lock.yaml`)
          ? "pnpm"
          : existsSync(`${dir}/yarn.lock`)
            ? "yarn"
            : "npm";
        const installCmd =
          lockType === "pnpm"
            ? "pnpm install --frozen-lockfile"
            : lockType === "yarn"
              ? "yarn install --frozen-lockfile"
              : "npm ci";
        const relDir = dir.replace(this.repoPath + "/", "");
        await this.postLog(`[Integration Gate] Installing deps in ${relDir} (${lockType})`, "system");
        try {
          execSync(installCmd, {
            cwd: dir,
            encoding: "utf-8",
            timeout: 120_000,
            stdio: ["pipe", "pipe", "pipe"],
          });
        } catch {
          await this.postLog(`[Integration Gate] Warning: dep install failed in ${relDir}`, "system");
        }
      }
    } catch {
      // Scan itself failed — proceed without installing
    }
  }

  /**
   * Find subdirectories with package.json that need dep installation.
   * Always includes directories with package.json — even if node_modules/ exists —
   * because a partial node_modules can leave gate tools like eslint missing.
   */
  private findSubdirsNeedingInstall(
    root: string,
    maxDepth: number
  ): string[] {
    const results: string[] = [];
    const scan = (dir: string, depth: number) => {
      if (depth > maxDepth) return;
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry === "node_modules" || entry === ".git") continue;
        const full = `${dir}/${entry}`;
        try {
          if (!statSync(full).isDirectory()) continue;
        } catch {
          continue;
        }
        if (existsSync(`${full}/package.json`)) {
          results.push(full);
        }
        scan(full, depth + 1);
      }
    };
    scan(root, 1);
    return results;
  }

  /**
   * Re-run tool installer if available (Docker containers only).
   */
  private runToolInstaller(): void {
    try {
      const fs = require("fs");
      fs.accessSync("/app/install-tools.sh");
      execSync(`/app/install-tools.sh "${this.repoPath}"`, {
        cwd: this.repoPath,
        encoding: "utf-8",
        timeout: 120_000,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      // Best effort — script missing (native agent) or install failed
    }
  }

  /**
   * Spawn the fix agent to resolve integration issues.
   */
  private async runFixAgent(
    prNumber: number,
    gates: NonNullable<EpicConfig["qualityGateCommands"]>,
    failureOutput: string,
    failedCommand: string
  ): Promise<AgentResult> {
    const prompt = this.buildFixPrompt(prNumber, gates, failureOutput, failedCommand);

    const systemPrompt = INTEGRATION_FIX_SYSTEM_PROMPT.replace(
      "{{ORG_GUIDELINES}}",
      this.config.orgGuidelines
        ? this.config.orgGuidelines
        : "(none set — skip this section)"
    );

    const fixConfig = {
      persona: "qa_engineer" as const,
      description: "Integration fix specialist — cross-story issue resolution",
      systemPrompt,
      tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
      model: this.model,
      specialties: ["testing", "integration", "quality"],
      maxTurns: 20,
    };

    return this.executeAgent(
      {
        prompt,
        expertConfig: fixConfig,
        repoPath: this.repoPath,
        storyId: `integration-fix-${prNumber}`,
      },
      `integration-fix-${prNumber}`,
      (msg) => this.handleMessage(msg)
    );
  }

  /**
   * Build the user prompt for the fix agent.
   */
  private buildFixPrompt(
    prNumber: number,
    gates: NonNullable<EpicConfig["qualityGateCommands"]>,
    failureOutput: string,
    failedCommand: string
  ): string {
    const maxLogLength = 8 * 1024;
    const truncatedOutput =
      failureOutput.length > maxLogLength
        ? failureOutput.substring(failureOutput.length - maxLogLength)
        : failureOutput;

    const allCommands = gates
      .flatMap((g) => g.commands.map((c) => `  - ${c} (${g.name})`))
      .join("\n");

    return `***REMOVED******REMOVED*** Integration Gate Failure on PR ***REMOVED***${prNumber}

**Repository:** ${this.config.targetRepo}

***REMOVED******REMOVED******REMOVED*** Failed Command

\`${failedCommand}\`

***REMOVED******REMOVED******REMOVED*** Failure Output

\`\`\`
${truncatedOutput}
\`\`\`

***REMOVED******REMOVED******REMOVED*** All Quality Gate Commands

${allCommands}

***REMOVED******REMOVED******REMOVED*** Instructions

This is a consolidated branch where multiple expert story branches have been merged.
The failure is likely caused by cross-story integration issues, not a bug in any single story.

1. Diagnose the root cause of the failure
2. Fix ALL integration issues (there may be more than what the first failing command shows)
3. Run each quality gate command to verify your fixes
4. Commit with message "fix: resolve integration issues from story consolidation"
5. Push to the current branch`;
  }

  /**
   * Parse INTEGRATION_FIX_DECISION from agent output.
   */
  private parseDecision(): IntegrationFixDecision {
    const match = this.allOutput.match(
      /INTEGRATION_FIX_DECISION:\s*(passed|fixed|unfixable)/i
    );
    if (match) {
      return match[1].toLowerCase() as IntegrationFixDecision;
    }
    return "unfixable";
  }

  /**
   * Parse INTEGRATION_FIX_SUMMARY from agent output.
   */
  private parseSummary(): string {
    const match = this.allOutput.match(/INTEGRATION_FIX_SUMMARY:\s*(.+)/i);
    if (match) {
      return match[1].trim();
    }
    return "No summary provided";
  }

  /**
   * Handle streaming messages from the agent.
   */
  private handleMessage(msg: StreamMessage): void {
    if (msg.type === "thinking" && msg.content) {
      this.postLog(`[THINKING] ${msg.content}`, "output");
    } else if (msg.type === "tool_use" && msg.toolName) {
      let toolMsg = `Tool: ${msg.toolName}`;
      if (msg.toolInput) {
        const input = msg.toolInput;
        if (input.command)
          toolMsg += ` -> ${String(input.command).substring(0, 500)}`;
        else if (input.file_path) toolMsg += ` -> ${input.file_path}`;
      }
      this.postLog(toolMsg, "tool");
    } else if (msg.type === "text" && msg.content) {
      this.allOutput += msg.content + "\n";
      if (msg.content.length > 20) {
        this.postLog(msg.content, "output");
      }
    } else if (msg.type === "result" && msg.content) {
      this.allOutput += msg.content + "\n";
      this.postLog(msg.content, "output");
    }
  }
}
