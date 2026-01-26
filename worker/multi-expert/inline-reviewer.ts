/**
 * Inline Tech Lead Reviewer for Multi-Expert Mode (AI SDK)
 *
 * Runs PR code review after all stories complete, supporting multi-provider routing.
 * Uses the AI SDK executor to run reviews with any configured provider.
 */

import { spawn } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import axios, { AxiosInstance } from "axios";

/**
 * Review decision from Tech Lead.
 */
export type ReviewDecision = "approved" | "revision_needed" | "rejected";

/**
 * Result of an inline review.
 */
export interface InlineReviewResult {
  success: boolean;
  decision: ReviewDecision;
  feedback: string;
  codeQualityScore: number;
  error?: string;
}

/**
 * Configuration for the inline reviewer.
 */
export interface InlineReviewerConfig {
  parentTaskId: string;
  apiBaseUrl: string;
  orgApiKey: string;
  githubToken: string;
  githubReviewerToken?: string;
  jiraIssueKey?: string;
  // Provider routing for tech_lead
  provider: string;
  model: string;
  // API keys for different providers
  anthropicApiKey?: string;
  googleApiKey?: string;
  openaiApiKey?: string;
  ollamaHost?: string;
}

/**
 * System prompt for the Tech Lead reviewer.
 */
const TECH_LEAD_SYSTEM_PROMPT = `You are a Tech Lead for WorkerMill, responsible for reviewing code changes made by AI Workers.

Your role combines technical expertise with leadership responsibilities:
- **Code Review**: Evaluate code quality, patterns, and implementation correctness
- **Architecture Guidance**: Ensure changes align with system design and patterns
- **Mentoring**: Provide constructive, actionable feedback that helps workers improve
- **Quality Gate**: Make approve/revise/reject decisions based on technical merit

## Your Capabilities

You have access to these tools:
- **bash**: Run shell commands including \`gh\` CLI for GitHub operations
- **read**: Read files from the repository
- **glob**: Find files by pattern
- **grep**: Search file contents

## Code Review Standards

### APPROVE when:
- Code correctly implements the Jira requirements
- No obvious bugs or security issues
- Code follows existing patterns in the codebase
- Appropriate error handling is in place
- Changes are maintainable and readable

### REVISION_NEEDED when:
- Code has fixable issues (style, missing tests, minor bugs)
- Security concerns that can be addressed with changes
- Missing error handling or edge cases
- Could benefit from refactoring for clarity

### REJECT when:
- Fundamental approach is wrong and cannot be fixed with revisions
- Security vulnerability that requires different architecture
- Task cannot be completed this way

## Feedback Guidelines

- **Be specific**: Point to exact lines/files when providing feedback
- **Be constructive**: Suggest alternatives, not just problems
- **Be balanced**: Acknowledge what's done well alongside improvements
- **Be pragmatic**: Distinguish must-fix from nice-to-have issues

## Output Format

After completing your review, you MUST output these markers:

\`\`\`
REVIEW_DECISION: approved
\`\`\`
OR
\`\`\`
REVIEW_DECISION: revision_needed
\`\`\`
OR
\`\`\`
REVIEW_DECISION: rejected
\`\`\`

Then add:
\`\`\`
CODE_QUALITY_SCORE: 8
FEEDBACK: Your detailed feedback explaining your decision
\`\`\`

## Important Notes

- Always fetch the PR diff first using \`gh pr diff\`
- Submit your review to GitHub using \`gh pr review\`
- Be constructive in feedback - help the worker improve
- Consider the full context of the Jira requirements
- Balance perfectionism with pragmatism - ship good code, not perfect code
`;

/**
 * Inline Tech Lead reviewer for Multi-Expert mode using AI SDK.
 */
export class InlineReviewerAiSdk {
  private config: InlineReviewerConfig;
  private repoPath: string;
  private logsApi: AxiosInstance;
  private allOutput: string = "";

  constructor(config: InlineReviewerConfig, repoPath: string) {
    this.config = config;
    this.repoPath = repoPath;

    // Create axios instance for posting logs
    this.logsApi = axios.create({
      baseURL: config.apiBaseUrl,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.orgApiKey,
      },
      timeout: 5000,
    });
  }

  /**
   * Post a log message to the WorkerMill dashboard.
   */
  private async postLog(
    message: string,
    type: "system" | "manager" | "tool" | "output" | "error" = "output"
  ): Promise<void> {
    console.log(`[tech_lead] ${message}`);

    try {
      await this.logsApi.post("/api/control-center/logs", {
        taskId: this.config.parentTaskId,
        type,
        message: `[tech_lead] ${message}`,
        severity: type === "error" ? "error" : "info",
      });
    } catch {
      // Fire and forget - don't block on log failures
    }
  }

  /**
   * Execute inline PR review using AI SDK executor.
   */
  async review(
    prUrl: string,
    prNumber: number,
    revisionCount: number = 0,
    previousFeedback?: string
  ): Promise<InlineReviewResult> {
    this.allOutput = ""; // Reset output accumulator

    await this.postLog("Starting inline Tech Lead review (AI SDK)", "system");
    await this.postLog(`PR: ${prUrl}`, "system");
    await this.postLog(`Jira: ${this.config.jiraIssueKey}`, "system");
    await this.postLog(`Provider: ${this.config.provider} | Model: ${this.config.model}`, "system");
    if (revisionCount > 0) {
      await this.postLog(`Revision attempt: ${revisionCount}/3`, "system");
    }

    try {
      // Build the review prompt
      const prompt = this.buildReviewPrompt(prUrl, prNumber, revisionCount, previousFeedback);

      // Write prompt to temp file
      const promptFile = `/tmp/review-prompt-${Date.now()}.txt`;
      writeFileSync(promptFile, prompt);

      // Check for reviewer token
      if (this.config.githubReviewerToken) {
        await this.postLog("Using separate reviewer token for PR approval", "system");
      } else {
        await this.postLog("WARNING: No GITHUB_REVIEWER_TOKEN set - PR approval may fail due to self-approval restriction", "system");
      }

      // Run the AI SDK executor
      const result = await this.runExecutor(promptFile);

      // Cleanup
      try {
        unlinkSync(promptFile);
      } catch {
        // Ignore cleanup errors
      }

      if (!result.success) {
        await this.postLog(`Review agent failed: ${result.error}`, "error");
        return {
          success: false,
          decision: "rejected",
          feedback: `Review failed: ${result.error}`,
          codeQualityScore: 0,
          error: result.error,
        };
      }

      // Parse decision from output
      const decision = this.parseDecision();
      const feedback = this.parseFeedback();
      const codeQualityScore = this.parseCodeQualityScore();

      await this.postLog(`Decision: ${decision}`, "system");
      await this.postLog(`Code Quality Score: ${codeQualityScore}`, "system");
      if (feedback) {
        await this.postLog(`Feedback: ${feedback.substring(0, 300)}...`, "system");
      }

      return {
        success: true,
        decision,
        feedback,
        codeQualityScore,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.postLog(`Review failed: ${errorMessage}`, "error");

      return {
        success: false,
        decision: "rejected",
        feedback: `Review error: ${errorMessage}`,
        codeQualityScore: 0,
        error: errorMessage,
      };
    }
  }

  /**
   * Run the AI SDK executor for review.
   */
  private runExecutor(promptFile: string): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      // Build environment with API keys
      const env: Record<string, string> = {
        ...process.env as Record<string, string>,
        AGENT_WORKING_DIR: this.repoPath,
        AGENT_MAX_STEPS: "50", // Reviews need fewer steps
        AGENT_VERBOSE: "false",
        AGENT_SYSTEM_PROMPT: TECH_LEAD_SYSTEM_PROMPT,
      };

      // CRITICAL: Use reviewer token for PR approvals (avoids self-approval restriction)
      if (this.config.githubReviewerToken) {
        env.GH_TOKEN = this.config.githubReviewerToken;
        env.GITHUB_TOKEN = this.config.githubReviewerToken;
      }

      // Set provider-specific API key
      const { provider, model } = this.config;
      if (provider === "anthropic") {
        env.ANTHROPIC_API_KEY = this.config.anthropicApiKey || "";
      } else if (provider === "google" || provider === "gemini") {
        env.GOOGLE_GENERATIVE_AI_API_KEY = this.config.googleApiKey || "";
        env.GOOGLE_API_KEY = this.config.googleApiKey || "";
      } else if (provider === "openai") {
        env.OPENAI_API_KEY = this.config.openaiApiKey || "";
      } else if (provider === "ollama") {
        env.OLLAMA_HOST = this.config.ollamaHost || "http://localhost:11434";
      }

      const args = [
        "/app/agents/ai-sdk-executor.js",
        "--provider", provider,
        "--model", model,
        "--persona", "tech_lead",
        "--prompt-file", promptFile,
      ];

      const child = spawn("node", args, {
        cwd: "/app",
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      child.stdout.on("data", (data) => {
        const text = data.toString();
        for (const line of text.split("\n")) {
          if (line.trim()) {
            console.log(line);
            this.allOutput += line + "\n";
            // Forward to dashboard
            this.logsApi.post("/api/control-center/logs", {
              taskId: this.config.parentTaskId,
              type: "manager",
              message: line,
              severity: "info",
            }).catch(() => {});
          }
        }
      });

      child.stderr.on("data", (data) => {
        const stderrText = data.toString().trim();
        if (stderrText && (stderrText.includes("Error") || stderrText.includes("error:"))) {
          console.error(`[tech_lead] ${stderrText}`);
          this.postLog(stderrText, "error").catch(() => {});
        }
      });

      child.on("close", (code) => {
        const success = code === 0;
        const error = success ? undefined : `AI SDK executor exited with code ${code}`;
        resolve({ success, error });
      });

      child.on("error", (err) => {
        resolve({ success: false, error: `Failed to spawn AI SDK executor: ${err.message}` });
      });
    });
  }

  /**
   * Build the review prompt with PR context.
   */
  private buildReviewPrompt(
    prUrl: string,
    prNumber: number,
    revisionCount: number,
    previousFeedback?: string
  ): string {
    const revisionSection = previousFeedback
      ? `## Previous Review Feedback (Revision ${revisionCount}/3)
This is a revision attempt. The previous code was reviewed and these issues were identified:

${previousFeedback}

**Check if these issues have been addressed in the latest changes.**

---

`
      : "";

    return `# PR Code Review Task

${revisionSection}## Task Details
- **Jira Issue**: ${this.config.jiraIssueKey}
- **PR URL**: ${prUrl}
- **PR Number**: ${prNumber}

## Instructions

1. **Fetch the PR diff**:
   \`\`\`bash
   gh pr diff ${prNumber}
   \`\`\`

2. **Review the code** against these criteria:
   - Does it correctly implement the Jira requirements?
   - Is the code quality acceptable?
   - Are there security vulnerabilities?
   - Are there test coverage gaps?
   - Does it follow project coding standards?
   ${previousFeedback ? "- **Have the previous review issues been addressed?**" : ""}

3. **Make your decision**: APPROVE, REVISION_NEEDED, or REJECT

4. **Submit your review to GitHub** (REQUIRED):

   **If APPROVE:**
   \`\`\`bash
   gh pr review ${prNumber} --approve --body "Your approval message"
   \`\`\`

   **If REVISION_NEEDED or REJECT:**
   \`\`\`bash
   gh pr review ${prNumber} --request-changes --body "Your detailed feedback"
   \`\`\`

5. **Output your decision** using these exact markers:
   \`\`\`
   REVIEW_DECISION: approved
   CODE_QUALITY_SCORE: 8
   FEEDBACK: Your detailed feedback here
   \`\`\`

Begin your review now. Start by fetching the PR diff.`;
  }

  /**
   * Parse the review decision from agent output.
   */
  private parseDecision(): ReviewDecision {
    const decisionMatch = this.allOutput.match(/REVIEW_DECISION:\s*(approved|revision_needed|rejected)/i);
    if (decisionMatch) {
      return decisionMatch[1].toLowerCase() as ReviewDecision;
    }
    // Default to revision_needed if no explicit decision (safer than auto-approve)
    console.log("[tech_lead] No explicit decision found, defaulting to revision_needed");
    return "revision_needed";
  }

  /**
   * Parse feedback from agent output.
   */
  private parseFeedback(): string {
    const feedbackMatch = this.allOutput.match(/FEEDBACK:\s*(.+?)(?=\n(?:REVIEW_DECISION|CODE_QUALITY_SCORE)|$)/is);
    if (feedbackMatch) {
      return feedbackMatch[1].trim();
    }

    // Try to extract from gh pr review command
    const reviewBodyMatch = this.allOutput.match(/gh pr review.*--body\s*["']([^"']+)["']/);
    if (reviewBodyMatch) {
      return reviewBodyMatch[1].trim();
    }

    return "No feedback provided";
  }

  /**
   * Parse code quality score from agent output.
   */
  private parseCodeQualityScore(): number {
    const scoreMatch = this.allOutput.match(/CODE_QUALITY_SCORE:\s*(\d+)/i);
    if (scoreMatch) {
      const score = parseInt(scoreMatch[1], 10);
      return Math.min(10, Math.max(0, score)); // Clamp to 0-10
    }
    return 5; // Default middle score
  }
}
