/**
 * Inline Escalation Fix Agent for Epic Mode
 *
 * When surgical gate fixes fail repeatedly (same error 2+ times), this agent
 * takes over with FULL context: story requirements, complete error history,
 * coordination feed (what siblings built), and the existing worktree code.
 *
 * Unlike InlineGateFixer (surgical, minimal changes), this agent has authority
 * to fundamentally rewrite the expert's approach — delete files, restructure
 * tests, change patterns entirely. It acts like a senior engineer who can see
 * the full picture and make the right call.
 */

import axios from "axios";
import { runAgent, type AgentOptions, type AgentResult } from "./agent-sdk.js";
import { runGateCommand } from "./gate-utils.js";
import type {
  EpicConfig,
  StreamMessage,
  ReadyStory,
  ContextMessage,
} from "./types.js";
import {
  createAIClient,
  type AIClient,
  type AIClientOptions,
} from "./ai-client-types.js";

export type EscalationFixDecision = "fixed" | "unfixable";

export interface EscalationFixResult {
  success: boolean;
  decision: EscalationFixDecision;
  summary: string;
  error?: string;
}

interface GateErrorEntry {
  attempt: number;
  errorSnippet: string;
  failedCommand: string;
  timestamp: number;
}

const ESCALATION_SYSTEM_PROMPT = `You are a Senior Escalation Engineer. Quality gates have failed repeatedly on code written by another expert, and surgical fixes have not worked. The same error keeps occurring because the expert's fundamental approach is wrong.

You have FULL AUTHORITY to rewrite the expert's approach. You are not limited to surgical fixes — you can delete files, restructure code, change testing strategies, or rewrite entire implementations. Your goal is to make the quality gates pass by taking a fundamentally different approach than what was tried before.

***REMOVED******REMOVED*** What You Have Access To

1. **The existing worktree** — all the code the expert wrote is here. Read it to understand what they attempted.
2. **Story requirements** — what the expert was supposed to build (title, description).
3. **Error history** — every failed attempt with the exact error output. Study these to understand WHY the approach keeps failing.
4. **Coordination context** — what other experts built (completed stories, branches). This tells you what code exists elsewhere that may affect this story.
5. **Gate commands** — the exact commands that must pass.

***REMOVED******REMOVED*** Your Process

1. Read the error history carefully — understand the PATTERN of failure, not just the latest error
2. Read the expert's code in the worktree to understand what approach they took
3. Check the coordination context to understand sibling dependencies
4. Decide on a fundamentally different approach
5. Implement it — you may delete and rewrite files entirely
6. Run the gate commands yourself to verify they pass
7. Stage and commit your changes

***REMOVED******REMOVED*** Key Principles

- The previous approach DOES NOT WORK. Do not iterate on it — change it.
- If the expert wrote complex mocks/test patterns that keep failing, use a simpler approach (integration tests, table-driven tests, minimal interfaces)
- If a library or import keeps causing issues, find an alternative or simplify
- A passing simple implementation is better than a failing complex one
- It is acceptable to reduce scope to make gates pass — document what was simplified and why

***REMOVED******REMOVED*** Organization Guidelines

{{ORG_GUIDELINES}}

***REMOVED******REMOVED*** Output Format

After fixing (or determining it's unfixable), you MUST output these markers:

\`\`\`
ESCALATION_FIX_DECISION: fixed
\`\`\`
OR
\`\`\`
ESCALATION_FIX_DECISION: unfixable
\`\`\`

Then add:
\`\`\`
ESCALATION_FIX_SUMMARY: <what you changed and why the new approach works>
\`\`\`

***REMOVED******REMOVED*** Communication Style

Write in a professional, direct tone. Do NOT open messages with filler words or pleasantries. Start with the substance — what you found, your assessment, what you're changing.
`;

export class InlineEscalationFixer {
  private config: EpicConfig;
  private worktreePath: string;
  private story: ReadyStory;
  private gateCommands: string[];
  private expert: string;
  private errorHistory: GateErrorEntry[];
  private coordinationContext: ContextMessage[];
  private logsApi: ReturnType<typeof axios.create>;
  private allOutput: string = "";
  private aiClient: AIClient | null = null;
  private model: string;

  constructor(
    config: EpicConfig,
    worktreePath: string,
    story: ReadyStory,
    gateCommands: string[],
    expert: string,
    errorHistory: GateErrorEntry[],
    coordinationContext: ContextMessage[],
  ) {
    this.config = config;
    this.worktreePath = worktreePath;
    this.story = story;
    this.gateCommands = gateCommands;
    this.expert = expert;
    this.errorHistory = errorHistory;
    this.coordinationContext = coordinationContext;
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

  private async executeAgent(
    options: AgentOptions,
    storyId: string,
    onMessage?: (msg: StreamMessage) => void,
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

  private async postLog(
    message: string,
    type: "system" | "manager" | "tool" | "output" | "error" = "output",
  ): Promise<void> {
    const prefix = "[🚨 escalation_fixer 🤖]";
    console.log(`${prefix} ${message}`);

    try {
      await this.logsApi.post("/api/control-center/logs", {
        taskId: this.config.parentTaskId,
        type,
        message: `${prefix} ${message}`,
        severity: type === "error" ? "error" : "info",
      });
    } catch {
      // Fire and forget
    }
  }

  async run(): Promise<EscalationFixResult> {
    this.allOutput = "";

    await this.postLog(
      `Escalation triggered — ${this.errorHistory.length} failed attempts on story "${this.story.title}"`,
      "system",
    );
    await this.postLog(
      `Expert: ${this.expert} | Failed command: ${this.errorHistory[this.errorHistory.length - 1]?.failedCommand ?? "unknown"}`,
      "system",
    );

    try {
      const prompt = this.buildPrompt();

      const systemPrompt = ESCALATION_SYSTEM_PROMPT.replace(
        "{{ORG_GUIDELINES}}",
        this.config.orgGuidelines
          ? this.config.orgGuidelines
          : "(none set — skip this section)",
      );

      const escalationConfig = {
        persona: "tech_lead" as const,
        description: "Senior Escalation Engineer — full-context approach rewrite",
        systemPrompt,
        tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
        model: this.model,
        specialties: ["debugging", "architecture", "testing", "refactoring"],
        maxTurns: 25,
      };

      const result = await this.executeAgent(
        {
          prompt,
          expertConfig: escalationConfig,
          repoPath: this.worktreePath,
          storyId: `escalation-fix-${this.expert}-story-${this.story.storyIndex}`,
        },
        `escalation-fix-${this.expert}-story-${this.story.storyIndex}`,
        (msg) => this.handleMessage(msg),
      );

      if (!result.success) {
        await this.postLog(`Escalation agent failed: ${result.error}`, "error");
        return {
          success: false,
          decision: "unfixable",
          summary: `Escalation agent execution failed: ${result.error}`,
          error: result.error,
        };
      }

      const decision = this.parseDecision();
      const summary = this.parseSummary();

      if (decision === "fixed") {
        await this.postLog("Verifying gate commands pass after escalation fix...", "system");
        const verifyResult = await this.runGateCommands();
        if (!verifyResult.passed) {
          await this.postLog(
            `Gates still failing after escalation fix: ${verifyResult.failedCommand}`,
            "error",
          );
          return {
            success: false,
            decision: "unfixable",
            summary: `Escalation agent reported fixed but gates still fail: ${verifyResult.failedCommand}`,
          };
        }
        await this.postLog("Verified — all gate commands passing after escalation fix", "system");
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
      await this.postLog(`Escalation fix failed: ${errorMessage}`, "error");

      return {
        success: false,
        decision: "unfixable",
        summary: `Escalation fix error: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  private buildPrompt(): string {
    const commandList = this.gateCommands.map((c) => `  - ${c}`).join("\n");

    // Build error history section
    const historyEntries = this.errorHistory
      .map(
        (h) =>
          `***REMOVED******REMOVED******REMOVED*** Attempt ${h.attempt} (command: \`${h.failedCommand}\`)\n\`\`\`\n${h.errorSnippet.slice(0, 800)}\n\`\`\``,
      )
      .join("\n\n");

    // Build coordination context section — what siblings completed
    const completions = this.coordinationContext
      .filter((c) => c.messageType === "completion")
      .map((c) => `- **${c.persona}**: ${c.content.slice(0, 300)}`)
      .join("\n");

    const decisions = this.coordinationContext
      .filter((c) => c.messageType === "decision")
      .map((c) => `- **${c.persona}**: ${c.content.slice(0, 200)}`)
      .join("\n");

    const fileChanges = this.coordinationContext
      .filter(
        (c) =>
          c.messageType === "file_created" ||
          c.messageType === "file_modified",
      )
      .map((c) => `- ${c.content.slice(0, 200)}`)
      .join("\n");

    let coordinationSection = "";
    if (completions || decisions || fileChanges) {
      coordinationSection = `***REMOVED******REMOVED*** Coordination Context — What Other Experts Built

This is what other experts in the same epic have completed. Their code is already merged into this worktree via sibling rebase. Use this to understand dependencies and available code.

`;
      if (completions) {
        coordinationSection += `***REMOVED******REMOVED******REMOVED*** Completed Stories\n\n${completions}\n\n`;
      }
      if (fileChanges) {
        coordinationSection += `***REMOVED******REMOVED******REMOVED*** Files Created/Modified by Siblings\n\n${fileChanges}\n\n`;
      }
      if (decisions) {
        coordinationSection += `***REMOVED******REMOVED******REMOVED*** Technical Decisions\n\n${decisions}\n\n`;
      }
    }

    return `***REMOVED******REMOVED*** Escalation: Repeated Quality Gate Failure

**Repository:** ${this.config.targetRepo}

***REMOVED******REMOVED*** Story Requirements

**Title:** ${this.story.title}
**Description:** ${this.story.description}
**Expert:** ${this.expert} (persona: ${this.story.persona})
${this.story.targetFiles?.length ? `**Target Files:** ${this.story.targetFiles.join(", ")}` : ""}

***REMOVED******REMOVED*** Error History — ${this.errorHistory.length} Failed Attempts

The following attempts ALL failed with the same fundamental issue. Study the pattern.

${historyEntries}

***REMOVED******REMOVED*** Gate Commands That Must Pass

${commandList}

${coordinationSection}
***REMOVED******REMOVED*** Instructions

1. Read the error history above — understand WHY the same error keeps happening
2. Read the expert's code in this worktree to see what approach they took
3. Decide on a FUNDAMENTALLY DIFFERENT approach (do not iterate on the broken one)
4. Implement the new approach — you may delete and rewrite files entirely
5. Run each gate command to verify:
${commandList}
6. Stage and commit your changes (e.g. \`git add -A && git commit -m "fix: escalation rewrite — <what you changed>"\`) — the executor will push`;
  }

  private async runGateCommands(): Promise<{
    passed: boolean;
    output: string;
    failedCommand: string;
  }> {
    for (let cmd of this.gateCommands) {
      cmd = cmd.replace(
        /\bgofmt\b(.+?)\.\/([^\s]*)\.\.\./g,
        "gofmt$1./$2",
      );

      try {
        const result = await runGateCommand(cmd, this.worktreePath, 300_000);
        const output = [result.stdout, result.stderr]
          .filter(Boolean)
          .join("\n");

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
            "system",
          );
          continue;
        }

        await this.postLog(`[Gate Verify] ❌ ${cmd}\n${output}`, "error");
        return { passed: false, output, failedCommand: cmd };
      }
    }

    return { passed: true, output: "", failedCommand: "" };
  }

  private parseDecision(): EscalationFixDecision {
    const match = this.allOutput.match(
      /ESCALATION_FIX_DECISION:\s*(fixed|unfixable)/i,
    );
    if (match) {
      return match[1].toLowerCase() as EscalationFixDecision;
    }
    return "unfixable";
  }

  private parseSummary(): string {
    const match = this.allOutput.match(/ESCALATION_FIX_SUMMARY:\s*(.+)/i);
    if (match) {
      return match[1].trim();
    }
    return "No summary provided";
  }

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
