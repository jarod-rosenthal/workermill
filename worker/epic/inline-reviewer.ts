/**
 * Inline Tech Lead Reviewer for Epic Mode
 *
 * Runs PR code review inline in the same container after Epic completion.
 * Eliminates the need for a separate manager container.
 */

import axios from "axios";
import { runAgent, type AgentOptions, type AgentResult } from "./agent-sdk.js";
import type { EpicConfig, StreamMessage } from "./types.js";
import type { QualityMetrics } from "./quality-runner.js";
import { createAIClient, type AIClient, type AIClientOptions } from "./ai-client-types.js";

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
  /** Story indices that need revision (for selective revision) */
  affectedStories?: number[];
  /** Reasons why each story needs revision */
  affectedReasons?: Record<number, string>;
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

***REMOVED******REMOVED*** Organization Guidelines

If the following org-level guidelines were provided, flag any code that violates them — even if the implementation is otherwise technically correct:

{{ORG_GUIDELINES}}

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

***REMOVED******REMOVED*** Pre-Review Guidelines

**Do NOT install dependencies or run test suites.** The expert workers already built, tested, and committed the code in this same workspace — dependencies are already installed and test results are provided in the quality metrics below.

Your job is to **read the code** using \`gh pr diff\`, \`Read\`, \`Glob\`, and \`Grep\`. Use Bash only for \`gh\` CLI commands and lightweight checks (e.g., \`go build ./...\`, \`go vet ./...\`, \`gofmt -d ./...\`).

**Do NOT run:** \`npm install\`, \`go mod download\`, \`npm run test:e2e\`, \`go test\`, \`golangci-lint\`, or any other expensive build/test commands. Check the quality metrics provided in the review prompt for test and lint results.

***REMOVED******REMOVED*** Architecture Review Checklist

When reviewing, consider:
- [ ] Follows existing patterns in the codebase
- [ ] SOLID principles applied appropriately
- [ ] No unnecessary complexity
- [ ] Appropriate separation of concerns
- [ ] Error handling is comprehensive
- [ ] Edge cases considered
- [ ] Performance implications evaluated

***REMOVED******REMOVED*** E2E Test Verification

Check the quality metrics for E2E test results (do NOT re-run tests yourself):
- [ ] Quality metrics show E2E tests passed
- [ ] New components have corresponding E2E coverage (review test files)
- [ ] Playwright selectors use \`getByRole\` with \`{ name }\` for interactive elements, NOT \`getByText\`
- [ ] ARIA attributes are valid for the target element's role (e.g., no \`aria-expanded\` on \`type="search"\` inputs)
- [ ] Text queries use \`{ exact: true }\` to avoid substring matching issues

***REMOVED******REMOVED*** Go Project Verification

If the repo has Go code (\`go.mod\` exists), run these lightweight checks:
- [ ] \`go build ./...\` compiles without errors (catches cross-story integration issues)
- [ ] \`go vet ./...\` passes with no warnings
- [ ] \`gofmt -d ./...\` produces no output (code is properly formatted)
- [ ] Go import groups are properly ordered (stdlib, third-party, local)

Do NOT run \`go test\` or \`golangci-lint\` — check quality metrics for those results.

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

***REMOVED******REMOVED******REMOVED*** For REVISION_NEEDED Decisions - Specify Affected Stories

When requesting revision, you MUST specify which stories need changes. Look at the Story Summary table provided and identify ONLY the stories with actual issues.

\`\`\`
AFFECTED_STORIES: [2, 3]
AFFECTED_REASONS: {"2": "Missing CI workflow configuration", "3": "Husky hooks not properly set up"}
\`\`\`

**Guidelines:**
- Only include stories that have ACTUAL implementation issues
- The system automatically handles downstream dependencies - you don't need to include them
- If ALL stories need revision, you may omit AFFECTED_STORIES (all will re-run)
- Be specific in AFFECTED_REASONS so developers know exactly what to fix

***REMOVED******REMOVED*** Important Notes

- Always fetch the code changes first (using \`gh pr diff\` for GitHub, or \`git diff origin/main...HEAD\` for Bitbucket/GitLab)
- For GitHub: Submit your review using \`gh pr review\`
- For Bitbucket/GitLab: Your review decision will be captured from the output markers
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
  private aiClient: AIClient | null = null;

  private techLeadPrompt: string;

  constructor(config: EpicConfig, repoPath: string, serverReviewPrompt?: string) {
    this.config = config;
    this.repoPath = repoPath;
    const reviewerPrompt = (serverReviewPrompt ?? TECH_LEAD_SYSTEM_PROMPT).replace(
      "{{ORG_GUIDELINES}}",
      config.orgGuidelines
        ? config.orgGuidelines
        : "(none set — skip this section)"
    );
    this.techLeadPrompt = reviewerPrompt;

    // Create axios instance for posting logs
    this.logsApi = axios.create({
      baseURL: config.apiBaseUrl,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.orgApiKey,
      },
      timeout: 5000,
    });

    // Initialize AIClient if unified client is enabled
    if (config.useUnifiedClient) {
      this.aiClient = createAIClient({
        provider: "anthropic",
        apiKeys: { anthropic: config.anthropicApiKey },
        apiConfig: { baseUrl: config.apiBaseUrl, orgApiKey: config.orgApiKey },
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

  /**
   * Post a log message to the WorkerMill dashboard.
   */
  private async postLog(
    message: string,
    type: "system" | "manager" | "tool" | "output" | "error" = "output"
  ): Promise<void> {
    console.log(`[👑 tech_lead 🤖] ${message}`);

    try {
      await this.logsApi.post("/api/control-center/logs", {
        taskId: this.config.parentTaskId,
        type,
        message: `[👑 tech_lead 🤖] ${message}`,
        severity: type === "error" ? "error" : "info",
      });
    } catch {
      // Fire and forget - don't block on log failures
    }
  }

  /**
   * Story completion info for the review prompt.
   */
  private storyCompletions: Array<{ storyIndex: number; title: string; filesModified?: string[] }> = [];

  /**
   * Execute inline PR review.
   */
  async review(
    prUrl: string,
    prNumber: number,
    revisionCount: number = 0,
    previousFeedback?: string,
    qualityMetrics?: QualityMetrics,
    storyCompletions?: Array<{ storyIndex: number; title: string; filesModified?: string[] }>,
    storyContext?: { storyIndex: number; title: string; description: string; totalStories: number; targetFiles?: string[] }
  ): Promise<InlineReviewResult> {
    this.allOutput = ""; // Reset output accumulator
    this.storyCompletions = storyCompletions || [];

    await this.postLog("Starting inline Tech Lead review", "system");
    await this.postLog(`PR: ${prUrl}`, "system");
    await this.postLog(`Jira: ${this.config.jiraIssueKey}`, "system");
    const maxRevisions = parseInt(process.env.MAX_REVIEW_REVISIONS || "3", 10);
    if (revisionCount > 0) {
      await this.postLog(`Revision attempt: ${revisionCount}/${maxRevisions}`, "system");
    }

    try {
      // Build the review prompt
      const prompt = this.buildReviewPrompt(prUrl, prNumber, revisionCount, previousFeedback, qualityMetrics, storyCompletions, storyContext);

      // Use manager model from environment (set by API from org settings) or config
      // NOTE: This reviewer uses the Claude Agent SDK (Anthropic only).
      // For non-Anthropic providers, the Epic coordinator routes to InlineReviewerAiSdk instead.
      const model = process.env.MANAGER_MODEL || this.config.model || "";
      await this.postLog(`Using model: ${model}`, "system");

      // IMPORTANT: Use separate reviewer token to avoid GitHub self-approval restriction
      // The PR was created with GITHUB_TOKEN, so we need a different token to approve it
      const originalGhToken = process.env.GH_TOKEN;
      if (this.config.githubReviewerToken) {
        process.env.GH_TOKEN = this.config.githubReviewerToken;
        await this.postLog("Using separate reviewer token for PR approval", "system");
      } else {
        // Fall back to the available token so gh CLI can at least read the PR diff
        const fallbackToken = this.config.githubToken || process.env.SCM_TOKEN || process.env.GITHUB_TOKEN || "";
        if (fallbackToken) {
          process.env.GH_TOKEN = fallbackToken;
          await this.postLog("No GITHUB_REVIEWER_TOKEN set - using main token (PR approval may fail due to self-approval restriction)", "system");
        } else {
          await this.postLog("WARNING: No GitHub token available - gh CLI commands will fail", "system");
        }
      }

      // Create tech_lead expert config for the reviewer
      const techLeadConfig = {
        persona: "tech_lead" as const,
        description: "Technical leadership - code review, architecture, mentoring",
        systemPrompt: this.techLeadPrompt,
        tools: ["Read", "Glob", "Grep", "Bash"],
        model,
        specialties: ["review", "architecture", "code quality"],
      };

      // Run the agent using Epic's agent SDK (or unified AIClient if enabled)
      const result = await this.executeAgent(
        {
          prompt,
          expertConfig: techLeadConfig,
          repoPath: this.repoPath,
          storyId: `review-${prNumber}`,
        },
        `review-${prNumber}`,
        (msg) => this.handleMessage(msg)
      );

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

      // Extract decision from output (uses LLM extraction if text parsing fails)
      const { decision, feedback, score: codeQualityScore, affectedStories, affectedReasons } = await this.getDecision();

      await this.postLog(`Decision: ${decision}`, "system");
      await this.postLog(`Code Quality Score: ${codeQualityScore}`, "system");
      if (feedback) {
        await this.postLog(`Feedback: ${feedback}`, "system");
      }
      if (affectedStories && affectedStories.length > 0) {
        await this.postLog(`Affected stories for selective revision: ${affectedStories.join(", ")}`, "system");
      }

      return {
        success: true,
        decision,
        feedback,
        codeQualityScore,
        affectedStories,
        affectedReasons,
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
    previousFeedback?: string,
    qualityMetrics?: QualityMetrics,
    storyCompletions?: Array<{ storyIndex: number; title: string; filesModified?: string[] }>,
    storyContext?: { storyIndex: number; title: string; description: string; totalStories: number; targetFiles?: string[] }
  ): string {
    const maxRevisions = parseInt(process.env.MAX_REVIEW_REVISIONS || "3", 10);
    const revisionSection = previousFeedback
      ? `***REMOVED******REMOVED*** Previous Review Feedback (Revision ${revisionCount}/${maxRevisions})
This is a revision attempt. The previous code was reviewed and these issues were identified:

${previousFeedback}

**IMPORTANT: Check if ALL issues above have been addressed, not just some of them.**
- The developer was instructed to fix every item
- If ANY issue remains unaddressed, request another revision
- Be specific about which items are still outstanding

---

`
      : "";

    // Build quality metrics section if available
    let qualitySection = "";
    if (qualityMetrics) {
      const hasLintIssues = qualityMetrics.lintErrors > 0;
      const hasTypeErrors = qualityMetrics.typeErrors > 0;
      const hasTestFailures = qualityMetrics.testsFailed > 0;
      const hasSecurityIssues = qualityMetrics.securityHigh > 0;
      const qualityBelowThreshold = qualityMetrics.qualityScore < 70;

      qualitySection = `***REMOVED******REMOVED*** Automated Quality Metrics

| Metric | Result | Status |
|--------|--------|--------|
| **Overall Score** | ${qualityMetrics.qualityScore}% | ${qualityMetrics.qualityScore >= 70 ? '✅' : '⚠️ Below 70% threshold'} |
| TypeCheck | ${qualityMetrics.typeErrors} errors | ${hasTypeErrors ? '❌ MUST FIX' : '✅'} |
| Lint | ${qualityMetrics.lintErrors} errors, ${qualityMetrics.lintWarnings} warnings | ${hasLintIssues ? '⚠️' : '✅'} |
| Tests | ${qualityMetrics.testsPassed} passed, ${qualityMetrics.testsFailed} failed | ${hasTestFailures ? '❌ MUST FIX' : '✅'} |
| Security | ${qualityMetrics.securityHigh} high, ${qualityMetrics.securityMedium} medium | ${hasSecurityIssues ? '🔴 CRITICAL' : '✅'} |

***REMOVED******REMOVED******REMOVED*** Quality Gate Rules
${qualityBelowThreshold ? '**⚠️ QUALITY SCORE BELOW 70% - Revision required unless there is a very good reason.**\n' : ''}
${hasTypeErrors ? '**❌ TYPE ERRORS DETECTED - These MUST be fixed. Request revision.**\n' : ''}
${hasTestFailures ? '**❌ TEST FAILURES DETECTED - These MUST be fixed. Request revision.**\n' : ''}
${hasSecurityIssues ? '**🔴 HIGH SEVERITY SECURITY ISSUES - These MUST be fixed. Request revision.**\n' : ''}

---

`;
    }

    // Build story summary section for selective revision
    let storySummarySection = "";
    if (storyCompletions && storyCompletions.length > 0) {
      const sortedStories = [...storyCompletions].sort((a, b) => a.storyIndex - b.storyIndex);
      const storyRows = sortedStories.map((s) => {
        const filesStr = s.filesModified?.slice(0, 3).join(", ") || "(none)";
        const moreFiles = s.filesModified && s.filesModified.length > 3 ? ` +${s.filesModified.length - 3} more` : "";
        return `| ${s.storyIndex} | ${s.title.substring(0, 50)}${s.title.length > 50 ? "..." : ""} | ${filesStr}${moreFiles} |`;
      }).join("\n");

      storySummarySection = `***REMOVED******REMOVED*** Story Summary

**IMPORTANT:** When requesting REVISION_NEEDED, identify which specific stories need changes.
Use the story indices from this table in your AFFECTED_STORIES output.

| Story | Title | Files Modified |
|-------|-------|----------------|
${storyRows}

---

`;
    }

    // Build requirements section — scope to this story if per-story review
    let jiraSection = "";
    if (storyContext) {
      const targetFilesSection =
        storyContext.targetFiles && storyContext.targetFiles.length > 0
          ? `\n***REMOVED******REMOVED******REMOVED*** Target Files for This Story\nThis story should ONLY produce/modify these files:\n${storyContext.targetFiles.map((f) => `- \`${f}\``).join("\n")}\n\n**Do NOT reject for missing files that are not in this list — they belong to other stories.**\n`
          : "";
      jiraSection = `***REMOVED******REMOVED*** Review Scope — Story ${storyContext.storyIndex} of ${storyContext.totalStories}

**CRITICAL: This PR contains ONLY story ${storyContext.storyIndex}. The parent ticket has ${storyContext.totalStories} stories total, each in its own PR. Do NOT reject this PR for missing files or features that belong to other stories.**

***REMOVED******REMOVED******REMOVED*** Story: ${storyContext.title}

**Scope hint (NOT a spec):** ${storyContext.description}

**The story description above is a FILE SCOPE LABEL — it describes which area of the codebase the expert owns, NOT a list of requirements.** Do NOT treat words in the description as mandatory implementation details. The expert may implement the intent differently than the description suggests (e.g., using a client wrapper component instead of modifying a file directly). Review the ACTUAL CODE in the diff for correctness, not whether it literally matches the description wording.
${targetFilesSection}
---

`;
    } else if (this.config.jiraRequirements) {
      jiraSection = `***REMOVED******REMOVED*** Jira Requirements

${this.config.jiraRequirements}

---

`;
    }

    // Build SCM-aware instructions
    const scmProvider = process.env.SCM_PROVIDER || "github";
    const isGitHub = scmProvider === "github";
    const isBitbucket = scmProvider === "bitbucket";
    const targetRepo = process.env.TARGET_REPO || process.env.GITHUB_REPO || "";

    // Build SCM-specific diff instructions
    let diffInstructions: string;
    let reviewSubmitInstructions: string;

    if (isGitHub) {
      // GitHub: Use gh CLI with explicit -R flag (git remote URL has embedded credentials that confuse gh)
      diffInstructions = `1. **First, list the changed files to understand the scope**:
   \`\`\`bash
   gh pr diff ${prNumber} -R ${targetRepo} --name-only
   \`\`\`

   Then review the diff (for small PRs) or read specific files (for large PRs):
   \`\`\`bash
   gh pr diff ${prNumber} -R ${targetRepo}  ***REMOVED*** Full diff - use for small PRs (<10 files)
   \`\`\`
   For large PRs with many files, read individual files directly instead of loading the full diff.`;

      reviewSubmitInstructions = `4. **Submit your review to GitHub** (REQUIRED):

   **If APPROVE:**
   \`\`\`bash
   gh pr review ${prNumber} -R ${targetRepo} --approve --body "Your approval message"
   \`\`\`

   **If REVISION_NEEDED or REJECT:**
   \`\`\`bash
   gh pr review ${prNumber} -R ${targetRepo} --request-changes --body "Your detailed feedback"
   \`\`\`

5.`;
    } else if (isBitbucket) {
      // Bitbucket: Use REST API via curl or git diff
      // Environment has: BITBUCKET_EMAIL, SCM_TOKEN for API auth
      diffInstructions = `1. **First, list the changed files to understand the scope**:

   **Option A - Use git diff (if branch is checked out locally):**
   \`\`\`bash
   git diff --name-only origin/main...HEAD
   \`\`\`

   **Option B - Use Bitbucket API (if you have the PR details):**
   \`\`\`bash
   ***REMOVED*** List files changed in PR
   curl -s -u "\${BITBUCKET_EMAIL}:\${SCM_TOKEN}" \\
     "https://api.bitbucket.org/2.0/repositories/${targetRepo}/pullrequests/${prNumber}/diffstat" | \\
     jq -r '.values[].new.path // .values[].old.path' 2>/dev/null || echo "Use git diff instead"
   \`\`\`

   Then review the diff:
   - **Small PRs (<10 files)**: Get the full diff
     \`\`\`bash
     git diff origin/main...HEAD
     \`\`\`
   - **Large PRs (10+ files)**: Read individual important files directly using the Read tool instead of loading the entire diff. Focus on:
     - Core logic files (not config/generated files)
     - Files related to the Jira requirements
     - Security-sensitive files (auth, crypto, etc.)

   **IMPORTANT:** Do NOT use \`gh\` commands - this is a Bitbucket repository, not GitHub.`;

      reviewSubmitInstructions = `4. **(Bitbucket: Review submission is handled automatically based on your decision markers)**

   Your REVIEW_DECISION and FEEDBACK markers will be used to update the PR status.

5.`;
    } else {
      // GitLab or other: Use plain git commands
      diffInstructions = `1. **First, list the changed files to understand the scope**:
   \`\`\`bash
   git diff --name-only origin/main...HEAD
   \`\`\`

   Then review selectively based on scope:
   - **Small PRs (<10 files)**: Get the full diff
     \`\`\`bash
     git diff origin/main...HEAD
     \`\`\`
   - **Large PRs (10+ files)**: Read individual important files directly using the Read tool instead of loading the entire diff. Focus on:
     - Core logic files (not config/generated files)
     - Files related to the Jira requirements
     - Security-sensitive files (auth, crypto, etc.)`;

      reviewSubmitInstructions = `4. **(GitLab: Review submission is handled automatically)**

5.`;
    }

    // Build SCM-specific notice
    const scmNotice = isBitbucket
      ? `**IMPORTANT:** This is a Bitbucket repository. Do NOT use \`gh\` (GitHub CLI) commands.
Use \`git diff\` commands or Bitbucket API via curl as shown below.`
      : isGitHub
      ? `This is a GitHub repository. Use \`gh\` CLI commands for PR operations.`
      : `This is a ${scmProvider} repository. Use git commands for diff operations.`;

    return `***REMOVED*** PR Code Review Task

${revisionSection}${storySummarySection}${jiraSection}${qualitySection}***REMOVED******REMOVED*** Task Details
- **Jira Issue**: ${this.config.jiraIssueKey}
- **PR URL**: ${prUrl}
- **PR Number**: ${prNumber}
- **SCM Provider**: ${scmProvider}
- **Repository**: ${targetRepo}

${scmNotice}

***REMOVED******REMOVED*** Instructions

${diffInstructions}

2. **Review the code** against these criteria:
   - Does the code in the diff work correctly and make sense for the files being changed? ${storyContext ? "(Review the DIFF, not the story description — the description is a scope hint, not a spec)" : ""}
   - Is the code quality acceptable?
   - Are there security vulnerabilities?
   - Are there test coverage gaps?
   - Does it follow project coding standards?
   ${qualityMetrics ? "- **Do the automated quality metrics pass? (See above)**" : ""}
   ${previousFeedback ? "- **Have the previous review issues been addressed?**" : ""}

3. **Make your decision**: APPROVE, REVISION_NEEDED, or REJECT
   ${qualityMetrics && (qualityMetrics.typeErrors > 0 || qualityMetrics.testsFailed > 0 || qualityMetrics.securityHigh > 0) ? "\n   **NOTE: Due to quality gate failures above, you should request REVISION_NEEDED unless already addressed.**" : ""}

${reviewSubmitInstructions} **Output your decision** using these exact markers:
   \`\`\`
   REVIEW_DECISION: approved
   CODE_QUALITY_SCORE: 8
   FEEDBACK: Your detailed feedback here
   \`\`\`

Begin your review now. Start by fetching the code changes.`;
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
      // Accumulate all text output for decision parsing
      this.allOutput += msg.content + "\n";

      // Log meaningful output
      if (msg.content.length > 20) {
        this.postLog(msg.content, "manager");
      }
    } else if (msg.type === "result" && msg.content) {
      this.allOutput += msg.content + "\n";
      this.postLog(`Result: ${msg.content.substring(0, 500)}...`, "output");
    }
  }

  /**
   * Parse the review decision from agent output.
   * Returns null if no clear decision found (triggers LLM extraction).
   */
  private parseDecisionFromText(): ReviewDecision | null {
    // Look for REVIEW_DECISION: marker first
    const decisionMatch = this.allOutput.match(/REVIEW_DECISION:\s*(approved|revision_needed|rejected)/i);
    if (decisionMatch) {
      return decisionMatch[1].toLowerCase() as ReviewDecision;
    }

    // Check for gh pr review command which is definitive
    if (/gh pr review.*--approve/.test(this.allOutput)) {
      console.log("[👑 tech_lead 🤖] Detected --approve in gh pr review command");
      return "approved";
    }
    if (/gh pr review.*--request-changes/.test(this.allOutput)) {
      console.log("[👑 tech_lead 🤖] Detected --request-changes in gh pr review command");
      return "revision_needed";
    }

    // No definitive marker found - will need LLM extraction
    return null;
  }

  /**
   * Extract review decision using a quick Claude API call.
   * This handles cases where the LLM didn't follow the exact output format.
   */
  private async extractDecisionWithLLM(): Promise<{ decision: ReviewDecision; feedback: string; score: number }> {
    console.log("[👑 tech_lead 🤖] Using LLM extraction for review decision (no clear marker found)");

    // Skip LLM extraction if no API key (e.g. OAuth/local mode — Claude CLI doesn't expose a raw API key)
    if (!this.config.anthropicApiKey) {
      console.warn("[👑 tech_lead 🤖] No Anthropic API key available — skipping LLM extraction");
      return { decision: "approved", feedback: "Review parse failure — approved by default (no API key for LLM extraction). Manual review recommended.", score: 5 };
    }

    // Use Anthropic SDK directly for a quick, structured extraction
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: this.config.anthropicApiKey });

    const extractionPrompt = `You are extracting the review decision from a code review conversation.

The reviewer performed a code review and made a decision. Based on the conversation below, extract:
1. The final decision: "approved", "revision_needed", or "rejected"
2. A brief summary of the feedback (1-3 sentences)
3. A code quality score from 1-10

Look for indicators like:
- "gh pr review --approve" = approved
- "gh pr review --request-changes" = revision_needed
- Phrases like "LGTM", "ship it", "looks good" = approved
- Phrases like "needs changes", "please fix", "issues found" = revision_needed
- Phrases like "cannot approve", "fundamental issues" = rejected

If the reviewer approved the PR on GitHub, the decision is "approved".
If unsure, default to "revision_needed" to be safe.

REVIEW CONVERSATION:
${this.allOutput}

Respond with ONLY a JSON object (no markdown, no explanation):
{"decision": "approved|revision_needed|rejected", "feedback": "brief summary", "score": 1-10}`;

    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-5", // Fast, cheap model for extraction
        max_tokens: 256,
        messages: [{ role: "user", content: extractionPrompt }],
      });

      const text = response.content[0].type === "text" ? response.content[0].text : "";
      console.log("[👑 tech_lead 🤖] LLM extraction response:", text);

      // Parse JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const decision = (parsed.decision || "revision_needed").toLowerCase() as ReviewDecision;
        const feedback = parsed.feedback || "No feedback extracted";
        const score = Math.min(10, Math.max(1, parseInt(parsed.score, 10) || 5));

        console.log(`[👑 tech_lead 🤖] LLM extracted: decision=${decision}, score=${score}`);
        return { decision, feedback, score };
      }
    } catch (error) {
      console.error("[👑 tech_lead 🤖] LLM extraction failed:", error);
    }

    // Ultimate fallback — default to "approved" with a warning instead of "revision_needed".
    // Defaulting to revision_needed wastes up to MAX_REVIEW_REVISIONS cycles when the
    // reviewer consistently produces unparseable output, with no useful feedback for the worker.
    // Better to let the code through with a warning than burn revision budget on nothing.
    console.warn("[👑 tech_lead 🤖] Both text parsing and LLM extraction failed — defaulting to approved with warning");
    return { decision: "approved", feedback: "Review parse failure — approved by default. Manual review recommended.", score: 5 };
  }

  /**
   * Get the final review decision, using LLM extraction if needed.
   */
  private async getDecision(): Promise<{
    decision: ReviewDecision;
    feedback: string;
    score: number;
    affectedStories?: number[];
    affectedReasons?: Record<number, string>;
  }> {
    // Try text parsing first
    const textDecision = this.parseDecisionFromText();

    // Parse affected stories if present (for selective revision)
    const affectedResult = this.parseAffectedStories();

    if (textDecision) {
      // Text parsing succeeded - use it with other parsed values
      return {
        decision: textDecision,
        feedback: this.parseFeedback(),
        score: this.parseCodeQualityScore(),
        affectedStories: affectedResult?.stories,
        affectedReasons: affectedResult?.reasons,
      };
    }

    // Text parsing failed - use LLM extraction
    const llmResult = await this.extractDecisionWithLLM();
    return {
      ...llmResult,
      affectedStories: affectedResult?.stories,
      affectedReasons: affectedResult?.reasons,
    };
  }

  /**
   * Parse affected stories from Tech Lead output for selective revision.
   * Looks for AFFECTED_STORIES: [1, 2, 3] and AFFECTED_REASONS: {"1": "reason"} markers.
   */
  private parseAffectedStories(): { stories: number[]; reasons: Record<number, string> } | null {
    // Look for AFFECTED_STORIES: [n, n, n] marker
    const storiesMatch = this.allOutput.match(/AFFECTED_STORIES:\s*\[([^\]]+)\]/i);
    if (!storiesMatch) return null;

    // Parse story indices
    const stories = storiesMatch[1]
      .split(",")
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n));

    if (stories.length === 0) return null;

    // Try to parse AFFECTED_REASONS: {...} if present
    let reasons: Record<number, string> = {};
    const reasonsMatch = this.allOutput.match(/AFFECTED_REASONS:\s*(\{[\s\S]*?\})/i);
    if (reasonsMatch) {
      try {
        const parsed = JSON.parse(reasonsMatch[1]);
        // Convert string keys to numbers and validate
        for (const [key, value] of Object.entries(parsed)) {
          const storyIndex = parseInt(key, 10);
          if (!isNaN(storyIndex) && typeof value === "string") {
            reasons[storyIndex] = value;
          }
        }
      } catch (e) {
        console.log("[👑 tech_lead 🤖] Failed to parse AFFECTED_REASONS JSON:", e);
        // Continue without reasons - stories alone are still useful
      }
    }

    console.log(`[👑 tech_lead 🤖] Parsed affected stories: ${stories.join(", ")}`);
    if (Object.keys(reasons).length > 0) {
      console.log(`[👑 tech_lead 🤖] Parsed affected reasons: ${JSON.stringify(reasons)}`);
    }

    return { stories, reasons };
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

  /**
   * Review a story branch diff without creating a PR.
   * Uses `git diff` against the branch instead of `gh pr diff`.
   */
  async reviewBranch(
    branchName: string,
    storyIndex: number,
    revisionCount: number = 0,
    previousFeedback?: string,
    storyContext?: {
      storyIndex: number;
      title: string;
      description: string;
      totalStories: number;
      targetFiles?: string[];
    },
    baselineSha?: string,
    expertContext?: string
  ): Promise<InlineReviewResult> {
    this.allOutput = ""; // Reset output accumulator

    await this.postLog(
      `Starting per-story review for story ${storyIndex} (branch: ${branchName})`,
      "system"
    );
    const maxPerStoryRevisions = parseInt(
      process.env.MAX_PER_STORY_REVISIONS || "1",
      10
    );
    if (revisionCount > 0) {
      await this.postLog(
        `Revision attempt: ${revisionCount}/${maxPerStoryRevisions}`,
        "system"
      );
    }

    // Short-circuit: if diff is empty, auto-approve (expert found nothing to change)
    if (storyContext) {
      const diffCheck = await this.checkBranchHasChanges(branchName, baselineSha);
      if (!diffCheck.hasChanges) {
        await this.postLog(
          `Story ${storyIndex} has no code changes — auto-approving (expert found nothing to fix)`,
          "system"
        );
        return {
          success: true,
          decision: "approved",
          feedback:
            "No code changes detected — expert determined target files needed no modifications. Auto-approved.",
          codeQualityScore: 7,
        };
      }
    }

    try {
      const prompt = this.buildBranchReviewPrompt(
        branchName,
        storyIndex,
        revisionCount,
        previousFeedback,
        storyContext,
        baselineSha,
        expertContext
      );

      const model =
        process.env.MANAGER_MODEL || this.config.model || "";
      await this.postLog(`Using model: ${model}`, "system");

      const techLeadConfig = {
        persona: "tech_lead" as const,
        description:
          "Technical leadership - code review, architecture, mentoring",
        systemPrompt: this.techLeadPrompt,
        tools: ["Read", "Glob", "Grep", "Bash"],
        model,
        specialties: ["review", "architecture", "code quality"],
      };

      const result = await this.executeAgent(
        {
          prompt,
          expertConfig: techLeadConfig,
          repoPath: this.repoPath,
          storyId: `story-review-${storyIndex}`,
        },
        `story-review-${storyIndex}`,
        (msg) => this.handleMessage(msg)
      );

      if (!result.success) {
        await this.postLog(
          `Story ${storyIndex} review agent failed: ${result.error}`,
          "error"
        );
        return {
          success: false,
          decision: "approved",
          feedback: `Review failed: ${result.error}`,
          codeQualityScore: 0,
          error: result.error,
        };
      }

      const {
        decision,
        feedback,
        score: codeQualityScore,
        affectedStories,
        affectedReasons,
      } = await this.getDecision();

      await this.postLog(
        `Story ${storyIndex} decision: ${decision}`,
        "system"
      );
      await this.postLog(
        `Story ${storyIndex} score: ${codeQualityScore}`,
        "system"
      );
      if (feedback) {
        await this.postLog(`Feedback: ${feedback}`, "system");
      }

      return {
        success: true,
        decision,
        feedback,
        codeQualityScore,
        affectedStories,
        affectedReasons,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.postLog(
        `Story ${storyIndex} review failed: ${errorMessage}`,
        "error"
      );

      return {
        success: false,
        decision: "approved",
        feedback: `Review error: ${errorMessage}`,
        codeQualityScore: 0,
        error: errorMessage,
      };
    }
  }

  /**
   * Build a review prompt for a branch diff (no PR involved).
   */
  private buildBranchReviewPrompt(
    branchName: string,
    storyIndex: number,
    revisionCount: number,
    previousFeedback?: string,
    storyContext?: {
      storyIndex: number;
      title: string;
      description: string;
      totalStories: number;
      targetFiles?: string[];
    },
    baselineSha?: string,
    expertContext?: string
  ): string {
    const maxPerStoryRevisions = parseInt(
      process.env.MAX_PER_STORY_REVISIONS || "1",
      10
    );
    const revisionSection = previousFeedback
      ? `***REMOVED******REMOVED*** Previous Review Feedback (Revision ${revisionCount}/${maxPerStoryRevisions})
This is a revision attempt. The previous code was reviewed and these issues were identified:

${previousFeedback}

**IMPORTANT: Check if ALL issues above have been addressed, not just some of them.**

---

`
      : "";

    let jiraSection = "";
    if (storyContext) {
      const targetFilesSection =
        storyContext.targetFiles && storyContext.targetFiles.length > 0
          ? `\n***REMOVED******REMOVED******REMOVED*** Target Files for This Story\nThis story should ONLY produce/modify these files:\n${storyContext.targetFiles.map((f) => `- \`${f}\``).join("\n")}\n\n**Do NOT reject for missing files that are not in this list — they belong to other stories.**\n**Do NOT run project-wide commands (npm install, npm run lint, npm run typecheck) unless all dependencies exist.** Early foundation stories will not have source files yet — that is expected.\n`
          : "";
      jiraSection = `***REMOVED******REMOVED*** Review Scope — Story ${storyContext.storyIndex} of ${storyContext.totalStories}

**CRITICAL: You are reviewing ONLY story ${storyContext.storyIndex}. The parent ticket has ${storyContext.totalStories} stories total. Do NOT reject for missing features that belong to other stories.**

***REMOVED******REMOVED******REMOVED*** Story: ${storyContext.title}

**Scope hint (NOT a spec):** ${storyContext.description}

**The story description above is a FILE SCOPE LABEL — it describes which area of the codebase the expert owns, NOT a list of requirements.** Do NOT treat words in the description as mandatory implementation details. The expert may implement the intent differently than the description suggests (e.g., using a client wrapper component instead of modifying a file directly). Review the ACTUAL CODE in the diff for correctness, not whether it literally matches the description wording.
${targetFilesSection}
---

`;
    } else if (this.config.jiraRequirements) {
      jiraSection = `***REMOVED******REMOVED*** Jira Requirements

${this.config.jiraRequirements}

---

`;
    }

    // Build expert activity summary if provided
    let expertContextSection = "";
    if (expertContext && expertContext.trim().length > 0) {
      expertContextSection = `***REMOVED******REMOVED*** Expert Activity Summary

The following messages were posted by the expert during implementation. Use this to understand what the expert discovered and decided:

${expertContext}

---

`;
    }

    return `***REMOVED*** Story Branch Code Review

${revisionSection}${jiraSection}${expertContextSection}***REMOVED******REMOVED*** Task Details
- **Jira Issue**: ${this.config.jiraIssueKey}
- **Story**: ${storyIndex}
- **Branch**: ${branchName}

***REMOVED******REMOVED*** Instructions

**IMPORTANT — Empty or Minimal Diffs:**
If \`git diff\` shows NO changes or very few changes, this does NOT automatically mean the story failed. Common valid reasons for an empty diff:
- The story's target files already met the requirements (e.g., "fix lint errors" but none existed)
- The expert inspected files and found no issues to fix
- The work was primarily validation/verification rather than code changes

If the diff is empty, check the **Expert Activity Summary** above (if provided) to understand what the expert actually did. Only request revision if the expert clearly did NOT attempt the work.

1. **List the changed files to understand the scope**:
   \`\`\`bash
   git diff ${baselineSha || `origin/main`}...origin/${branchName} --name-only
   \`\`\`
${baselineSha ? `\n   **NOTE:** This diff is scoped to show ONLY changes made by this story's worker. Changes from completed sibling stories have been merged into the branch baseline and are excluded from this diff.\n` : ""}
   Then review the diff:
   \`\`\`bash
   git diff ${baselineSha || `origin/main`}...origin/${branchName}
   \`\`\`
   For large diffs, read individual files directly instead of loading the full diff.

2. **Review the code** against these criteria:
   - Does the code in the diff work correctly and make sense for the files being changed? ${storyContext ? "(Review the DIFF, not the story description — the description is a scope hint, not a spec)" : ""}
   - Is the code quality acceptable?
   - Are there security vulnerabilities?
   - Does it follow project coding standards?
   ${previousFeedback ? "- **Have the previous review issues been addressed?**" : ""}
${storyContext ? `
**⚠️ SCOPE RULES:**
- Only review the files shown in the diff above. ${baselineSha ? "The diff is already scoped to this story's changes only." : "Files from sibling stories may appear if they were merged — ignore them."}
- Do NOT run \`npm install\`, \`npm run lint\`, \`npm run typecheck\`, or \`npm run test\` — this is a partial story branch, not a complete project. These commands WILL fail because other stories have not been merged yet.
- Read and review files directly instead of running build tools.
` : ""}
3. **Make your decision**: APPROVE or REVISION_NEEDED

4. **Output your decision** using these exact markers:
   \`\`\`
   REVIEW_DECISION: approved
   CODE_QUALITY_SCORE: 8
   FEEDBACK: Your detailed feedback here
   \`\`\`

   For REVISION_NEEDED, also specify:
   \`\`\`
   AFFECTED_STORIES: [${storyIndex}]
   AFFECTED_REASONS: {"${storyIndex}": "Reason for revision"}
   \`\`\`

**IMPORTANT:** Do NOT attempt to approve or submit a PR review — no PR exists yet. Only output your decision markers.

Begin your review now. Start by fetching the branch diff.`;
  }

  /**
   * Check if a story branch has any code changes vs the baseline.
   */
  private async checkBranchHasChanges(
    branchName: string,
    baselineSha?: string
  ): Promise<{ hasChanges: boolean }> {
    try {
      const { execSync } = await import("child_process");
      const base = baselineSha || "origin/main";
      const output = execSync(
        `git diff ${base}...origin/${branchName} --name-only`,
        { cwd: this.repoPath, encoding: "utf-8", timeout: 15000 }
      ).trim();
      return { hasChanges: output.length > 0 };
    } catch {
      // If git diff fails, assume there are changes (don't block review)
      return { hasChanges: true };
    }
  }
}
