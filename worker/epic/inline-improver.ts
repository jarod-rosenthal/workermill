/**
 * Inline Improver for Epic Mode
 *
 * Analyzes completed tasks and auto-applies improvements to the WorkerMill codebase.
 * Can modify: Dockerfile, directives, code patterns.
 *
 * This runs inline after all Epic stories complete (same container).
 * Assumes an IAM role for elevated permissions before performing operations.
 */

import type { AxiosInstance } from "axios";
import { createLogsApi } from "../lib/api-client.js";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { runAgent, type AgentOptions, type AgentResult } from "./agent-sdk.js";
import { getTicketLabel, type EpicConfig, type StreamMessage } from "./types.js";
import { createAIClient, type AIClient, type AIClientOptions, type AIProvider } from "./ai-client-types.js";

// IAM role for WorkerMill self-improvement operations
const IMPROVER_ROLE_ARN = process.env.WORKERMILL_IMPROVER_ROLE_ARN || "";

/**
 * Result of an improvement analysis.
 */
export interface ImprovementResult {
  success: boolean;
  improvementsApplied: number;
  summary: string;
  changedFiles: string[];
  error?: string;
}

/**
 * System prompt for the Improvement Advisor agent.
 */
const IMPROVER_SYSTEM_PROMPT = `You are the WorkerMill Improvement Advisor, responsible for analyzing completed AI worker tasks and improving the WorkerMill system itself.

## Your Role

After each task completes, you analyze the execution logs to identify issues and **auto-apply fixes** to the WorkerMill codebase.

## What You Can Modify

1. **worker/Dockerfile** - Add missing tools, dependencies, system packages
   - If logs show "command not found: foo", add the tool installation
   - If logs show "pip: command not found", add python3-pip

2. **worker/directives/** - Improve instruction files that guide worker behavior
   - If workers repeatedly make the same mistake, clarify the directive
   - If a pattern keeps failing, document the workaround

3. **worker/epic/** - Add code pattern checks or guardrails (rare)
   - Only modify if there's a systematic bug in the execution flow

## Analysis Process

1. Read the task logs carefully looking for:
   - "command not found" errors - indicates missing CLI tools
   - "No such file or directory" - may indicate missing dependencies
   - "permission denied" - document in directive if can't be fixed
   - Repeated retry patterns - directive may need clarification
   - "ModuleNotFoundError" or "ImportError" - missing Python packages
   - "Error: Cannot find module" - missing Node.js packages

2. For each issue found, determine if it's:
   - **Fixable in Dockerfile**: Missing system packages or tools
   - **Fixable in Directives**: Worker needs better instructions
   - **Not fixable here**: One-off issue or external dependency

3. Only make changes if you're confident they'll help future runs.

## Important Guidelines

- **Be conservative**: Only add what's clearly needed
- **Don't break things**: Test changes mentally before applying
- **One improvement per issue**: Make targeted, minimal changes
- **Document why**: Commit messages should explain the improvement

## WorkerMill Repository Structure

After cloning, key paths are:
- /tmp/workermill/worker/Dockerfile - Container image definition
- /tmp/workermill/worker/directives/ - Persona-specific instructions
- /tmp/workermill/worker/epic/ - Epic execution code

## Git Workflow

When pushing changes:
1. Make sure you're on main branch
2. Use descriptive commit messages: "improve(dockerfile): add jq for JSON parsing"
3. Push directly to main (no PR needed for improvements)

## Output Format

After completing analysis, output these markers:

\`\`\`
IMPROVEMENTS_APPLIED: <number>
SUMMARY: <brief description of what you improved and why>
CHANGED_FILES: <comma-separated list of modified files, or "none">
\`\`\`

If no improvements are needed:
\`\`\`
IMPROVEMENTS_APPLIED: 0
SUMMARY: No actionable improvements found in the logs
CHANGED_FILES: none
\`\`\`

## Remember

- You're improving WorkerMill itself, not the target repository
- Changes you make will affect ALL future worker runs
- Be thoughtful and conservative
`;

/**
 * Inline Improver that analyzes completed tasks and improves WorkerMill.
 */
export class InlineImprover {
  private config: EpicConfig;
  private logsApi: AxiosInstance;
  private allOutput: string = "";
  private aiClient: AIClient | null = null;

  private improverPrompt: string;

  constructor(config: EpicConfig, serverImproverPrompt?: string) {
    this.config = config;
    this.improverPrompt = serverImproverPrompt ?? IMPROVER_SYSTEM_PROMPT;

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
    const prefix = "[🤖improver🤖]";
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
   * Assume IAM role for elevated WorkerMill improvement permissions.
   * Sets temporary credentials in environment for subsequent AWS operations.
   */
  private async assumeImproverRole(): Promise<boolean> {
    try {
      const sts = new STSClient({ region: process.env.AWS_REGION || "us-east-1" });

      const command = new AssumeRoleCommand({
        RoleArn: IMPROVER_ROLE_ARN,
        RoleSessionName: `improver-${this.config.parentTaskId}`,
        DurationSeconds: 3600, // 1 hour
      });

      const response = await sts.send(command);

      if (response.Credentials) {
        // Set temporary credentials in environment for the agent to use
        process.env.AWS_ACCESS_KEY_ID = response.Credentials.AccessKeyId;
        process.env.AWS_SECRET_ACCESS_KEY = response.Credentials.SecretAccessKey;
        process.env.AWS_SESSION_TOKEN = response.Credentials.SessionToken;

        await this.postLog(`Assumed improver role: ${IMPROVER_ROLE_ARN}`, "system");
        return true;
      }

      await this.postLog("Failed to get credentials from role assumption", "error");
      return false;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.postLog(`Failed to assume improver role: ${errorMessage}`, "error");
      // Continue without elevated permissions - may still work for read-only analysis
      return false;
    }
  }

  /**
   * Run improvement analysis and apply fixes to WorkerMill.
   */
  async improve(): Promise<ImprovementResult> {
    this.allOutput = ""; // Reset output accumulator

    await this.postLog("Starting inline improvement analysis", "system");
    await this.postLog(`Task ID: ${this.config.parentTaskId}`, "system");
    await this.postLog(`${getTicketLabel(this.config.ticketSystem)}: ${this.config.jiraIssueKey}`, "system");

    try {
      // Assume IAM role for elevated permissions
      const hasElevatedPerms = await this.assumeImproverRole();
      if (!hasElevatedPerms) {
        await this.postLog("Continuing with base permissions (may be limited)", "system");
      }

      // Build the improvement prompt
      const prompt = this.buildImprovementPrompt();

      // Use manager model from environment (set by API from org settings) or config
      const model = process.env.MANAGER_MODEL || this.config.model || "";
      await this.postLog(`Using model: ${model}`, "system");

      // Set up GitHub token for pushing to WorkerMill repo
      // We use the same token that has access to both repos
      const originalGhToken = process.env.GH_TOKEN;
      // Use the existing GitHub token - it should have access to WorkerMill repo
      // If a separate token is needed in the future, it can be added to EpicConfig
      await this.postLog("Using GitHub token for WorkerMill repo access", "system");

      // Create improver expert config
      const improverConfig = {
        persona: "tech_lead" as const, // Reuse tech_lead persona type
        description: "WorkerMill improvement advisor - analyzes tasks and improves the platform",
        systemPrompt: this.improverPrompt,
        tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
        model,
        specialties: ["analysis", "improvement", "devops"],
      };

      // Run the agent
      const result = await this.executeAgent(
        {
          prompt,
          expertConfig: improverConfig,
          repoPath: "/tmp/workermill", // Will clone WorkerMill repo here
          storyId: `improve-${this.config.parentTaskId}`,
        },
        `improve-${this.config.parentTaskId}`,
        (msg) => this.handleMessage(msg)
      );

      // Restore original token
      if (originalGhToken !== undefined) {
        process.env.GH_TOKEN = originalGhToken;
      } else {
        delete process.env.GH_TOKEN;
      }

      if (!result.success) {
        await this.postLog(`Improvement analysis failed: ${result.error}`, "error");
        return {
          success: false,
          improvementsApplied: 0,
          summary: `Improvement analysis failed: ${result.error}`,
          changedFiles: [],
          error: result.error,
        };
      }

      // Parse results from output
      const improvementsApplied = this.parseImprovementsApplied();
      const summary = this.parseSummary();
      const changedFiles = this.parseChangedFiles();

      await this.postLog(`Analysis complete: ${improvementsApplied} improvements applied`, "system");
      if (summary) {
        await this.postLog(`Summary: ${summary}`, "system");
      }

      return {
        success: true,
        improvementsApplied,
        summary,
        changedFiles,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.postLog(`Improvement failed: ${errorMessage}`, "error");

      return {
        success: false,
        improvementsApplied: 0,
        summary: `Error: ${errorMessage}`,
        changedFiles: [],
        error: errorMessage,
      };
    }
  }

  /**
   * Build the improvement analysis prompt.
   */
  private buildImprovementPrompt(): string {
    return `# WorkerMill Improvement Analysis Task

## Context
- **Parent Task ID**: ${this.config.parentTaskId}
- **Jira Issue**: ${this.config.jiraIssueKey || "N/A"}
- **API Base**: ${this.config.apiBaseUrl}
- **Target Repo (for context)**: ${this.config.targetRepo}

## Instructions

### Step 1: Fetch Task Logs

First, fetch the task logs to analyze:

\`\`\`bash
curl -s -H "x-api-key: ${this.config.orgApiKey}" \\
  "${this.config.apiBaseUrl}/api/control-center/logs/${this.config.parentTaskId}/all" | head -500
\`\`\`

Read through the logs carefully looking for patterns that indicate systematic issues.

### Step 2: Analyze for Improvements

Look for these patterns in the logs:

1. **Missing tools**: "command not found", "not found in PATH"
2. **Missing packages**: "ModuleNotFoundError", "Cannot find module"
3. **Permission issues**: "permission denied", "EACCES"
4. **Repeated failures**: Same error appearing multiple times
5. **Worker confusion**: Agent struggling to understand instructions

### Step 3: Clone WorkerMill Repository (if improvements needed)

If you identify improvements to make:

\`\`\`bash
rm -rf /tmp/workermill
git clone https://github.com/workermill/workermill.git /tmp/workermill
cd /tmp/workermill
\`\`\`

### Step 4: Make Improvements

For Dockerfile changes (missing tools):
\`\`\`bash
# Edit worker/Dockerfile to add the missing tool
# Example: add "jq" for JSON parsing
\`\`\`

For directive changes (worker instructions):
\`\`\`bash
# Edit the relevant directive file in worker/directives/
\`\`\`

### Step 5: Commit and Push

\`\`\`bash
cd /tmp/workermill
git add -A
git commit -m "improve: <description of what was improved>"
git push origin main
\`\`\`

### Step 6: Output Results

After completing your analysis (whether or not you made changes), output:

\`\`\`
IMPROVEMENTS_APPLIED: <number>
SUMMARY: <description>
CHANGED_FILES: <comma-separated list or "none">
\`\`\`

## Important Notes

- Only make changes that will clearly help future runs
- Be conservative - don't add speculative improvements
- If unsure, output IMPROVEMENTS_APPLIED: 0 and explain in SUMMARY
- This runs after EVERY Epic task, so be efficient

Begin your analysis now.`;
  }

  /**
   * Handle messages from agent execution.
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
      // Accumulate all text output for result parsing
      this.allOutput += msg.content + "\n";

      // Log meaningful output
      if (msg.content.length > 20) {
        this.postLog(msg.content, "output");
      }
    } else if (msg.type === "result" && msg.content) {
      this.allOutput += msg.content + "\n";
      this.postLog(`Result: ${msg.content.substring(0, 500)}...`, "output");
    }
  }

  /**
   * Parse improvements count from agent output.
   */
  private parseImprovementsApplied(): number {
    const match = this.allOutput.match(/IMPROVEMENTS_APPLIED:\s*(\d+)/i);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Parse summary from agent output.
   */
  private parseSummary(): string {
    // Look for SUMMARY: marker (capture to end of line or next marker)
    const match = this.allOutput.match(
      /SUMMARY:\s*(.+?)(?=\n(?:IMPROVEMENTS_APPLIED|CHANGED_FILES)|$)/is
    );
    if (match) {
      return match[1].trim();
    }
    return "No summary provided";
  }

  /**
   * Parse changed files from agent output.
   */
  private parseChangedFiles(): string[] {
    const match = this.allOutput.match(/CHANGED_FILES:\s*(.+)/i);
    if (match && match[1].toLowerCase().trim() !== "none") {
      return match[1]
        .split(",")
        .map((f) => f.trim())
        .filter((f) => f && f.toLowerCase() !== "none");
    }
    return [];
  }
}
