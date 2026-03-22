/**
 * Inline Spec Verification Agent for Epic Mode
 *
 * Runs after incremental integration, before Tech Lead review.
 * A fresh agent verifies that the implementation satisfies
 * acceptance criteria from the original plan — independently
 * from the workers who wrote the code.
 */

import type { AxiosInstance } from "axios";
import { createLogsApi } from "../lib/api-client.js";
import { runAgent, type AgentOptions, type AgentResult } from "./agent-sdk.js";
import type { EpicConfig, StreamMessage } from "./types.js";
import { createAIClient, type AIClient, type AIClientOptions, type AIProvider } from "./ai-client-types.js";
import { loadRepoContext } from "./gate-utils.js";

export type VerificationDecision = "pass" | "partial_pass" | "fail";

export interface VerificationResult {
  success: boolean;
  decision: VerificationDecision;
  summary: string;
  failedCriteria?: Array<{
    storyIndex: number;
    criterion: string;
    reason: string;
  }>;
  error?: string;
}

const VERIFIER_SYSTEM_PROMPT = `You are an independent QA Verification Agent. You did NOT write the code you are reviewing.

Your job: verify that the implementation satisfies every acceptance criterion from the original specification.

## Rules

- You are testing SPEC COMPLIANCE, not code quality. The code may be ugly but correct — that's a pass.
- For each acceptance criterion, determine: does the code actually do what the criterion says?
- For API criteria: read the route handlers and verify the exact request/response shapes match.
- For database criteria: read the models/migrations and verify exact field names and types.
- For frontend criteria: read the components and verify exact UI elements and behavior.
- For test criteria: check if the specified tests exist and cover the stated scenarios.
- If you can verify a criterion by reading code alone, do that. Only run tests if reading isn't sufficient.

## Output Format

After checking all criteria, output:

\`\`\`
VERIFICATION_DECISION: pass | partial_pass | fail
\`\`\`

Then for each criterion that FAILED:

\`\`\`
FAILED_CRITERION: [story_index] | [criterion text] | [reason for failure]
\`\`\`

Then:

\`\`\`
VERIFICATION_SUMMARY: [overall summary of findings]
\`\`\`

## Communication Style

Write in a professional, direct tone. Do NOT open messages with filler words or pleasantries. Start with the substance.`;

export class InlineVerifier {
  private config: EpicConfig;
  private repoPath: string;
  private logsApi: AxiosInstance;
  private allOutput: string = "";
  private aiClient: AIClient | null = null;
  private model: string;

  constructor(config: EpicConfig, repoPath: string) {
    this.config = config;
    this.repoPath = repoPath;
    this.model = process.env.MANAGER_MODEL || config.model || "";

    this.logsApi = createLogsApi(config);

    if (config.useUnifiedClient) {
      const provider = (config.workerProvider || "anthropic") as AIProvider;
      const isAnthropic = provider === "anthropic";
      this.aiClient = createAIClient({
        provider,
        apiKeys: {
          anthropic: isAnthropic ? config.anthropicApiKey : undefined,
          ollamaHost: provider === "ollama" ? (process.env.OLLAMA_HOST || "http://localhost:11434") : undefined,
        },
        apiConfig: { baseUrl: config.apiBaseUrl, orgApiKey: config.orgApiKey },
        useAgentSdk: isAnthropic,
        githubToken: config.githubToken,
        oauthToken: isAnthropic && !config.anthropicApiKey ? "mounted" : undefined,
      });
    }
  }

  private async executeAgent(
    options: AgentOptions,
    storyId: string,
    onMessage?: (msg: StreamMessage) => void
  ): Promise<AgentResult> {
    if (this.config.useUnifiedClient && this.aiClient && options.expertConfig) {
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
    type: "system" | "manager" | "tool" | "output" | "error" = "output"
  ): Promise<void> {
    const prefix = "[🔍verifier🤖]";
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

  /**
   * Verify spec compliance against acceptance criteria.
   */
  async verify(
    storyAcceptanceCriteria: Array<{
      storyIndex: number;
      title: string;
      criteria: string[];
    }>
  ): Promise<VerificationResult> {
    this.allOutput = "";

    if (storyAcceptanceCriteria.length === 0 || storyAcceptanceCriteria.every(s => s.criteria.length === 0)) {
      return { success: true, decision: "pass", summary: "No acceptance criteria to verify" };
    }

    await this.postLog("Starting spec verification", "system");

    try {
      const prompt = this.buildVerificationPrompt(storyAcceptanceCriteria);

      const verifierConfig = {
        persona: "qa_engineer" as const,
        description: "QA specialist - spec compliance verification",
        systemPrompt: VERIFIER_SYSTEM_PROMPT,
        tools: ["Read", "Glob", "Grep", "Bash"],
        model: this.model,
        specialties: ["testing", "verification", "quality"],
        maxTurns: this.config.maxAgentTurns,
      };

      const result = await this.executeAgent(
        {
          prompt,
          expertConfig: verifierConfig,
          repoPath: this.repoPath,
          storyId: "spec-verification",
        },
        "spec-verification",
        (msg) => this.handleMessage(msg)
      );

      if (!result.success) {
        await this.postLog(`Verification agent failed: ${result.error}`, "error");
        return {
          success: false,
          decision: "fail",
          summary: `Verification agent error: ${result.error}`,
          error: result.error,
        };
      }

      const decision = this.parseDecision();
      const summary = this.parseSummary();
      const failedCriteria = this.parseFailedCriteria();

      await this.postLog(`Decision: ${decision}`, "system");
      await this.postLog(`Summary: ${summary}`, "system");
      if (failedCriteria.length > 0) {
        await this.postLog(`Failed criteria: ${failedCriteria.length}`, "system");
      }

      return {
        success: decision === "pass",
        decision,
        summary,
        failedCriteria: failedCriteria.length > 0 ? failedCriteria : undefined,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.postLog(`Verification failed: ${errorMessage}`, "error");
      return {
        success: false,
        decision: "fail",
        summary: `Verification error: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  private buildVerificationPrompt(
    storyAcceptanceCriteria: Array<{
      storyIndex: number;
      title: string;
      criteria: string[];
    }>
  ): string {
    const repoContext = loadRepoContext(this.repoPath);
    const repoContextSection = repoContext
      ? `\n### Repository Context (from AGENTS.md / CLAUDE.md)\n\n${repoContext}\n`
      : "";

    const criteriaSection = storyAcceptanceCriteria
      .map(s => {
        const criteriaList = s.criteria.map((c, i) => `${i + 1}. ${c}`).join("\n");
        return `**Story ${s.storyIndex}: ${s.title}**\n${criteriaList}`;
      })
      .join("\n\n");

    return `## Spec Verification

**Repository:** ${this.config.targetRepo}
${repoContextSection}
### Acceptance Criteria to Verify

${criteriaSection}

### Instructions

1. Read the codebase to understand what was built
2. For each criterion above, verify it is satisfied by the implementation
3. Report your findings using the output format in your system prompt
4. Be specific about WHY a criterion fails — identify the exact file and line`;
  }

  private parseDecision(): VerificationDecision {
    const match = this.allOutput.match(/VERIFICATION_DECISION:\s*(pass|partial_pass|fail)/i);
    return (match?.[1]?.toLowerCase() as VerificationDecision) || "fail";
  }

  private parseSummary(): string {
    const match = this.allOutput.match(/VERIFICATION_SUMMARY:\s*(.+)/i);
    return match?.[1]?.trim() || "No summary provided";
  }

  private parseFailedCriteria(): Array<{ storyIndex: number; criterion: string; reason: string }> {
    const results: Array<{ storyIndex: number; criterion: string; reason: string }> = [];
    const pattern = /FAILED_CRITERION:\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+)/gi;
    let match;
    while ((match = pattern.exec(this.allOutput)) !== null) {
      results.push({
        storyIndex: parseInt(match[1]),
        criterion: match[2].trim(),
        reason: match[3].trim(),
      });
    }
    return results;
  }

  private handleMessage(msg: StreamMessage): void {
    if (msg.type === "thinking" && msg.content) {
      this.postLog(`[THINKING] ${msg.content}`, "output");
    } else if (msg.type === "text" && msg.content) {
      this.allOutput += msg.content + "\n";
      if (msg.content.length > 20) {
        this.postLog(msg.content, "output");
      }
    } else if (msg.type === "result" && msg.content) {
      this.allOutput += msg.content + "\n";
      this.postLog(msg.content, "output");
    } else if (msg.type === "tool_use" && msg.toolName) {
      let toolMsg = `Tool: ${msg.toolName}`;
      if (msg.toolInput) {
        const input = msg.toolInput;
        if (input.command) toolMsg += ` -> ${String(input.command).substring(0, 500)}`;
        else if (input.file_path) toolMsg += ` -> ${input.file_path}`;
      }
      this.postLog(toolMsg, "tool");
    }
  }
}
