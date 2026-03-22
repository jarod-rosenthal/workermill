/**
 * Inline Tech Lead Reviewer for Epic Mode
 *
 * Runs PR code review inline in the same container after Epic completion.
 * Eliminates the need for a separate manager container.
 */

import type { AxiosInstance } from "axios";
import { createLogsApi } from "../lib/api-client.js";
import { runAgent, type AgentOptions, type AgentResult } from "./agent-sdk.js";
import { getTicketLabel, type EpicConfig, type StreamMessage } from "./types.js";
import type { QualityMetrics } from "./quality-runner.js";
import { createAIClient, type AIClient, type AIClientOptions, type AIProvider } from "./ai-client-types.js";

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

## 🚨 ABSOLUTE RULE — NEVER Flag Language/Runtime Versions as Invalid

The current date is ${new Date().toISOString().split("T")[0]}. Your training data is OUTDATED — newer language and runtime versions have been released since your cutoff. NEVER suggest downgrading a language version. NEVER say a version "doesn't exist" or is "non-existent." If the project uses a version you don't recognize, it is correct — the project authors chose it deliberately. Flagging valid versions as invalid causes cascading damage: workers obey your feedback and downgrade, breaking the entire project.

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

## Organization Guidelines

If the following org-level guidelines were provided, flag any code that violates them — even if the implementation is otherwise technically correct:

{{ORG_GUIDELINES}}

## Code Review Standards

### APPROVE when:
- Code correctly implements the requirements
- No obvious bugs or security issues
- Code follows existing patterns in the codebase
- Appropriate error handling is in place
- Quality gates pass (lint, typecheck, tests)
- Minor cosmetic issues (formatting, empty lines, comment style, variable naming preferences) are NOT grounds for revision — mention them in feedback but still approve

### REVISION_NEEDED when:
- Code has functional bugs that affect correctness
- Security vulnerabilities that must be fixed
- Quality gates fail (lint errors, type errors, test failures) AND the worker did not attempt to fix them
- Missing required functionality from the task requirements
- Broken imports, missing dependencies, or code that won't run

### Do NOT request revision for:
- Style preferences (extra/missing blank lines, comment formatting, string quote style)
- Minor naming differences that don't affect functionality
- "Could be cleaner" refactoring suggestions
- Missing tests for edge cases when core functionality is tested
- Code that works correctly but isn't how you would have written it

### REJECT when:
- Fundamental approach is wrong and cannot be fixed with revisions
- Security vulnerability that requires different architecture
- Task cannot be completed this way

## Pre-Review Guidelines

**Do NOT install dependencies.** The expert workers already built, tested, and committed the code in this same workspace — dependencies are already installed.

Your job is to **read the code** using \`gh pr diff\`, \`Read\`, \`Glob\`, and \`Grep\`. Use Bash only for \`gh\` CLI commands, lightweight checks (e.g., \`go build ./...\`, \`go vet ./...\`, \`gofmt -d ./...\`), and **running quality gate commands when provided in the review prompt**.

**Do NOT run:** \`npm install\`, \`go mod download\`, \`golangci-lint\`, or other dependency installation commands. For test and lint results, check the quality metrics provided in the review prompt — UNLESS quality gate commands are explicitly provided, in which case you MUST run them and report the results.

## Architecture Review Checklist

When reviewing, consider:
- [ ] Follows existing patterns in the codebase
- [ ] SOLID principles applied appropriately
- [ ] No unnecessary complexity
- [ ] Appropriate separation of concerns
- [ ] Error handling is comprehensive
- [ ] Edge cases considered
- [ ] Performance implications evaluated

## E2E Test Verification

Check the quality metrics for E2E test results (do NOT re-run tests yourself):
- [ ] Quality metrics show E2E tests passed
- [ ] New components have corresponding E2E coverage (review test files)
- [ ] Playwright selectors use \`getByRole\` with \`{ name }\` for interactive elements, NOT \`getByText\`
- [ ] ARIA attributes are valid for the target element's role (e.g., no \`aria-expanded\` on \`type="search"\` inputs)
- [ ] Text queries use \`{ exact: true }\` to avoid substring matching issues

## 🚨 REMINDER: NEVER Second-Guess Language Versions

**This is repeated because it is critical.** Your training data is outdated — newer versions of every language and runtime exist. NEVER flag a version as invalid. NEVER suggest downgrading. If you tell workers a version is "non-existent," they will downgrade and break the project.

## Go Project Verification

If the repo has Go code (\`go.mod\` exists), run these lightweight checks:
- [ ] \`go build ./...\` compiles without errors (catches cross-story integration issues)
- [ ] \`go vet ./...\` passes with no warnings
- [ ] \`gofmt -d ./...\` produces no output (code is properly formatted)
- [ ] Go import groups are properly ordered (stdlib, third-party, local)

Do NOT run \`go test\` or \`golangci-lint\` — check quality metrics for those results.

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

### For REVISION_NEEDED Decisions - Specify Affected Stories

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

## Important Notes

- Always fetch the code changes first (using \`gh pr diff\` for GitHub, or \`git diff origin/main...HEAD\` for Bitbucket/GitLab)
- For GitHub: Submit your review using \`gh pr review\`
- For Bitbucket/GitLab: Your review decision will be captured from the output markers
- Be constructive in feedback - help the worker improve
- Consider the full context of the requirements
- **Bias toward approval**: If the code works, passes quality gates, and implements the requirements, approve it. Cosmetic feedback belongs in comments, not in revision requests. Every revision cycle costs significant time and tokens — only block when there's a real functional or security issue.
- A score of 7+ should almost always be an approval

## CI / GitHub Actions Awareness

CI gate checks run BEFORE your review. The CI status is provided in the review prompt above the task details. If CI failed and could not be auto-fixed, this is noted in the prompt — factor it into your decision. Do NOT approve a PR with failing CI unless the failure is clearly unrelated to the code in this PR. Include CI status in your review body.

## Review Body Quality

Your GitHub PR review body represents WorkerMill's engineering standards. Every review MUST be substantive and demonstrate that you actually examined the code. Include specific file names, test counts, quality gate results, and CI status. Generic reviews like "Looks good" or "All quality gates pass" are unacceptable — they tell the reader nothing and make the platform look like a rubber stamp.

## Communication Style

Write in a professional, direct tone. Do NOT open messages with filler words or pleasantries like "Perfect!", "Great!", "Awesome!", "Sure!", "Absolutely!", or similar. Start with the substance — what you found, your assessment, or what needs to change. Be concise and informative.
`;

/**
 * Inline Tech Lead reviewer for Epic mode.
 */
export class InlineReviewer {
  private config: EpicConfig;
  private repoPath: string;
  private logsApi: AxiosInstance;
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
    storyContext?: { storyIndex: number; title: string; description: string; totalStories: number; targetFiles?: string[] },
    ciStatus?: { passed: boolean; fixed: boolean; log?: string }
  ): Promise<InlineReviewResult> {
    this.allOutput = ""; // Reset output accumulator
    this.storyCompletions = storyCompletions || [];

    await this.postLog("Starting inline Tech Lead review", "system");
    await this.postLog(`PR: ${prUrl}`, "system");
    await this.postLog(`${getTicketLabel(this.config.ticketSystem)}: ${this.config.jiraIssueKey}`, "system");
    if (revisionCount > 0) {
      await this.postLog(`Review ${revisionCount + 1}/${this.config.maxReviewRevisions} (revision ${revisionCount + 1})`, "system");
    }

    try {
      // Build the review prompt
      const prompt = this.buildReviewPrompt(prUrl, prNumber, revisionCount, previousFeedback, qualityMetrics, storyCompletions, storyContext, ciStatus);

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
    storyContext?: { storyIndex: number; title: string; description: string; totalStories: number; targetFiles?: string[] },
    ciStatus?: { passed: boolean; fixed: boolean; log?: string }
  ): string {
    const maxRevisions = this.config.maxReviewRevisions;
    const revisionSection = previousFeedback
      ? `## Previous Review Feedback (Review ${revisionCount + 1}/${maxRevisions})
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
      const thresholds = this.config.qualityThresholds;
      const blockOnTypeErrors = thresholds?.blockOnTypeErrors ?? false;
      const blockOnTestFailures = thresholds?.blockOnTestFailures ?? true;
      const blockOnLintErrors = thresholds?.blockOnLintErrors ?? false;
      const blockOnE2EFailures = thresholds?.blockOnE2EFailures ?? false;
      const minQualityScore = thresholds?.minQualityScore ?? null;
      const maxSecurityHigh = thresholds?.maxSecurityHighVulns ?? null;

      const hasLintIssues = qualityMetrics.lintErrors > 0;
      const hasTypeErrors = qualityMetrics.typeErrors > 0;
      const hasTestFailures = qualityMetrics.testsFailed > 0;
      const hasSecurityIssues = maxSecurityHigh !== null ? qualityMetrics.securityHigh > maxSecurityHigh : qualityMetrics.securityHigh > 0;
      const qualityBelowThreshold = minQualityScore !== null && qualityMetrics.qualityScore < minQualityScore;

      qualitySection = `## Automated Quality Metrics

| Metric | Result | Status |
|--------|--------|--------|
| **Overall Score** | ${qualityMetrics.qualityScore}% | ${qualityBelowThreshold ? `⚠️ Below ${minQualityScore}% threshold` : '✅'} |
| TypeCheck | ${qualityMetrics.typeErrors} errors | ${hasTypeErrors ? (blockOnTypeErrors ? '❌ Blocking' : '⚠️ Non-blocking') : '✅'} |
| Lint | ${qualityMetrics.lintErrors} errors, ${qualityMetrics.lintWarnings} warnings | ${hasLintIssues ? (blockOnLintErrors ? '❌ Blocking' : '⚠️ Non-blocking') : '✅'} |
| Tests | ${qualityMetrics.testsPassed} passed, ${qualityMetrics.testsFailed} failed | ${hasTestFailures ? (blockOnTestFailures ? '❌ Blocking' : '⚠️ Non-blocking') : '✅'} |
| E2E Tests | ${qualityMetrics.e2ePassed ?? 0} passed, ${qualityMetrics.e2eFailed ?? 0} failed | ${(qualityMetrics.e2eFailed ?? 0) > 0 ? (blockOnE2EFailures ? '❌ Blocking' : '⚠️ Non-blocking') : '✅'} |
| Security | ${qualityMetrics.securityHigh} high, ${qualityMetrics.securityMedium} medium | ${hasSecurityIssues ? '🔴 Blocking' : '✅'} |

### Quality Gate Rules (from Organization Settings)
${qualityBelowThreshold ? `**⚠️ QUALITY SCORE BELOW ${minQualityScore}% - Consider requesting revision.**\n` : ''}
${hasTypeErrors && blockOnTypeErrors ? '**❌ TYPE ERRORS DETECTED - Organization requires these to be fixed.**\n' : ''}
${hasTypeErrors && !blockOnTypeErrors ? '**ℹ️ Type errors detected but blocking is DISABLED in org settings — do NOT request revision for type errors alone.**\n' : ''}
${hasLintIssues && blockOnLintErrors ? '**❌ LINT ERRORS DETECTED - Organization requires these to be fixed.**\n' : ''}
${hasLintIssues && !blockOnLintErrors ? '**ℹ️ Lint errors detected but blocking is DISABLED in org settings — do NOT request revision for lint errors alone.**\n' : ''}
${(qualityMetrics.e2eFailed ?? 0) > 0 && blockOnE2EFailures ? '**❌ E2E TEST FAILURES DETECTED - Organization requires these to be fixed.**\n' : ''}
${(qualityMetrics.e2eFailed ?? 0) > 0 && !blockOnE2EFailures ? '**ℹ️ E2E test failures detected but blocking is DISABLED in org settings — do NOT request revision for E2E failures alone.**\n' : ''}
${hasTestFailures && blockOnTestFailures ? '**❌ TEST FAILURES DETECTED - Organization requires these to be fixed.**\n' : ''}
${hasTestFailures && !blockOnTestFailures ? '**ℹ️ Test failures detected but blocking is DISABLED in org settings — do NOT request revision for test failures alone.**\n' : ''}
${hasSecurityIssues ? '**🔴 HIGH SEVERITY SECURITY ISSUES - These must be fixed.**\n' : ''}
${!qualityBelowThreshold && !hasSecurityIssues && !(hasTypeErrors && blockOnTypeErrors) && !(hasTestFailures && blockOnTestFailures) && !(hasLintIssues && blockOnLintErrors) && !((qualityMetrics.e2eFailed ?? 0) > 0 && blockOnE2EFailures) ? '**✅ All quality gates pass per organization settings — bias toward approval.**\n' : ''}

---

`;
    }

    // Build CI status section if available (CI gate runs before Tech Lead review)
    let ciSection = "";
    if (ciStatus) {
      if (ciStatus.passed) {
        ciSection = `## CI Pipeline Status

| Check | Status |
|-------|--------|
| **GitHub Actions** | ${ciStatus.fixed ? '✅ Passing (fixed by CI Fix Agent)' : '✅ Passing'} |

---

`;
      } else {
        ciSection = `## CI Pipeline Status

| Check | Status |
|-------|--------|
| **GitHub Actions** | ❌ Failing |

${ciStatus.log ? `**CI Failure Details:**\n\`\`\`\n${ciStatus.log.substring(0, 1000)}\n\`\`\`\n` : ''}
**CI Fix Agent was unable to resolve this issue.** Factor this into your review decision — if the CI failure is caused by code in this PR, request REVISION_NEEDED with specific details about the CI failure.

---

`;
      }
    }

    // Build quality gate commands section — tells the reviewer what commands to run
    // For foundation cards, quality gates don't run automatically (the project was just created),
    // so the reviewer is the quality gate executor.
    let qualityGateCommandsSection = "";
    if (this.config.qualityGateCommands && this.config.qualityGateCommands.length > 0) {
      const gateList = this.config.qualityGateCommands
        .map((g) => `**${g.name}** (trigger: \`${g.trigger}\`):\n${g.commands.map((c) => `\`\`\`bash\n${c}\n\`\`\``).join("\n")}`)
        .join("\n\n");

      const thresholds = this.config.qualityThresholds;
      const blockingRules: string[] = [];
      if (thresholds?.blockOnTypeErrors) blockingRules.push("Type errors are **blocking**");
      else blockingRules.push("Type errors are **non-blocking** (note in feedback, do not request revision)");
      if (thresholds?.blockOnTestFailures) blockingRules.push("Test failures are **blocking**");
      else blockingRules.push("Test failures are **non-blocking** (note in feedback, do not request revision)");
      if (thresholds?.blockOnLintErrors) blockingRules.push("Lint errors are **blocking**");
      else blockingRules.push("Lint errors are **non-blocking** (note in feedback, do not request revision)");
      if (thresholds?.blockOnE2EFailures) blockingRules.push("E2E test failures are **blocking**");
      else blockingRules.push("E2E test failures are **non-blocking** (note in feedback, do not request revision)");
      if (thresholds?.minQualityScore) blockingRules.push(`Quality score below ${thresholds.minQualityScore}% is **blocking**`);
      const blockingContext = blockingRules.length > 0 ? `\n\n**Organization blocking rules:**\n${blockingRules.map(r => `- ${r}`).join("\n")}\n` : "";

      qualityGateCommandsSection = `## Quality Gate Commands

These quality gate commands define the project's standards. Integration gates ran before this review — check results above. You may re-run them to verify:${blockingContext}

${gateList}

**Run each gate command and include the results in your review.** If any gate fails, request REVISION_NEEDED and include the specific errors in your feedback so workers know exactly what to fix.

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

      storySummarySection = `## Story Summary

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
          ? `\n### Target Files for This Story\nThis story should ONLY produce/modify these files:\n${storyContext.targetFiles.map((f) => `- \`${f}\``).join("\n")}\n\n**Do NOT reject for missing files that are not in this list — they belong to other stories.**\n`
          : "";
      jiraSection = `## Review Scope — Story ${storyContext.storyIndex} of ${storyContext.totalStories}

**CRITICAL: This PR contains ONLY story ${storyContext.storyIndex}. The parent ticket has ${storyContext.totalStories} stories total, each in its own PR. Do NOT reject this PR for missing files or features that belong to other stories.**

### Story: ${storyContext.title}

**Scope hint (NOT a spec):** ${storyContext.description}

**The story description above is a FILE SCOPE LABEL — it describes which area of the codebase the expert owns, NOT a list of requirements.** Do NOT treat words in the description as mandatory implementation details. The expert may implement the intent differently than the description suggests (e.g., using a client wrapper component instead of modifying a file directly). Review the ACTUAL CODE in the diff for correctness, not whether it literally matches the description wording.
${targetFilesSection}
---

`;
    } else if (this.config.jiraRequirements) {
      jiraSection = `## Jira Requirements

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
   gh pr diff ${prNumber} -R ${targetRepo}  # Full diff - use for small PRs (<10 files)
   \`\`\`
   For large PRs with many files, read individual files directly instead of loading the full diff.`;

      reviewSubmitInstructions = `4. **Submit your review to GitHub** (REQUIRED):

   Your review body MUST be substantive. Include:
   - **Files reviewed**: count and key files examined
   - **Quality gate results**: lint, typecheck, test results you verified (pass/fail with counts)
   - **CI status**: reference the CI pipeline status from the prompt above
   - **Key findings**: specific observations about the code (positive or negative)
   - **Decision rationale**: why you are approving or requesting changes

   Do NOT write generic one-liners like "All quality gates pass" or "Looks good." Every review must demonstrate that you actually examined the code.

   **If APPROVE:**
   \`\`\`bash
   gh pr review ${prNumber} -R ${targetRepo} --approve --body "Your substantive review"
   \`\`\`

   **If REVISION_NEEDED or REJECT:**
   \`\`\`bash
   gh pr review ${prNumber} -R ${targetRepo} --request-changes --body "Your detailed feedback with specific issues"
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
   # List files changed in PR
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

   Your review feedback MUST be substantive — include specific files reviewed, quality gate results, and key findings. Generic one-liners are unacceptable.

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

    return `# PR Code Review Task

${revisionSection}${storySummarySection}${jiraSection}${qualitySection}${ciSection}${qualityGateCommandsSection}## Task Details
- **Jira Issue**: ${this.config.jiraIssueKey}
- **PR URL**: ${prUrl}
- **PR Number**: ${prNumber}
- **SCM Provider**: ${scmProvider}
- **Repository**: ${targetRepo}

${scmNotice}

## Instructions

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
   ${qualityMetrics ? "\n   **NOTE: Review the quality metrics above. Only request REVISION_NEEDED for metrics marked as ❌ Blocking per organization settings. Metrics marked ⚠️ Non-blocking or ℹ️ Informational should be noted in feedback but are NOT grounds for revision.**" : ""}

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
    // Default to revision_needed so unreviewed code is never silently approved.
    // This is bounded by maxReviewRevisions so it won't cause infinite retries.
    if (!this.config.anthropicApiKey) {
      console.warn("[👑 tech_lead 🤖] No Anthropic API key available — skipping LLM extraction, defaulting to revision_needed");
      return { decision: "revision_needed", feedback: "Review could not be parsed (no API key for LLM extraction). Please review manually.", score: 0 };
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
        model: process.env.MANAGER_MODEL || "claude-sonnet-4-5", // Use tech_lead model setting
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

    // Ultimate fallback — default to "revision_needed" when both parsers fail.
    // This triggers the revision loop which is bounded by MAX_REVIEW_REVISIONS.
    // If parsing consistently fails, the loop hits the max and escalates for human
    // review — safer than auto-approving unreviewed code. Score 0 signals parse
    // failure vs genuine review feedback.
    console.warn("[👑 tech_lead 🤖] Both text parsing and LLM extraction failed — requesting revision (bounded by max revisions, will escalate if persistent)");
    return { decision: "revision_needed", feedback: "Review output could not be parsed by text matching or LLM extraction. Requesting revision — if this persists, the task will escalate for human review.", score: 0 };
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
    const maxPerStoryRevisions = this.config.maxPerStoryRevisions;
    if (revisionCount > 0) {
      await this.postLog(
        `Review ${revisionCount + 1}/${maxPerStoryRevisions} (revision ${revisionCount + 1})`,
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
    const maxPerStoryRevisions = this.config.maxPerStoryRevisions;
    const revisionSection = previousFeedback
      ? `## Previous Review Feedback (Review ${revisionCount + 1}/${maxPerStoryRevisions})
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
          ? `\n### Target Files for This Story\nThis story should ONLY produce/modify these files:\n${storyContext.targetFiles.map((f) => `- \`${f}\``).join("\n")}\n\n**Do NOT reject for missing files that are not in this list — they belong to other stories.**\n**Do NOT run project-wide commands (npm install, npm run lint, npm run typecheck) unless all dependencies exist.** Early foundation stories will not have source files yet — that is expected.\n`
          : "";
      jiraSection = `## Review Scope — Story ${storyContext.storyIndex} of ${storyContext.totalStories}

**CRITICAL: You are reviewing ONLY story ${storyContext.storyIndex}. The parent ticket has ${storyContext.totalStories} stories total. Do NOT reject for missing features that belong to other stories.**

### Story: ${storyContext.title}

**Scope hint (NOT a spec):** ${storyContext.description}

**The story description above is a FILE SCOPE LABEL — it describes which area of the codebase the expert owns, NOT a list of requirements.** Do NOT treat words in the description as mandatory implementation details. The expert may implement the intent differently than the description suggests (e.g., using a client wrapper component instead of modifying a file directly). Review the ACTUAL CODE in the diff for correctness, not whether it literally matches the description wording.
${targetFilesSection}
---

`;
    } else if (this.config.jiraRequirements) {
      jiraSection = `## Jira Requirements

${this.config.jiraRequirements}

---

`;
    }

    // Build expert activity summary if provided
    let expertContextSection = "";
    if (expertContext && expertContext.trim().length > 0) {
      expertContextSection = `## Expert Activity Summary

The following messages were posted by the expert during implementation. Use this to understand what the expert discovered and decided:

${expertContext}

---

`;
    }

    return `# Story Branch Code Review

${revisionSection}${jiraSection}${expertContextSection}## Task Details
- **Jira Issue**: ${this.config.jiraIssueKey}
- **Story**: ${storyIndex}
- **Branch**: ${branchName}

## Instructions

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
