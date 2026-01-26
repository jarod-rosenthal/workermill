/**
 * Inline Tech Lead Reviewer for Epic Mode
 *
 * Runs PR code review inline in the same container after Epic completion.
 * Eliminates the need for a separate manager container.
 */

import axios from "axios";
import { runAgent } from "./agent-sdk.js";
import type { EpicConfig, StreamMessage } from "./types.js";

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
 * System prompt for the Tech Lead reviewer.
 */
const TECH_LEAD_SYSTEM_PROMPT = `You are a Tech Lead for WorkerMill, responsible for reviewing code changes made by AI Workers.

Your role combines technical expertise with leadership responsibilities:
- **Code Review**: Evaluate code quality, patterns, and implementation correctness
- **Architecture Guidance**: Ensure changes align with system design and patterns
- **Mentoring**: Provide constructive, actionable feedback that helps workers improve
- **Quality Gate**: Make approve/revise/reject decisions based on technical merit

***REMOVED******REMOVED*** Your Capabilities

You have access to these tools:
- **Bash**: Run shell commands including \`gh\` CLI for GitHub operations
- **Read**: Read files from the repository
- **Glob**: Find files by pattern
- **Grep**: Search file contents

***REMOVED******REMOVED*** Code Review Standards

***REMOVED******REMOVED******REMOVED*** APPROVE when:
- Code correctly implements the Jira requirements
- No obvious bugs or security issues
- Code follows existing patterns in the codebase
- Appropriate error handling is in place
- Changes are maintainable and readable

***REMOVED******REMOVED******REMOVED*** REVISION_NEEDED when:
- Code has fixable issues (style, missing tests, minor bugs)
- Security concerns that can be addressed with changes
- Missing error handling or edge cases
- Could benefit from refactoring for clarity

***REMOVED******REMOVED******REMOVED*** REJECT when:
- Fundamental approach is wrong and cannot be fixed with revisions
- Security vulnerability that requires different architecture
- Task cannot be completed this way

***REMOVED******REMOVED*** Architecture Review Checklist

When reviewing, consider:
- [ ] Follows existing patterns in the codebase
- [ ] SOLID principles applied appropriately
- [ ] No unnecessary complexity
- [ ] Appropriate separation of concerns
- [ ] Error handling is comprehensive
- [ ] Edge cases considered
- [ ] Performance implications evaluated

***REMOVED******REMOVED*** Feedback Guidelines

- **Be specific**: Point to exact lines/files when providing feedback
- **Be constructive**: Suggest alternatives, not just problems
- **Be balanced**: Acknowledge what's done well alongside improvements
- **Be educational**: Explain the "why" behind your suggestions
- **Be pragmatic**: Distinguish must-fix from nice-to-have issues

***REMOVED******REMOVED*** Output Format

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

***REMOVED******REMOVED*** Important Notes

- Always fetch the PR diff first using \`gh pr diff\`
- Submit your review to GitHub using \`gh pr review\`
- Be constructive in feedback - help the worker improve
- Consider the full context of the Jira requirements
- Balance perfectionism with pragmatism - ship good code, not perfect code
`;

/**
 * Inline Tech Lead reviewer for Epic mode.
 */
export class InlineReviewer {
  private config: EpicConfig;
  private repoPath: string;
  private logsApi: ReturnType<typeof axios.create>;
  private allOutput: string = "";

  constructor(config: EpicConfig, repoPath: string) {
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
   * Execute inline PR review.
   */
  async review(
    prUrl: string,
    prNumber: number,
    revisionCount: number = 0,
    previousFeedback?: string
  ): Promise<InlineReviewResult> {
    this.allOutput = ""; // Reset output accumulator

    await this.postLog("Starting inline Tech Lead review", "system");
    await this.postLog(`PR: ${prUrl}`, "system");
    await this.postLog(`Jira: ${this.config.jiraIssueKey}`, "system");
    if (revisionCount > 0) {
      await this.postLog(`Revision attempt: ${revisionCount}/3`, "system");
    }

    try {
      // Build the review prompt
      const prompt = this.buildReviewPrompt(prUrl, prNumber, revisionCount, previousFeedback);

      // Use manager model from environment (set by API from org settings) or config, fallback to sonnet
      const model = process.env.MANAGER_MODEL || this.config.model || "sonnet";
      await this.postLog(`Using model: ${model}`, "system");

      // IMPORTANT: Use separate reviewer token to avoid GitHub self-approval restriction
      // The PR was created with GITHUB_TOKEN, so we need a different token to approve it
      const originalGhToken = process.env.GH_TOKEN;
      if (this.config.githubReviewerToken) {
        process.env.GH_TOKEN = this.config.githubReviewerToken;
        await this.postLog("Using separate reviewer token for PR approval", "system");
      } else {
        await this.postLog("WARNING: No GITHUB_REVIEWER_TOKEN set - PR approval may fail due to self-approval restriction", "system");
      }

      // Create tech_lead expert config for the reviewer
      const techLeadConfig = {
        persona: "tech_lead" as const,
        description: "Technical leadership - code review, architecture, mentoring",
        systemPrompt: TECH_LEAD_SYSTEM_PROMPT,
        tools: ["Read", "Glob", "Grep", "Bash"],
        model,
        specialties: ["review", "architecture", "code quality"],
      };

      // Run the agent using Epic's agent SDK
      const result = await runAgent(this.config, {
        prompt,
        expertConfig: techLeadConfig,
        repoPath: this.repoPath,
        storyId: `review-${prNumber}`,  // Use PR number as story identifier
        onMessage: (msg) => this.handleMessage(msg),
      });

      // Restore original token
      if (originalGhToken !== undefined) {
        process.env.GH_TOKEN = originalGhToken;
      } else {
        delete process.env.GH_TOKEN;
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
        await this.postLog(`Feedback: ${feedback}`, "system");
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
   * Build the review prompt with PR context.
   */
  private buildReviewPrompt(
    prUrl: string,
    prNumber: number,
    revisionCount: number,
    previousFeedback?: string
  ): string {
    const revisionSection = previousFeedback
      ? `***REMOVED******REMOVED*** Previous Review Feedback (Revision ${revisionCount}/3)
This is a revision attempt. The previous code was reviewed and these issues were identified:

${previousFeedback}

**Check if these issues have been addressed in the latest changes.**

---

`
      : "";

    return `***REMOVED*** PR Code Review Task

${revisionSection}***REMOVED******REMOVED*** Task Details
- **Jira Issue**: ${this.config.jiraIssueKey}
- **PR URL**: ${prUrl}
- **PR Number**: ${prNumber}

***REMOVED******REMOVED*** Instructions

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
   * Handle messages from agent execution.
   */
  private handleMessage(msg: StreamMessage): void {
    if (msg.type === "thinking" && msg.content) {
      console.log(`[tech_lead] [THINKING] ${msg.content.substring(0, 200)}...`);
    } else if (msg.type === "tool_use" && msg.toolName) {
      let toolMsg = `Tool: ${msg.toolName}`;
      if (msg.toolInput) {
        const input = msg.toolInput;
        if (input.command) toolMsg += ` -> ${String(input.command).substring(0, 500)}`;
        else if (input.file_path) toolMsg += ` -> ${input.file_path}`;
      }
      console.log(`[tech_lead] ${toolMsg}`);
      this.postLog(toolMsg, "tool");
    } else if (msg.type === "text" && msg.content) {
      // Accumulate all text output for decision parsing
      this.allOutput += msg.content + "\n";

      // Log meaningful output
      if (msg.content.length > 20) {
        console.log(`[tech_lead] ${msg.content}`);
        this.postLog(msg.content, "manager");
      }
    } else if (msg.type === "result" && msg.content) {
      this.allOutput += msg.content + "\n";
      console.log(`[tech_lead] Result: ${msg.content.substring(0, 500)}...`);
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

    // Default to revision_needed if no explicit decision (safer than auto-approve)
    console.log("[tech_lead] No explicit decision found, defaulting to revision_needed");
    return "revision_needed";
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
    // Look for CODE_QUALITY_SCORE: marker
    const scoreMatch = this.allOutput.match(/CODE_QUALITY_SCORE:\s*(\d+)/i);
    if (scoreMatch) {
      return Math.min(10, Math.max(1, parseInt(scoreMatch[1], 10)));
    }

    return 5; // Default to middle score if not specified
  }
}
