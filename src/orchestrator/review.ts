/**
 * Review-related functions extracted from orchestrator.ts.
 *
 * Handles Tech Lead review parsing, must-fix item management,
 * and the standalone /review flow.
 */

import { streamText, stepCountIs, type ToolSet } from "ai";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { createModel, buildOllamaOptions } from "../engine/model-factory.js";
import { createToolDefinitions } from "../engine/tools/index.js";
import type { AIProvider } from "../engine/types.js";
import { loadPersona } from "../personas.js";
import { formatProjectInstructions } from "../instructions.js";
import * as logger from "../logger.js";
import { CostTracker } from "../cost-tracker.js";
import type { CliConfig } from "../config.js";
import { getProviderForPersona } from "../config.js";
import { getDiffForReview } from "../git-ops.js";

import type {
  OrchestrationOutput,
  StandaloneReviewResult,
  ReviewMustFixItem,
} from "./types.js";

import {
  getReviewWallTimeoutMs,
  createTimedAbortSignal,
  collectReviewStreamResult,
  getModelContext,
  formatContext,
  normalizeErrorSignature,
  parseMarkerValue,
  isTransientError,
  buildReasoningOptions,
} from "./utils.js";


// ---------------------------------------------------------------------------
// Internal type used by runStandaloneReview for tool wrapping
// ---------------------------------------------------------------------------
type AnyToolDef = any;


// ---------------------------------------------------------------------------
// Must-fix item helpers
// ---------------------------------------------------------------------------

export function summarizeMustFixItem(text: string): string {
  const feedback = extractDetailedReviewText(text) || parseMarkerValue(text, "FEEDBACK") || text;
  const firstLine = feedback.split("\n").map((line) => line.trim()).find(Boolean);
  return firstLine || "Reviewer requested additional changes.";
}

export function extractStructuredMustFixItems(
  reviewText: string,
  affected: { stories: number[]; reasons: Record<number, string> } | null,
): ReviewMustFixItem[] {
  const blockingEvidence = parseMarkerValue(reviewText, "BLOCKING_EVIDENCE");
  const actionableFix = parseMarkerValue(reviewText, "ACTIONABLE_FIX");
  const baseSummary = summarizeMustFixItem(reviewText);

  if (affected && affected.stories.length > 0) {
    return affected.stories.map((storyNumber) => {
      const summary = affected.reasons[storyNumber] || baseSummary;
      const signature = normalizeErrorSignature([summary, blockingEvidence || "", actionableFix || "", String(storyNumber)].join("|"));
      return {
        id: `story-${storyNumber}-${signature.slice(0, 12)}`,
        storyNumber,
        summary,
        blockingEvidence,
        actionableFix,
        signature,
      };
    });
  }

  const signature = normalizeErrorSignature([baseSummary, blockingEvidence || "", actionableFix || ""].join("|"));
  return [{
    id: `review-${signature.slice(0, 12)}`,
    summary: baseSummary,
    blockingEvidence,
    actionableFix,
    signature,
  }];
}

export function mergeMustFixItems(
  previous: ReviewMustFixItem[],
  current: ReviewMustFixItem[],
): ReviewMustFixItem[] {
  const previousBySignature = new Map(previous.map((item) => [item.signature, item]));
  return current.map((item) => {
    const existing = previousBySignature.get(item.signature);
    return existing ? { ...existing, ...item } : item;
  });
}

export function formatMustFixItems(items: ReviewMustFixItem[]): string {
  if (items.length === 0) return "";
  return items.map((item) => {
    const parts = [`- [${item.id}] ${item.summary}`];
    if (item.blockingEvidence) parts.push(`  Evidence: ${item.blockingEvidence}`);
    if (item.actionableFix) parts.push(`  Fix: ${item.actionableFix}`);
    return parts.join("\n");
  }).join("\n");
}


// ---------------------------------------------------------------------------
// Review output parsing
// ---------------------------------------------------------------------------

export function parseRequiredReviewOutcome(text: string): {
  decision: "approved" | "revision_needed" | "rejected";
  score: number;
} {
  const decisionMatch = text.match(/REVIEW_DECISION:\s*(approved|revision_needed|rejected)/i);
  if (!decisionMatch) {
    const preview = text.replace(/\s+/g, " ").slice(0, 240);
    throw new Error(
      `Tech Lead output missing required marker: REVIEW_DECISION. ` +
      `Output preview: "${preview}${text.length > 240 ? "..." : ""}"`,
    );
  }

  const cqsMatches = [...text.matchAll(/CODE_QUALITY_SCORE:\s*(\d+)/gi)];
  if (cqsMatches.length === 0) {
    const preview = text.replace(/\s+/g, " ").slice(0, 240);
    throw new Error(
      `Tech Lead output missing required marker: CODE_QUALITY_SCORE. ` +
      `Output preview: "${preview}${text.length > 240 ? "..." : ""}"`,
    );
  }

  const rawScore = parseInt(cqsMatches[cqsMatches.length - 1][1], 10);
  const score = Math.max(1, Math.min(10, rawScore));
  const decision = decisionMatch[1].toLowerCase() as "approved" | "revision_needed" | "rejected";
  return { decision, score };
}

export function extractReviewFeedback(
  text: string,
  decision: "approved" | "revision_needed" | "rejected",
): string {
  const detailedReview = extractDetailedReviewText(text);
  const feedbackMatch = text.match(/FEEDBACK:\s*([\s\S]*?)(?=AFFECTED_|REVIEW_DECISION|CODE_QUALITY|```|$)/i);
  const feedbackSummary = feedbackMatch ? feedbackMatch[1].trim() : "";
  const feedback = detailedReview || feedbackSummary;
  if ((decision === "revision_needed" || decision === "rejected") && !feedback) {
    const preview = text.replace(/\s+/g, " ").slice(0, 240);
    throw new Error(
      `Tech Lead output missing required feedback context for ${decision}. ` +
      `Output preview: "${preview}${text.length > 240 ? "..." : ""}"`,
    );
  }
  return feedback;
}

export function validateTechLeadReviewOutput(
  text: string,
  approvalThreshold: number = 9,
): {
  decision: "approved" | "revision_needed" | "rejected";
  score: number;
  approved: boolean;
  feedback: string;
} {
  const parsed = parseRequiredReviewOutcome(text);
  const approved = parsed.score >= approvalThreshold;
  const decision = approved ? "approved" : parsed.decision;
  const feedback = extractReviewFeedback(text, parsed.decision);
  return { decision, score: parsed.score, approved, feedback };
}


// ---------------------------------------------------------------------------
// Affected stories parsing
// ---------------------------------------------------------------------------

/**
 * Parse AFFECTED_STORIES from reviewer output for selective revision.
 * Copied from worker/epic/inline-reviewer.ts parseAffectedStories().
 */
export function parseAffectedStories(text: string): { stories: number[]; reasons: Record<number, string> } | null {
  const storiesMatch = text.match(/AFFECTED_STORIES:\s*\[([^\]]+)\]/i);
  if (!storiesMatch) return null;

  const stories = storiesMatch[1]
    .split(",")
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n));

  if (stories.length === 0) return null;

  let reasons: Record<number, string> = {};
  const reasonsMatch = text.match(/AFFECTED_REASONS:\s*(\{[\s\S]*?\})/i);
  if (reasonsMatch) {
    try {
      const parsed = JSON.parse(reasonsMatch[1]);
      for (const [key, value] of Object.entries(parsed)) {
        const storyIndex = parseInt(key, 10);
        if (!isNaN(storyIndex) && typeof value === "string") {
          reasons[storyIndex] = value;
        }
      }
    } catch {
      // Reasons JSON is malformed -- non-critical, continue without reasons
    }
  }

  return { stories, reasons };
}

export function sanitizeAffectedStories(
  affected: { stories: number[]; reasons: Record<number, string> } | null,
  storyCount: number,
): { stories: number[]; reasons: Record<number, string> } | null {
  if (!affected) return null;

  const stories = affected.stories.filter(n => n >= 1 && n <= storyCount);
  if (stories.length === 0) return null;

  const reasons: Record<number, string> = {};
  for (const [key, value] of Object.entries(affected.reasons)) {
    const n = parseInt(key, 10);
    if (n >= 1 && n <= storyCount && typeof value === "string") {
      reasons[n] = value;
    }
  }

  return { stories, reasons };
}


// ---------------------------------------------------------------------------
// Review text extraction helpers
// ---------------------------------------------------------------------------

export function extractDetailedReviewText(reviewText: string): string {
  const markerIdx = reviewText.search(/REVIEW_DECISION:|CODE_QUALITY_SCORE:/i);
  return markerIdx > 0 ? reviewText.slice(0, markerIdx).trim() : "";
}

export function buildReviewBlockerSignature(
  reviewText: string,
  affected: { stories: number[]; reasons: Record<number, string> } | null,
): string {
  if (affected && affected.stories.length > 0) {
    const parts = affected.stories
      .slice()
      .sort((a, b) => a - b)
      .map((n) => {
        const reason = affected.reasons[n] || "";
        return `${n}:${normalizeErrorSignature(reason || `story ${n}`)}`;
      });
    return parts.join("|");
  }

  const detail = extractDetailedReviewText(reviewText);
  const feedbackMatch = reviewText.match(/FEEDBACK:\s*([\s\S]*?)(?=AFFECTED_|```|$)/i);
  const feedback = feedbackMatch ? feedbackMatch[1].trim() : "";
  const fallback = detail || feedback || reviewText;
  return normalizeErrorSignature(fallback);
}


// ---------------------------------------------------------------------------
// Standalone /review flow
// ---------------------------------------------------------------------------

/**
 * Run a standalone Tech Lead review against the current branch or uncommitted changes.
 * Uses the same model, prompt, and scoring as the orchestrator review loop.
 */
export async function runStandaloneReview(
  config: CliConfig,
  output: OrchestrationOutput,
  target?: string,
  abortSignal?: AbortSignal,
): Promise<StandaloneReviewResult | null> {
  const reviewer = loadPersona("tech_lead");
  if (!reviewer) {
    output.error("Tech Lead persona not found.");
    return null;
  }

  const workingDir = process.cwd();
  const { provider: revProvider, model: revModel, apiKey: revApiKey, host: revHost, contextLength: revCtx } = getProviderForPersona(config, "tech_lead");

  // Set API key
  if (revApiKey) {
    const envMap: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_GENERATIVE_AI_API_KEY" };
    const envVar = envMap[revProvider];
    const key = revApiKey.startsWith("{env:") ? process.env[revApiKey.slice(5, -1)] : revApiKey;
    if (envVar && key && !process.env[envVar]) process.env[envVar] = key;
  }

  output.coordinatorLog(`Starting Tech Lead review (${revProvider}/${revModel})...`);
  output.log("tech_lead", `Reviewing with \x1b[35m${revProvider}/${revModel}\x1b[0m (${formatContext(getModelContext(revModel, revCtx))} context)`);
  output.status("Reviewer -- Checking code quality");

  const sandboxed = config.sandbox ?? true;
  const reviewModel = createModel(revProvider as AIProvider, revModel, revHost, revCtx, revApiKey);
  const reviewTools = createToolDefinitions(workingDir, reviewModel, sandboxed);

  // Build reviewer tools -- emit structured tool calls so standalone /review
  // updates the status bar tool counters in real time.
  const reviewerTools: Record<string, AnyToolDef> = {};
  for (const toolName of reviewer.tools) {
    const toolDef = reviewTools[toolName as keyof typeof reviewTools] as AnyToolDef;
    if (toolDef) {
      reviewerTools[toolName] = {
        ...toolDef,
        execute: async (input: Record<string, unknown>) => {
          output.toolCall("tech_lead", toolName, input);
          const result = await toolDef.execute(input);
          return result;
        },
      };
    }
  }

  // Get the diff based on target
  let codeDiff = "";
  const normalizedTarget = (target || "branch").toLowerCase().trim();
  const prMatch = normalizedTarget.match(/^(?:pr)?#?(\d+)$/i);

  if (prMatch) {
    // PR review -- fetch diff via gh CLI
    const prNumber = prMatch[1];
    try {
      const prDiff = execSync(`gh pr diff ${prNumber}`, {
        cwd: workingDir, encoding: "utf-8", stdio: "pipe", timeout: 30_000,
      }).trim();
      codeDiff += `## PR #${prNumber}\n\n${prDiff}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      output.error(`Failed to fetch PR #${prNumber}: ${msg}`);
      output.statusDone();
      return null;
    }
  } else if (normalizedTarget === "diff") {
    // Uncommitted changes only
    try {
      const stat = execSync("git diff --stat HEAD 2>/dev/null || git diff --stat 2>/dev/null", {
        cwd: workingDir, encoding: "utf-8", stdio: "pipe",
      }).trim();
      const diff = execSync("git diff HEAD 2>/dev/null || git diff 2>/dev/null", {
        cwd: workingDir, encoding: "utf-8", stdio: "pipe",
      }).trim();
      if (stat) codeDiff += `## Uncommitted Changes\n${stat}\n\n`;
      if (diff) codeDiff += diff;
    } catch { /* not a git repo */ }
  } else {
    // "branch" or anything else -- diff current branch vs main
    let mainBranch = "main";
    try {
      mainBranch = execSync("git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || echo refs/heads/main", {
        cwd: workingDir, encoding: "utf-8", stdio: "pipe",
      }).trim().replace(/^refs\/heads\/|^refs\/remotes\/origin\//g, "");
    } catch { /* default to main */ }

    const { stat, diff } = getDiffForReview(workingDir, mainBranch);
    if (stat) codeDiff += `## Branch Diff (${mainBranch}..HEAD)\n${stat}\n\n`;
    if (diff) codeDiff += diff;
  }

  if (!codeDiff.trim()) {
    output.error("No changes to review.");
    output.statusDone();
    return null;
  }

  // Cap diff to fit within context window.
  // Conservative: ~3 chars/token for code, 50% budget for diff (rest is system prompt, tools, instructions).
  const revContextWindow = getModelContext(revModel, revCtx);
  const maxDiffChars = Math.floor(revContextWindow * 3 * 0.5);
  if (codeDiff.length > maxDiffChars) {
    const diffFile = path.join(workingDir, ".workermill-review-diff.tmp");
    try { fs.writeFileSync(diffFile, codeDiff, "utf-8"); } catch { /* best effort */ }
    const stat = codeDiff.match(/## (?:Branch Diff|Uncommitted|PR).*?\n([\s\S]*?)\n\n/)?.[1] || "";
    codeDiff = codeDiff.slice(0, maxDiffChars) +
      `\n\n... (diff truncated to fit ${formatContext(revContextWindow)} context window)\n\n` +
      `**Full diff saved to:** \`${diffFile}\` — use \`read_file ${diffFile}\` to review the complete diff.\n\n` +
      `${stat ? `File list:\n${stat}` : ""}`;
  }

  const reviewerProjectInstructions = formatProjectInstructions(workingDir);
  const reviewPrompt = `${reviewerProjectInstructions ? `${reviewerProjectInstructions}\n\n` : ""}## Code Changes

The diff below shows what was changed. Use your read_file tool to inspect specific files in detail.

${codeDiff || "(no code changes detected)"}

## Review Instructions

Review the code changes above for quality, correctness, and security.

### APPROVE when:
- Code correctly implements the requirements
- No obvious bugs or security issues
- Code follows existing patterns in the codebase
- Appropriate error handling is in place
- Minor cosmetic issues are NOT grounds for revision

### REVISION_NEEDED when:
- Code has functional bugs that affect correctness
- Security vulnerabilities that must be fixed
- Missing required functionality
- Broken imports, missing dependencies, or code that won't run

### REJECT when:
- Fundamental approach is wrong and cannot be fixed with revisions
- Security vulnerability that requires different architecture

**Be fair**: Approve code that works and has no functional bugs or security issues. Request revision for real problems only.

## Output Format

\`\`\`
REVIEW_DECISION: approved
\`\`\`
OR
\`\`\`
REVIEW_DECISION: revision_needed
\`\`\`

Then add:
\`\`\`
CODE_QUALITY_SCORE: ${config.review?.approvalThreshold ?? 9}
FEEDBACK: Your detailed feedback explaining what's good and what needs fixing
\`\`\`

**Score guide (1-10):** 1-3 = fundamentally broken, 4-5 = major issues, 6 = functional but rough, 7 = solid with minor issues, ${config.review?.approvalThreshold ?? 9}+ = quality-gate pass. Use the score with your evidence: below ${config.review?.approvalThreshold ?? 9} means you found real blocking issues; ${config.review?.approvalThreshold ?? 9}+ means no blocking issues remain.`;

  // Stream the review -- use onStepFinish to capture text between tool calls
  // This matches the orchestrator's review pattern exactly.
  let reviewerOutput = "";
  let reviewerFinalText = "";
  let reviewText = "";
  const reviewStartMs = Date.now();
  try {
    const reviewTimeoutMs = getReviewWallTimeoutMs();
    const maxReviewAttempts = 2;
    let reviewUsage: { inputTokens?: number; outputTokens?: number } | undefined;
    let lastReviewError: unknown;
    for (let attempt = 1; attempt <= maxReviewAttempts; attempt++) {
      const timedAbort = createTimedAbortSignal(abortSignal, reviewTimeoutMs, "Tech Lead review");
      try {
        const reviewStream = streamText({
          model: reviewModel,
          abortSignal: timedAbort.signal,
          system: reviewer.systemPrompt,
          prompt: reviewPrompt,
          tools: reviewerTools as ToolSet,
          stopWhen: stepCountIs(100),
          timeout: { chunkMs: 120_000 },
          ...buildOllamaOptions(revProvider as AIProvider, revCtx),
          ...buildReasoningOptions(revProvider, revModel),
          onStepFinish({ text }) {
            if (text) {
              reviewerOutput += text + "\n";
              const lines = text.split("\n").filter((l: string) => l.trim());
              for (const line of lines) {
                if (line.includes("::review_score::") || line.includes("::review_verdict::") || line.includes("::code_quality_score::")) continue;
                output.log("tech_lead", line);
              }
            }
            output.status("tech_lead: reviewing...");
          },
        });
        const result = await collectReviewStreamResult(
          reviewStream,
          reviewTimeoutMs,
          timedAbort,
          "Tech Lead review",
        );
        reviewerFinalText = result.finalText;
        reviewUsage = result.usage;
        lastReviewError = undefined;
        break;
      } catch (err) {
        lastReviewError = err;
        const transient = isTransientError(err);
        const canRetry = attempt < maxReviewAttempts && (timedAbort.didTimeout() || transient);
        if (!canRetry) throw err;
        output.coordinatorLog("Tech Lead review stalled; retrying once...");
        logger.warn("Retrying standalone tech lead review", {
          attempt,
          provider: revProvider,
          model: revModel,
          reason: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      } finally {
        timedAbort.dispose();
      }
    }
    if (lastReviewError) throw lastReviewError;
    const stepText = reviewerOutput.trim();
    reviewText = reviewerFinalText.length > stepText.length
      ? reviewerFinalText
      : (stepText || reviewerFinalText);
    // Track cost
    const revInputTokens = reviewUsage?.inputTokens || 0;
    const revOutputTokens = reviewUsage?.outputTokens || 0;
    const costTracker = new CostTracker();
    costTracker.addUsage("Tech Lead Review", revProvider, revModel, revInputTokens, revOutputTokens);
    output.updateCost?.(costTracker.getTotalCost());
    output.updateUsageSummary?.(costTracker.getUsageSummary());
    // Track tok/s for reviewer model
    const reviewElapsed = (Date.now() - reviewStartMs) / 1000;
    if (revOutputTokens > 0 && reviewElapsed > 0) {
      const reviewTokPerSec = Math.round(revOutputTokens / reviewElapsed);
      output.updateTokPerSec?.(`${revProvider}/${revModel}`, reviewTokPerSec);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Standalone review failed", {
      provider: revProvider,
      model: revModel,
      error: msg,
      stack: err instanceof Error ? err.stack : undefined,
      reviewerOutputLength: reviewerOutput.length,
      reviewerFinalTextLength: reviewerFinalText.length,
    });
    output.error(`Review failed: ${msg}`);
    output.statusDone();
    return null;
  }

  output.statusDone();

  // Parse results -- same logic as orchestrator
  const parsedReview = parseRequiredReviewOutcome(reviewText);
  const score = parsedReview.score;
  const threshold = config.review?.approvalThreshold ?? 9;
  const approved = score >= threshold;
  const decision = approved ? "approved" : parsedReview.decision;

  // Display structured result
  output.log("tech_lead", "\u2500".repeat(60));
  output.log("tech_lead", `::code_quality_score::${score}/10`);
  output.log("tech_lead", `::review_decision::${decision}`);
  output.log("tech_lead", "\u2500".repeat(60));
  const feedback = extractReviewFeedback(reviewText, parsedReview.decision);
  if (feedback) {
    output.log("tech_lead", "Fix context:");
    for (const line of feedback.split("\n").map((l) => l.trim()).filter(Boolean)) {
      output.log("tech_lead", line);
    }
  }
  output.coordinatorLog(approved ? `Review approved (${score}/10)` : `Review needs revision (${score}/10)`);

  // Clean up temp file
  try { fs.unlinkSync(path.join(workingDir, ".workermill-review-diff.tmp")); } catch { /* may not exist */ }

  return { score, decision, feedback, reviewText };
}
