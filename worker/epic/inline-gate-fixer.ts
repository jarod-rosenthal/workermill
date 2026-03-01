/**
 * Inline Gate Fix Agent for Epic Mode
 *
 * Surgically fixes quality gate failures without re-executing entire stories.
 * Spawns a Claude agent with cwd pointed at the existing worktree to fix
 * only the failing gate commands, then re-runs them to verify.
 * Follows the InlineCIFixer pattern.
 */

import axios from "axios";
import { runAgent, type AgentOptions, type AgentResult } from "./agent-sdk.js";
import { runGateCommand } from "./gate-utils.js";
import type { EpicConfig, StreamMessage } from "./types.js";
import {
  createAIClient,
  type AIClient,
  type AIClientOptions,
} from "./ai-client-types.js";

/**
 * Gate fix decision from the agent.
 */
export type GateFixDecision = "fixed" | "unfixable";

/**
 * Result of an inline gate fix attempt.
 */
export interface GateFixResult {
  success: boolean;
  decision: GateFixDecision;
  summary: string;
  error?: string;
}

/**
 * System prompt for the Gate Fix Agent.
 */
const GATE_FIX_SYSTEM_PROMPT = `You are a Gate Fix Agent. A pre-commit quality gate has failed on code written by another expert.
Your job is to make the MINIMUM surgical fix to make the failing gate commands pass.

You have the gate failure output below. Diagnose the exact issue and fix it.

***REMOVED******REMOVED*** Rules

- Only fix what the quality gate is complaining about. Do NOT refactor or improve other code.
- Common fixes: remove unused imports/variables, fix type errors, fix lint errors, fix build errors, fix formatting.
- Run the failing command locally to verify your fix before finishing.
- You have \`docker\` and \`docker compose\` available. If tests need service dependencies (MongoDB, Redis, Postgres, etc.), spin them up as sibling containers (e.g. \`docker run -d --rm -p 27017:27017 --name mongo-test mongo:7\`). Clean up when done.
- After fixing, stage and commit your changes (e.g. \`git add -A && git commit -m "fix: quality gate"\`). The executor will push after you finish.

***REMOVED******REMOVED*** Organization Guidelines

If the following org-level guidelines were provided, follow them:

{{ORG_GUIDELINES}}

***REMOVED******REMOVED*** Output Format

After fixing (or determining it's unfixable), you MUST output these markers:

\`\`\`
GATE_FIX_DECISION: fixed
\`\`\`
OR
\`\`\`
GATE_FIX_DECISION: unfixable
\`\`\`

Then add:
\`\`\`
GATE_FIX_SUMMARY: <what you fixed or why it's unfixable>
\`\`\`

***REMOVED******REMOVED*** Communication Style

Write in a professional, direct tone. Do NOT open messages with filler words or pleasantries like "Perfect!", "Great!", "Awesome!", "Sure!", "Absolutely!", or similar. Start with the substance — what you found, your assessment, or what needs to change. Be concise and informative.
`;

/**
 * Inline Gate Fix Agent for Epic mode.
 *
 * Surgically fixes quality gate failures in an existing worktree
 * without re-executing the entire story.
 */
export class InlineGateFixer {
  private config: EpicConfig;
  private worktreePath: string;
  private gateOutput: string;
  private gateCommands: string[];
  private expert: string;
  private logsApi: ReturnType<typeof axios.create>;
  private allOutput: string = "";
  private aiClient: AIClient | null = null;
  private model: string;
  private previousAttempts?: Array<{ attempt: number; errorSnippet: string; failedCommand: string }>;

  constructor(
    config: EpicConfig,
    worktreePath: string,
    gateOutput: string,
    gateCommands: string[],
    expert: string,
    previousAttempts?: Array<{ attempt: number; errorSnippet: string; failedCommand: string }>,
  ) {
    this.config = config;
    this.worktreePath = worktreePath;
    this.gateOutput = gateOutput;
    this.gateCommands = gateCommands;
    this.expert = expert;
    this.previousAttempts = previousAttempts;
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
    const prefix = "[🔧 gate_fixer 🤖]";
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
   * Attempt to fix quality gate failures in the worktree.
   */
  async run(): Promise<GateFixResult> {
    this.allOutput = "";

    await this.postLog("Starting Gate Fix Agent", "system");
    await this.postLog(
      `Expert: ${this.expert} — ${this.gateCommands.length} failing command(s)`,
      "system"
    );

    try {
      const prompt = this.buildPrompt();

      const systemPrompt = GATE_FIX_SYSTEM_PROMPT.replace(
        "{{ORG_GUIDELINES}}",
        this.config.orgGuidelines
          ? this.config.orgGuidelines
          : "(none set — skip this section)"
      );

      const gateFixConfig = {
        persona: "qa_engineer" as const,
        description: "QA specialist — surgical quality gate fix",
        systemPrompt,
        tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
        model: this.model,
        specialties: ["testing", "quality", "linting"],
        maxTurns: 15,
      };

      const result = await this.executeAgent(
        {
          prompt,
          expertConfig: gateFixConfig,
          repoPath: this.worktreePath,
          storyId: `gate-fix-${this.expert}`,
        },
        `gate-fix-${this.expert}`,
        (msg) => this.handleMessage(msg)
      );

      if (!result.success) {
        await this.postLog(`Gate Fix Agent failed: ${result.error}`, "error");
        return {
          success: false,
          decision: "unfixable",
          summary: `Agent execution failed: ${result.error}`,
          error: result.error,
        };
      }

      const decision = this.parseDecision();
      const summary = this.parseSummary();

      // Verify gates pass after fix
      if (decision === "fixed") {
        await this.postLog("Verifying gate commands pass after fix...", "system");
        const verifyResult = await this.runGateCommands();
        if (!verifyResult.passed) {
          await this.postLog(
            `Gates still failing after fix attempt: ${verifyResult.failedCommand}`,
            "error"
          );
          return {
            success: false,
            decision: "unfixable",
            summary: `Fix agent reported fixed but gates still fail: ${verifyResult.failedCommand}`,
          };
        }
        await this.postLog("Verified — all gate commands passing after fix", "system");
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
      await this.postLog(`Gate fix failed: ${errorMessage}`, "error");

      return {
        success: false,
        decision: "unfixable",
        summary: `Gate fix error: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  /**
   * Build the user prompt with gate failure context.
   */
  private buildPrompt(): string {
    // Truncate gate output to 8KB to stay within context limits
    const maxLogLength = 8 * 1024;
    const truncatedOutput =
      this.gateOutput.length > maxLogLength
        ? this.gateOutput.substring(this.gateOutput.length - maxLogLength)
        : this.gateOutput;

    const commandList = this.gateCommands.map((c) => `  - ${c}`).join("\n");

    let previousAttemptsSection = "";
    if (this.previousAttempts && this.previousAttempts.length > 0) {
      const attemptEntries = this.previousAttempts
        .map(
          (a) =>
            `**Attempt ${a.attempt}** (command: \`${a.failedCommand}\`):\n\`\`\`\n${a.errorSnippet.slice(0, 500)}\n\`\`\``
        )
        .join("\n\n");

      previousAttemptsSection = `

***REMOVED******REMOVED******REMOVED*** Previous Fix Attempts (ALL FAILED)

This gate has failed ${this.previousAttempts.length} time(s) already. Previous attempts to fix it did NOT work.

${attemptEntries}

CRITICAL: The previous approach DID NOT WORK. You MUST try a fundamentally
different strategy. Do NOT repeat the same fix pattern.

If the error involves test code:
- Try a completely different testing approach (integration test instead of unit mock,
  or skip the problematic test and document why)
- If a mocking library or pattern keeps failing, switch to a simpler approach
- Consider whether the test is testing implementation details vs behavior
`;
    }

    return `***REMOVED******REMOVED*** Quality Gate Failure

**Repository:** ${this.config.targetRepo}

***REMOVED******REMOVED******REMOVED*** Failed Gate Commands

${commandList}

***REMOVED******REMOVED******REMOVED*** Gate Failure Output

\`\`\`
${truncatedOutput}
\`\`\`
${previousAttemptsSection}
***REMOVED******REMOVED******REMOVED*** Instructions

The following quality gate commands failed. Fix ONLY the errors shown. Do not rewrite unrelated code.

1. Diagnose the root cause of each failure
2. Make the minimum surgical fix
3. Run each failing command to verify your fix:
${commandList}
4. Stage and commit your changes (e.g. \`git add -A && git commit -m "fix: quality gate"\`) — the executor will push`;
  }

  /**
   * Re-run gate commands to verify they pass after the fix.
   */
  private async runGateCommands(): Promise<{
    passed: boolean;
    output: string;
    failedCommand: string;
  }> {
    for (let cmd of this.gateCommands) {
      // Fix common LLM mistake: gofmt doesn't support Go's "..." wildcard
      cmd = cmd.replace(
        /\bgofmt\b(.+?)\.\/([^\s]*)\.\.\./g,
        "gofmt$1./$2"
      );

      try {
        const result = await this.runGateCommand(cmd, this.worktreePath, 300_000);
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
            await this.postLog(`[Gate Verify] ✅ ${cmd}`, "system");
          } else {
            await this.postLog(`[Gate Verify] ❌ ${cmd}\n${output}`, "error");
            return { passed: false, output, failedCommand: cmd };
          }
        } else {
          await this.postLog(`[Gate Verify] ✅ ${cmd}`, "system");
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
          await this.postLog(
            `[Gate Verify] ⏭️ ${cmd} — no test files, skipping`,
            "system"
          );
          continue;
        }

        await this.postLog(`[Gate Verify] ❌ ${cmd}\n${output}`, "error");
        return { passed: false, output, failedCommand: cmd };
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
   * Parse GATE_FIX_DECISION from agent output.
   */
  private parseDecision(): GateFixDecision {
    const match = this.allOutput.match(
      /GATE_FIX_DECISION:\s*(fixed|unfixable)/i
    );
    if (match) {
      return match[1].toLowerCase() as GateFixDecision;
    }
    return "unfixable";
  }

  /**
   * Parse GATE_FIX_SUMMARY from agent output.
   */
  private parseSummary(): string {
    const match = this.allOutput.match(/GATE_FIX_SUMMARY:\s*(.+)/i);
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
      // postLog handles both console.log and API POST — don't double-log
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
