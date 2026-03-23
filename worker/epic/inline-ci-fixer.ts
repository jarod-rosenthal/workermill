/**
 * Inline CI Fix Agent for Epic Mode
 *
 * Runs CI failure diagnosis and surgical fixes inline after PR CI check fails.
 * Follows the InlineDeployer/InlineReviewer pattern.
 */

import type { AxiosInstance } from "axios";
import { createLogsApi } from "../lib/api-client.js";
import { runAgent, type AgentOptions, type AgentResult } from "./agent-sdk.js";
import type { EpicConfig, StreamMessage } from "./types.js";
import { createAIClient, type AIClient, type AIClientOptions, type AIProvider } from "./ai-client-types.js";
import { isDockerDaemonReachable, loadRepoContext } from "./gate-utils.js";

/**
 * CI fix decision from the agent.
 */
export type CIFixDecision = "fixed" | "unfixable";

/**
 * Result of an inline CI fix attempt.
 */
export interface CIFixResult {
  success: boolean;
  decision: CIFixDecision;
  summary: string;
  error?: string;
}

/**
 * System prompt for the CI Fix Agent.
 */
const CI_FIX_SYSTEM_PROMPT = `You are a CI Fix Agent. A CI pipeline has failed on a pull request.
Your job is to make the MINIMUM surgical fix to make CI pass.

You have the CI failure output below. Diagnose the exact issue and fix it.

## Rules

- Only fix what CI is complaining about. Do NOT refactor or improve other code.
- Common fixes: remove unused imports/variables, fix type errors, fix lint errors, fix build errors.
- {{DOCKER_INSTRUCTIONS}}
- **NEVER change language versions** (Go version in go.mod/Dockerfile, Node.js version, Python version, etc.). Version pins are intentional architectural decisions from the project specification. If CI fails because of a version-related issue, fix the CI configuration or dependencies to work WITH the specified version — do NOT downgrade the language version.
- **NEVER change framework or dependency major versions** unless the CI error explicitly shows an incompatibility that cannot be resolved any other way. Prefer fixing import paths, updating minor/patch versions, or adjusting configuration over version downgrades.

## CRITICAL — Validate Before Pushing

After making your fix, you MUST run ALL quality gate commands locally before committing. Do NOT commit and push a fix without verifying it passes. Each failed push wastes a CI round-trip (3-5 minutes) and counts against the retry limit.

{{QUALITY_GATE_COMMANDS}}

**Validation workflow:**
1. Make your code fix
2. Run every quality gate command listed above
3. If ANY command fails, fix the issue and re-run ALL commands — do NOT push partial fixes
4. Only after ALL commands pass: commit and push

If you cannot get all checks to pass after reasonable effort, output CI_FIX_DECISION: unfixable rather than pushing broken code.

## Commit and Push

- Commit with message "fix: resolve CI failure — <brief description>"
- Push to the PR branch.

## Organization Guidelines

If the following org-level guidelines were provided, follow them:

{{ORG_GUIDELINES}}

## Output Format

After fixing (or determining it's unfixable), you MUST output these markers:

\`\`\`
CI_FIX_DECISION: fixed
\`\`\`
OR
\`\`\`
CI_FIX_DECISION: unfixable
\`\`\`

Then add:
\`\`\`
CI_FIX_SUMMARY: <what you fixed or why it's unfixable>
\`\`\`

## Communication Style

Write in a professional, direct tone. Do NOT open messages with filler words or pleasantries like "Perfect!", "Great!", "Awesome!", "Sure!", "Absolutely!", or similar. Start with the substance — what you found, your assessment, or what needs to change. Be concise and informative.
`;

/**
 * Inline CI Fix Agent for Epic mode.
 */
export class InlineCIFixer {
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

    // Create axios instance for posting logs
    this.logsApi = createLogsApi(config);

    // Initialize AIClient if unified client is enabled
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

  /**
   * Execute an agent using either the unified AIClient or legacy runAgent.
   */
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
        rateLimited: result.rateLimited,
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
    const prefix = "[🔬qa_engineer🤖]";
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
   * Attempt to fix CI failures on a PR.
   */
  async fix(prNumber: number, ciFailureLog: string): Promise<CIFixResult> {
    this.allOutput = ""; // Reset output accumulator

    await this.postLog("Starting CI Fix Agent", "system");
    await this.postLog(`PR #${prNumber}`, "system");

    try {
      const prompt = this.buildPrompt(prNumber, ciFailureLog);

      // Build quality gate commands section for local validation
      let qualityGateSection = "";
      if (this.config.qualityGateCommands && this.config.qualityGateCommands.length > 0) {
        const gateList = this.config.qualityGateCommands
          .map((g) => g.commands.map((c) => `\`\`\`bash\n${c}\n\`\`\``).join("\n"))
          .join("\n\n");
        qualityGateSection = `\n**Quality gate commands for this project (run ALL of these before pushing):**\n\n${gateList}\n\nRun each command. If any fails, fix the issue and re-run ALL commands until they all pass. Only then commit and push.`;
      }

      const systemPrompt = CI_FIX_SYSTEM_PROMPT
        .replace(
          "{{DOCKER_INSTRUCTIONS}}",
          isDockerDaemonReachable()
            ? "You have `docker` and `docker compose` available with a working daemon. If CI tests need service dependencies (MongoDB, Redis, Postgres, etc.), you MUST spin them up as sibling containers to reproduce and fix failures (e.g. `docker run -d --rm -p 27017:27017 --name mongo-test mongo:7`). Connect to services at `localhost` on the mapped ports. Clean up when done."
            : "Docker is NOT available in this environment. If tests require service dependencies, use in-memory alternatives or test doubles."
        )
        .replace(
          "{{QUALITY_GATE_COMMANDS}}",
          qualityGateSection
        )
        .replace(
          "{{ORG_GUIDELINES}}",
          this.config.orgGuidelines
            ? this.config.orgGuidelines
            : "(none set — skip this section)"
        );

      const ciFixConfig = {
        persona: "qa_engineer" as const,
        description: "QA specialist - CI failure diagnosis and fix",
        systemPrompt,
        tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
        model: this.model,
        specialties: ["testing", "ci", "quality"],
        maxTurns: this.config.maxAgentTurns,
      };

      const result = await this.executeAgent(
        {
          prompt,
          expertConfig: ciFixConfig,
          repoPath: this.repoPath,
          storyId: `ci-fix-${prNumber}`,
        },
        `ci-fix-${prNumber}`,
        (msg) => this.handleMessage(msg)
      );

      if (!result.success) {
        await this.postLog(`CI Fix Agent failed: ${result.error}`, "error");
        return {
          success: false,
          decision: "unfixable",
          summary: `Agent execution failed: ${result.error}`,
          error: result.error,
        };
      }

      const decision = this.parseDecision();
      const summary = this.parseSummary();

      await this.postLog(`Decision: ${decision}`, "system");
      await this.postLog(`Summary: ${summary}`, "system");

      return {
        success: decision === "fixed",
        decision,
        summary,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.postLog(`CI Fix failed: ${errorMessage}`, "error");

      return {
        success: false,
        decision: "unfixable",
        summary: `CI fix error: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  /**
   * Build the user prompt with CI failure context.
   */
  private buildPrompt(prNumber: number, ciFailureLog: string): string {
    // Truncate CI log to 8KB to stay within context limits
    const maxLogLength = 8 * 1024;
    const truncatedLog = ciFailureLog.length > maxLogLength
      ? ciFailureLog.substring(ciFailureLog.length - maxLogLength)
      : ciFailureLog;

    const repoContext = loadRepoContext(this.repoPath);
    const repoContextSection = repoContext
      ? `\n### Repository Context (from AGENTS.md / CLAUDE.md)\n\n${repoContext}\n`
      : "";

    const requirementsSection = this.config.jiraRequirements
      ? `\n### Project Requirements (PRD)\n\n${this.config.jiraRequirements}\n`
      : "";

    return `## CI Failure on PR #${prNumber}

**Repository:** ${this.config.targetRepo}
${repoContextSection}${requirementsSection}
### CI Failure Output

\`\`\`
${truncatedLog}
\`\`\`

Diagnose the failure and make the minimum surgical fix to make CI pass. Then commit and push to the PR branch.`;
  }

  /**
   * Parse CI_FIX_DECISION from agent output.
   */
  private parseDecision(): CIFixDecision {
    const match = this.allOutput.match(/CI_FIX_DECISION:\s*(fixed|unfixable)/i);
    if (match) {
      return match[1].toLowerCase() as CIFixDecision;
    }
    // Default to unfixable if no marker found
    return "unfixable";
  }

  /**
   * Parse CI_FIX_SUMMARY from agent output.
   */
  private parseSummary(): string {
    const match = this.allOutput.match(/CI_FIX_SUMMARY:\s*(.+)/i);
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
        if (input.command) toolMsg += ` -> ${String(input.command).substring(0, 500)}`;
        else if (input.file_path) toolMsg += ` -> ${input.file_path}`;
      }
      this.postLog(toolMsg, "tool");
    } else if (msg.type === "text" && msg.content) {
      // Accumulate all text output for decision parsing
      this.allOutput += msg.content + "\n";

      // Log meaningful output
      if (msg.content.length > 20) {
        this.postLog(msg.content, "output");
      }
    } else if (msg.type === "result" && msg.content) {
      this.allOutput += msg.content + "\n";
      this.postLog(msg.content, "output");
    }
  }
}
