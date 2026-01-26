/**
 * Virtual Manager PR Reviewer
 *
 * Handles PR code review using the Claude Agent SDK.
 * Runs the agent, extracts decisions, and reports to API.
 */

import axios from "axios";
import { runAgent } from "./agent-sdk.js";
import type {
  ManagerConfig,
  ManagerResult,
  ReviewDecision,
  StreamMessage,
} from "./types.js";

/**
 * System prompt for the Tech Lead (Virtual Manager).
 */
const MANAGER_SYSTEM_PROMPT = `You are a Tech Lead for WorkerMill, responsible for reviewing code changes made by AI Workers.

Your role combines technical expertise with leadership responsibilities:
- **Code Review**: Evaluate code quality, patterns, and implementation correctness
- **Architecture Guidance**: Ensure changes align with system design and patterns
- **Mentoring**: Provide constructive, actionable feedback that helps workers improve
- **Quality Gate**: Make approve/revise/reject decisions based on technical merit

## Your Capabilities

You have access to these tools:
- **Bash**: Run shell commands including \`gh\` CLI for GitHub operations
- **Read**: Read files from the repository
- **Glob**: Find files by pattern
- **Grep**: Search file contents

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
- (Max 3 revisions before marking as failed)

### REJECT when:
- Fundamental approach is wrong
- Cannot be fixed with revisions
- Security vulnerability that requires different architecture
- Task cannot be completed this way

## Architecture Review Checklist

When reviewing, consider:
- [ ] Follows existing patterns in the codebase
- [ ] SOLID principles applied appropriately
- [ ] No unnecessary complexity
- [ ] Appropriate separation of concerns
- [ ] Error handling is comprehensive
- [ ] Edge cases considered
- [ ] Performance implications evaluated

## Feedback Guidelines

- **Be specific**: Point to exact lines/files when providing feedback
- **Be constructive**: Suggest alternatives, not just problems
- **Be balanced**: Acknowledge what's done well alongside improvements
- **Be educational**: Explain the "why" behind your suggestions
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
 * PR Reviewer using Agent SDK.
 */
export class PRReviewer {
  private config: ManagerConfig;
  private repoPath: string;
  private logsApi: ReturnType<typeof axios.create>;
  private allOutput: string = "";

  constructor(config: ManagerConfig, repoPath: string) {
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
    console.log(`[Manager] ${message}`);

    try {
      await this.logsApi.post("/api/control-center/logs", {
        taskId: this.config.taskId,
        type,
        message: `[Manager] ${message}`,
        severity: type === "error" ? "error" : "info",
      });
    } catch {
      // Fire and forget - don't block on log failures
    }
  }

  /**
   * Execute PR review.
   */
  async review(): Promise<ManagerResult> {
    await this.postLog("Starting PR review", "system");
    await this.postLog(`PR: ${this.config.prUrl}`, "system");
    await this.postLog(`Jira: ${this.config.jiraIssueKey}`, "system");

    try {
      // Build the review prompt
      const prompt = this.buildReviewPrompt();

      // Determine model (default to opus for thorough review)
      const model = this.config.model || "opus";
      await this.postLog(`Using model: ${model}`, "system");

      // Run the agent
      const result = await runAgent(this.config, {
        prompt,
        systemPrompt: MANAGER_SYSTEM_PROMPT,
        workingDir: this.repoPath,
        model,
        maxTurns: 30,
        onMessage: (msg) => this.handleMessage(msg),
      });

      if (!result.success) {
        await this.postLog(`Agent execution failed: ${result.error}`, "error");
        return {
          success: false,
          error: result.error || "Agent execution failed",
        };
      }

      // Parse decision from output
      const decision = this.parseDecision();
      const feedback = this.parseFeedback();
      const codeQualityScore = this.parseCodeQualityScore();

      await this.postLog(`Decision: ${decision}`, "system");
      await this.postLog(`Code Quality Score: ${codeQualityScore}`, "system");
      if (feedback) {
        await this.postLog(`Feedback: ${feedback.substring(0, 200)}...`, "system");
      }

      // Report completion to API
      await this.reportCompletion(decision, feedback, codeQualityScore);

      return {
        success: true,
        decision,
        feedback,
        codeQualityScore,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.postLog(`Review failed: ${errorMessage}`, "error");

      // Try to report failure
      try {
        await this.reportCompletion("rejected", `Review failed: ${errorMessage}`, 0);
      } catch {
        // Ignore API errors on failure path
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Build the review prompt with PR context.
   */
  private buildReviewPrompt(): string {
    const previousFeedback = this.config.reviewFeedback
      ? `## ⚠️ Previous Review Feedback (REVISION ATTEMPT)

This is a **revision attempt**. The worker was asked to address the following issues from the previous review:

${this.config.reviewFeedback}

**YOUR PRIMARY TASK: Verify that the above issues have been fixed.**

Check each point from the previous feedback and confirm whether it was addressed in this revision.

---

`
      : "";

    return `# PR Code Review Task

## Task Details
- **Task ID**: ${this.config.taskId}
- **Jira Issue**: ${this.config.jiraIssueKey}
- **PR URL**: ${this.config.prUrl}
- **PR Number**: ${this.config.prNumber}
- **Repository**: ${this.config.githubRepo}

## Jira Summary
${this.config.jiraSummary || "No summary provided"}

## Jira Description
${this.config.jiraDescription || "No description provided"}

${previousFeedback}## Instructions

1. **Fetch the PR diff**:
   \`\`\`bash
   gh pr diff ${this.config.prNumber}
   \`\`\`

2. **Review the code** against these criteria:
   - Does it correctly implement the Jira requirements?
   - Is the code quality acceptable?
   - Are there security vulnerabilities?
   - Are there test coverage gaps?
   - Does it follow project coding standards?
   ${this.config.reviewFeedback ? "- **Have the issues from the previous review been addressed?**" : ""}

3. **Make your decision**: APPROVE, REVISION_NEEDED, or REJECT

4. **Submit your review to GitHub** (REQUIRED):

   **If APPROVE:**
   \`\`\`bash
   gh pr review ${this.config.prNumber} --approve --body "Your approval message explaining why the code is good"
   \`\`\`

   **If REVISION_NEEDED or REJECT:**
   \`\`\`bash
   gh pr review ${this.config.prNumber} --request-changes --body "Your detailed feedback explaining what needs to be fixed"
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
   * Handle messages from agent execution.
   */
  private handleMessage(msg: StreamMessage): void {
    if (msg.type === "thinking" && msg.content) {
      console.log(`[Manager] [THINKING] ${msg.content.substring(0, 200)}...`);
    } else if (msg.type === "tool_use" && msg.toolName) {
      let toolMsg = `Tool: ${msg.toolName}`;
      if (msg.toolInput) {
        const input = msg.toolInput;
        if (input.command) toolMsg += ` -> ${String(input.command).substring(0, 100)}`;
        else if (input.file_path) toolMsg += ` -> ${input.file_path}`;
      }
      console.log(`[Manager] ${toolMsg}`);
      this.postLog(toolMsg, "tool");
    } else if (msg.type === "text" && msg.content) {
      // Accumulate all text output for decision parsing
      this.allOutput += msg.content + "\n";

      // Log meaningful output
      if (msg.content.length > 20) {
        console.log(`[Manager] ${msg.content}`);
        // Post to dashboard for visibility
        this.postLog(msg.content.substring(0, 500), "manager");
      }
    } else if (msg.type === "result" && msg.content) {
      this.allOutput += msg.content + "\n";
      console.log(`[Manager] Result: ${msg.content.substring(0, 200)}...`);
    }
  }

  /**
   * Parse the review decision from agent output.
   */
  private parseDecision(): ReviewDecision {
    // Look for REVIEW_DECISION: marker
    const decisionMatch = this.allOutput.match(/REVIEW_DECISION:\s*(approved|revision_needed|rejected)/i);
    if (decisionMatch) {
      return decisionMatch[1].toLowerCase() as ReviewDecision;
    }

    // Fallback: look for legacy markers
    const legacyMatch = this.allOutput.match(/::review_decision::(approved|revision_needed|rejected)/i);
    if (legacyMatch) {
      return legacyMatch[1].toLowerCase() as ReviewDecision;
    }

    // Default to approved if agent completed successfully without explicit decision
    console.log("[Manager] No explicit decision found, defaulting to approved");
    return "approved";
  }

  /**
   * Parse feedback from agent output.
   */
  private parseFeedback(): string {
    // Look for FEEDBACK: marker - capture everything until REVIEW_DECISION: or CODE_QUALITY_SCORE: or end
    // Use [\s\S]*? to properly match multi-line content including newlines
    const feedbackMatch = this.allOutput.match(/FEEDBACK:\s*([\s\S]*?)(?=\n\s*(?:REVIEW_DECISION:|CODE_QUALITY_SCORE:)|$)/i);
    if (feedbackMatch && feedbackMatch[1].trim()) {
      return feedbackMatch[1].trim();
    }

    // Fallback: look for legacy markers
    const legacyMatch = this.allOutput.match(/::feedback::([^\n]+)/i);
    if (legacyMatch) {
      return legacyMatch[1].trim();
    }

    return "No feedback provided";
  }

  /**
   * Parse code quality score from agent output.
   */
  private parseCodeQualityScore(): number {
    // Look for CODE_QUALITY_SCORE: marker
    const scoreMatch = this.allOutput.match(/CODE_QUALITY_SCORE:\s*(\d+)/i);
    if (scoreMatch) {
      return Math.min(10, Math.max(1, parseInt(scoreMatch[1], 10)));
    }

    // Fallback: look for legacy markers
    const legacyMatch = this.allOutput.match(/::code_quality_score::(\d+)/i);
    if (legacyMatch) {
      return Math.min(10, Math.max(1, parseInt(legacyMatch[1], 10)));
    }

    return 7; // Default to 7 if not specified
  }

  /**
   * Report completion to the WorkerMill API.
   */
  private async reportCompletion(
    decision: ReviewDecision,
    feedback: string,
    codeQualityScore: number
  ): Promise<void> {
    const url = `${this.config.apiBaseUrl}/api/tasks/${this.config.taskId}/manager-complete`;

    const payload = {
      decision,
      feedback: feedback.substring(0, 10000), // Allow up to 10K chars for detailed feedback
      codeQualityScore,
      managerModel: this.config.model || "opus",
    };

    await this.postLog(`Reporting completion: ${decision}`, "system");

    // Retry up to 3 times with exponential backoff
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await axios.post(url, payload, {
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.config.orgApiKey,
          },
          timeout: 30000,
        });

        await this.postLog(`Completion reported successfully: ${JSON.stringify(response.data)}`, "system");
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const errMsg = err instanceof Error ? err.message : String(err);
        await this.postLog(
          `Attempt ${attempt}/${maxRetries}: Failed to report completion: ${errMsg}`,
          "error"
        );

        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // All retries failed - log backup markers for orchestrator detection
    await this.postLog(`All API attempts failed. Logging backup markers.`, "error");
    await this.postLog(`::manager_decision::${decision}`, "system");
    await this.postLog(`::manager_score::${codeQualityScore}`, "system");
    await this.postLog(`::manager_feedback::${feedback.substring(0, 5000)}`, "system");

    throw lastError || new Error("Failed to report completion after all retries");
  }
}
