/**
 * Inline Tech Lead Reviewer for Multi-Expert Mode (AI SDK)
 *
 * Runs PR code review after all stories complete, supporting multi-provider routing.
 * Uses the AI SDK executor to run reviews with any configured provider.
 */

import { spawn } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import axios, { AxiosInstance } from "axios";

// Tech Lead persona prefix for consistent logging
const TECH_LEAD_PREFIX = "[👨‍💼 tech_lead]";

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
  // Jira issue requirements (summary + description) for reviewing against
  jiraRequirements?: string;
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

***REMOVED******REMOVED*** Your Capabilities

You have access to these tools:
- **bash**: Run shell commands including \`gh\` CLI for GitHub operations
- **read**: Read files from the repository
- **glob**: Find files by pattern
- **grep**: Search file contents

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

***REMOVED******REMOVED*** Feedback Guidelines

- **Be specific**: Point to exact lines/files when providing feedback
- **Be constructive**: Suggest alternatives, not just problems
- **Be balanced**: Acknowledge what's done well alongside improvements
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
    console.log(`${TECH_LEAD_PREFIX} ${message}`);

    try {
      await this.logsApi.post("/api/control-center/logs", {
        taskId: this.config.parentTaskId,
        type,
        message: `${TECH_LEAD_PREFIX} ${message}`,
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

      // Extract decision from output (uses LLM extraction if text parsing fails)
      const { decision, feedback, score: codeQualityScore } = await this.getDecision();

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
          console.error(`${TECH_LEAD_PREFIX} ${stderrText}`);
          this.postLog(stderrText, "error").catch(() => {});
        }
      });

      child.on("close", (code) => {
        // Report tokens from executor output for cost tracking
        // This mirrors Epic mode's token reporting for inline review
        const reportTokensFromOutput = () => {
          const inputTokensMatch = this.allOutput.match(/::input_tokens::(\d+)/);
          const outputTokensMatch = this.allOutput.match(/::output_tokens::(\d+)/);
          const inputToks = inputTokensMatch ? parseInt(inputTokensMatch[1], 10) : 0;
          const outputToks = outputTokensMatch ? parseInt(outputTokensMatch[1], 10) : 0;

          if (inputToks > 0 || outputToks > 0) {
            const usageUrl = `${this.config.apiBaseUrl}/api/tasks/${this.config.parentTaskId}/usage/partial`;
            axios.post(usageUrl, {
              inputTokens: inputToks,
              outputTokens: outputToks,
              cacheCreationTokens: 0,
              cacheReadTokens: 0,
              mode: "add", // Use additive mode for multi-expert
            }, {
              headers: {
                "Content-Type": "application/json",
                "x-api-key": this.config.orgApiKey,
              },
            }).then(() => {
              console.log(`${TECH_LEAD_PREFIX} Reported review tokens: input=${inputToks}, output=${outputToks}`);
            }).catch((err) => {
              console.warn(`${TECH_LEAD_PREFIX} Failed to report review tokens: ${err.message}`);
            });
          }
        };

        // Always report tokens (even on failure to capture partial work)
        reportTokensFromOutput();

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
      ? `***REMOVED******REMOVED*** Previous Review Feedback (Revision ${revisionCount}/3)
This is a revision attempt. The previous code was reviewed and these issues were identified:

${previousFeedback}

**Check if these issues have been addressed in the latest changes.**

---

`
      : "";

    // Build Jira requirements section
    const jiraSection = this.config.jiraRequirements
      ? `***REMOVED******REMOVED*** Jira Requirements

${this.config.jiraRequirements}

---

`
      : "";

    return `***REMOVED*** PR Code Review Task

${revisionSection}${jiraSection}***REMOVED******REMOVED*** Task Details
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
   * Parse the review decision from agent output (text-based).
   * Returns null if no clear decision found (triggers LLM extraction).
   */
  private parseDecisionFromText(): ReviewDecision | null {
    // Check for structured output marker first (AI SDK 6.0+ Output.object)
    // This is the most reliable format - guaranteed by the schema
    const structuredMatch = this.allOutput.match(/::review_decision::(approved|revision_needed|rejected)/i);
    if (structuredMatch) {
      console.log(`${TECH_LEAD_PREFIX} Found structured output marker`);
      return structuredMatch[1].toLowerCase() as ReviewDecision;
    }

    // Look for REVIEW_DECISION: marker (compatibility format)
    const decisionMatch = this.allOutput.match(/REVIEW_DECISION:\s*(approved|revision_needed|rejected)/i);
    if (decisionMatch) {
      return decisionMatch[1].toLowerCase() as ReviewDecision;
    }

    // Check for gh pr review command which is definitive
    if (/gh pr review.*--approve/.test(this.allOutput)) {
      console.log(`${TECH_LEAD_PREFIX} Detected --approve in gh pr review command`);
      return "approved";
    }
    if (/gh pr review.*--request-changes/.test(this.allOutput)) {
      console.log(`${TECH_LEAD_PREFIX} Detected --request-changes in gh pr review command`);
      return "revision_needed";
    }

    // No definitive marker found - will need LLM extraction
    return null;
  }

  /**
   * Extract review decision using a quick LLM call.
   * Uses Anthropic Haiku for fast, cheap extraction regardless of the main provider.
   */
  private async extractDecisionWithLLM(): Promise<{ decision: ReviewDecision; feedback: string; score: number }> {
    console.log(`${TECH_LEAD_PREFIX} Using LLM extraction for review decision (no clear marker found)`);

    // Use Anthropic SDK for extraction - always available and cheap
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: this.config.anthropicApiKey });

    // Truncate output to last 8000 chars to fit in context and focus on conclusion
    const truncatedOutput = this.allOutput.length > 8000
      ? "...[truncated]...\n" + this.allOutput.slice(-8000)
      : this.allOutput;

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
${truncatedOutput}

Respond with ONLY a JSON object (no markdown, no explanation):
{"decision": "approved|revision_needed|rejected", "feedback": "brief summary", "score": 1-10}`;

    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514", // Fast, cheap model for extraction
        max_tokens: 256,
        messages: [{ role: "user", content: extractionPrompt }],
      });

      const text = response.content[0].type === "text" ? response.content[0].text : "";
      console.log(`${TECH_LEAD_PREFIX} LLM extraction response:`, text);

      // Parse JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const decision = (parsed.decision || "revision_needed").toLowerCase() as ReviewDecision;
        const feedback = parsed.feedback || "No feedback extracted";
        const score = Math.min(10, Math.max(1, parseInt(parsed.score, 10) || 5));

        console.log(`${TECH_LEAD_PREFIX} LLM extracted: decision=${decision}, score=${score}`);
        return { decision, feedback, score };
      }
    } catch (error) {
      console.error(`${TECH_LEAD_PREFIX} LLM extraction failed:`, error);
    }

    // Ultimate fallback
    return { decision: "revision_needed", feedback: "Could not extract feedback", score: 5 };
  }

  /**
   * Get the final review decision, using LLM extraction if needed.
   */
  private async getDecision(): Promise<{ decision: ReviewDecision; feedback: string; score: number }> {
    // Try text parsing first
    const textDecision = this.parseDecisionFromText();

    if (textDecision) {
      // Text parsing succeeded - use it with other parsed values
      return {
        decision: textDecision,
        feedback: this.parseFeedback(),
        score: this.parseCodeQualityScore(),
      };
    }

    // Text parsing failed - use LLM extraction
    return this.extractDecisionWithLLM();
  }

  /**
   * Parse feedback from agent output.
   */
  private parseFeedback(): string {
    // Check for structured output marker first (AI SDK 6.0+ Output.object)
    const structuredMatch = this.allOutput.match(/::feedback::(.+?)(?=\n|$)/i);
    if (structuredMatch) {
      return structuredMatch[1].trim();
    }

    // Look for FEEDBACK: marker (compatibility format)
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
    // Check for structured output marker first (AI SDK 6.0+ Output.object)
    const structuredMatch = this.allOutput.match(/::code_quality_score::(\d+)/i);
    if (structuredMatch) {
      const score = parseInt(structuredMatch[1], 10);
      return Math.min(10, Math.max(1, score));
    }

    // Look for CODE_QUALITY_SCORE: marker (compatibility format)
    const scoreMatch = this.allOutput.match(/CODE_QUALITY_SCORE:\s*(\d+)/i);
    if (scoreMatch) {
      const score = parseInt(scoreMatch[1], 10);
      return Math.min(10, Math.max(0, score)); // Clamp to 0-10
    }
    return 5; // Default middle score
  }
}
