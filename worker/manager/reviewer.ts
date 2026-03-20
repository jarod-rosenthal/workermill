/**
 * Virtual Manager PR Reviewer
 *
 * Handles PR code review using the Claude Agent SDK.
 * Runs the agent, extracts decisions, and reports to API.
 */

import axios, { type AxiosInstance } from "axios";

function createLogsApi(config: { apiBaseUrl: string; orgApiKey: string }): AxiosInstance {
  return axios.create({
    baseURL: config.apiBaseUrl,
    headers: { "Content-Type": "application/json", "x-api-key": config.orgApiKey },
    timeout: 5000,
  });
}
import { runAgent } from "./agent-sdk.js";
import { createDecisionClient, type DecisionClient } from "../epic/dist/decision-client.js";
import { getTicketLabel } from "../epic/dist/types.js";
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
- **Bash**: Run shell commands for git operations and SCM API calls
- **Read**: Read files from the repository
- **Glob**: Find files by pattern
- **Grep**: Search file contents

## SCM Provider Support

Check the SCM_PROVIDER environment variable to determine which SCM platform you're working with:
- **github**: Use \`gh\` CLI commands for PR operations
- **bitbucket**: Use Bitbucket REST API via curl with Basic auth (\${BITBUCKET_EMAIL}:\${SCM_TOKEN})
- **gitlab**: Use GitLab REST API via curl with PRIVATE-TOKEN header

**IMPORTANT**: Do NOT use \`gh\` commands for Bitbucket or GitLab repositories - they will fail.

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

- Always fetch the PR diff first using the appropriate method for your SCM provider
- Submit your review using the appropriate SCM API (GitHub: \`gh pr review\`, Bitbucket: handled automatically by orchestrator)
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
  private logsApi: AxiosInstance;
  private allOutput: string = "";
  private decisionClient: DecisionClient;

  constructor(config: ManagerConfig, repoPath: string) {
    this.config = config;
    this.repoPath = repoPath;

    // Create axios instance for posting logs
    this.logsApi = createLogsApi(config);

    // Decision client for server-side review parsing
    this.decisionClient = createDecisionClient({
      apiBaseUrl: config.apiBaseUrl,
      orgApiKey: config.orgApiKey,
      logger: (msg) => console.log(msg),
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
    await this.postLog(`${getTicketLabel()}: ${this.config.jiraIssueKey}`, "system");

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

      // Parse decision from output via Decision API
      const reviewResult = await this.decisionClient.parseReviewOutcome({
        reviewOutput: this.allOutput,
        reviewerPersona: "tech_lead",
      });
      const decision = reviewResult.decision as ReviewDecision;
      const feedback = reviewResult.feedback || "No feedback provided";
      const codeQualityScore = reviewResult.score || 7;

      await this.postLog(`Decision: ${decision}`, "system");
      await this.postLog(`Code Quality Score: ${codeQualityScore}`, "system");
      if (feedback) {
        await this.postLog(`Feedback: ${feedback}`, "system");
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

    // Detect SCM provider
    const scmProvider = process.env.SCM_PROVIDER || "github";
    const isGitHub = scmProvider === "github";
    const isBitbucket = scmProvider === "bitbucket";
    const targetRepo = process.env.TARGET_REPO || this.config.githubRepo || "";

    // Build SCM-specific diff instructions
    let diffInstructions: string;
    let reviewSubmitInstructions: string;
    let scmNotice: string;

    if (isGitHub) {
      scmNotice = `This is a **GitHub** repository. Use \`gh\` CLI commands for PR operations.`;
      diffInstructions = `1. **Fetch the PR diff**:
   \`\`\`bash
   gh pr diff ${this.config.prNumber}
   \`\`\``;
      reviewSubmitInstructions = `4. **Submit your review to GitHub** (REQUIRED):

   **If APPROVE:**
   \`\`\`bash
   gh pr review ${this.config.prNumber} --approve --body "Your approval message explaining why the code is good"
   \`\`\`

   **If REVISION_NEEDED or REJECT:**
   \`\`\`bash
   gh pr review ${this.config.prNumber} --request-changes --body "Your detailed feedback explaining what needs to be fixed"
   \`\`\``;
    } else if (isBitbucket) {
      scmNotice = `This is a **Bitbucket** repository. Do NOT use \`gh\` (GitHub CLI) commands - they will fail.
Use \`git diff\` commands or Bitbucket API via curl as shown below.`;
      diffInstructions = `1. **Fetch the PR diff**:

   **Option A - Use git diff (recommended if branch is checked out locally):**
   \`\`\`bash
   git diff origin/main...HEAD
   \`\`\`

   **Option B - Use Bitbucket API:**
   \`\`\`bash
   curl -s -u "\${BITBUCKET_EMAIL}:\${SCM_TOKEN}" \\
     "https://api.bitbucket.org/2.0/repositories/${targetRepo}/pullrequests/${this.config.prNumber}/diff"
   \`\`\`

   **To list changed files:**
   \`\`\`bash
   git diff --name-only origin/main...HEAD
   \`\`\``;
      reviewSubmitInstructions = `4. **(Bitbucket: Review submission is handled automatically)**

   Your review decision will be processed by the orchestrator based on the decision markers you output.
   You do NOT need to submit the review via API - just output your decision markers clearly.`;
    } else {
      // GitLab or other
      scmNotice = `This is a **${scmProvider}** repository. Use git commands for diff operations.`;
      diffInstructions = `1. **Fetch the PR diff**:
   \`\`\`bash
   git diff origin/main...HEAD
   \`\`\``;
      reviewSubmitInstructions = `4. **(Review submission is handled automatically)**

   Your review decision will be processed by the orchestrator based on the decision markers you output.`;
    }

    return `# PR Code Review Task

## SCM Provider Notice
${scmNotice}

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

${diffInstructions}

2. **Review the code** against these criteria:
   - Does it correctly implement the Jira requirements?
   - Is the code quality acceptable?
   - Are there security vulnerabilities?
   - Are there test coverage gaps?
   - Does it follow project coding standards?
   ${this.config.reviewFeedback ? "- **Have the issues from the previous review been addressed?**" : ""}

3. **Make your decision**: APPROVE, REVISION_NEEDED, or REJECT

${reviewSubmitInstructions}

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
        if (input.command) toolMsg += ` -> ${String(input.command).substring(0, 500)}`;
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
        this.postLog(msg.content, "manager");
      }
    } else if (msg.type === "result" && msg.content) {
      this.allOutput += msg.content + "\n";
      console.log(`[Manager] Result: ${msg.content.substring(0, 500)}...`);
    }
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
      feedback,
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
          timeout: 300_000,
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
    await this.postLog(`::manager_feedback::${feedback}`, "system");

    throw lastError || new Error("Failed to report completion after all retries");
  }
}
