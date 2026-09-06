/**
 * Review-related functions extracted from orchestrator.ts.
 *
 * Handles Tech Lead review parsing, must-fix item management,
 * and the standalone /review flow.
 */

import { streamText, stepCountIs, type ToolSet } from "ai";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { execSync } from "child_process";
import { createModel, buildOllamaOptions } from "../engine/model-factory.js";
import { createToolDefinitions } from "../engine/tools/index.js";
import { createPathScope } from "../engine/path-policy.js";
import { executeToolCall, type ToolExecutionContext } from "../engine/tool-executor.js";
import type { AIProvider } from "../engine/types.js";
import { loadPersona } from "../personas.js";
import { formatProjectInstructions } from "../instructions.js";
import { formatPromptProjectContext } from "../project-context.js";
import * as logger from "../logger.js";
import { CostTracker } from "../cost-tracker.js";
import type { CliConfig } from "../config.js";
import { getProviderForPersona, loadConfig, saveConfig, loadLocalSettings, saveLocalSettings } from "../config.js";
import { getApiKeyEnvVar } from "../provider-capabilities.js";
import { getDiffForReview, getDiffSinceCommit, getHeadHash, captureStoryPriorWork, commitRevisionChanges } from "../git-ops.js";
import { runHooks, runLifecycleHooks, runPreHooksWithBlocking } from "../hooks.js";
import { checkpoint } from "../checkpoints.js";
import { durablePermissionRules } from "../safety.js";
import { resolveSandboxMode } from "../sandbox-mode.js";

import type {
  OrchestrationOutput,
  Story,
  SharedContext,
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
  isBalanceOrQuotaError,
  isRateLimitError,
  rateLimitSleep,
  truncateForPrompt,
  extractToolFilePath,
  buildReasoningOptions,
  emitReasoningDelta,
} from "./utils.js";

import { emitFailureCode, extractCheckpointTargets, formatToolCallDisplay } from "./execution.js";


// ---------------------------------------------------------------------------
// Internal type used by runStandaloneReview for tool wrapping
// ---------------------------------------------------------------------------
type AnyToolDef = any;

const reviewSessionPermissionRules = new WeakMap<Set<string>, string[]>();

function getReviewSessionPermissionRules(sessionAllow: Set<string>): readonly string[] {
  return reviewSessionPermissionRules.get(sessionAllow) ?? [];
}

async function recordReviewAlwaysPermission(
  sessionAllow: Set<string>,
  toolName: string,
  input: Record<string, unknown>,
): Promise<void> {
  const rules = durablePermissionRules(toolName, input);
  if (rules.length === 0) return;
  const current = reviewSessionPermissionRules.get(sessionAllow) ?? [];
  for (const rule of rules) if (!current.includes(rule)) current.push(rule);
  reviewSessionPermissionRules.set(sessionAllow, current);
  try {
    const settings = loadLocalSettings() || {};
    settings.allow = settings.allow || [];
    for (const rule of rules) if (!settings.allow.includes(rule)) settings.allow.push(rule);
    saveLocalSettings(settings);
  } catch { /* retain the narrowly-scoped session approval when persistence fails */ }
}

function createReviewTools(args: {
  persona: { tools: readonly string[] };
  role: string;
  model: unknown;
  config: CliConfig;
  output: OrchestrationOutput;
  workingDir: string;
  sandboxed: boolean | "os";
  signal: AbortSignal;
  runId: string;
  readOnlyRole: boolean;
  trustAll?: boolean | (() => boolean);
  sessionAllow?: Set<string>;
  onToolStatus?: (status: string) => void;
}): Record<string, AnyToolDef> {
  const sessionAllow = args.sessionAllow ?? new Set<string>();
  const scope = createPathScope(args.workingDir, args.config.sandboxCapabilities?.extraPathGrants);
  const executionContext: ToolExecutionContext = {
    runId: args.runId,
    workspace: scope.workspace,
    scope,
    effectiveSandbox: args.sandboxed === "os" ? "os" : args.sandboxed ? "path" : "none",
    signal: args.signal,
    getPermissionState: () => ({
      mode: "default",
      trustAll: args.readOnlyRole ? false : (typeof args.trustAll === "function" ? args.trustAll() : Boolean(args.trustAll)),
      sessionAllow,
      rules: {
        ...args.config.permissions,
        allow: [...(args.config.permissions?.allow ?? []), ...getReviewSessionPermissionRules(sessionAllow)],
      },
      // This must remain true for reviewers even when a persona claims bash,
      // child-agent, or write-tool access.
      readOnlyRole: args.readOnlyRole,
      workspace: scope.workspace,
    }),
    allowedNetworkDomains: args.config.sandboxCapabilities?.allowedNetworkDomains,
    allowLocalBinding: args.config.sandboxCapabilities?.allowLocalBinding,
    allowDockerSocket: args.config.sandboxCapabilities?.allowDockerSocket,
    prompt: args.readOnlyRole ? undefined : async (toolName, input, reason, executingContext) => {
      const result = await args.output.confirm(`Allow ${toolName}? ${formatToolCallDisplay(toolName, input)} (${reason})`);
      if (executingContext.signal.aborted) return false;
      if (typeof result === "object" && result.allowed) {
        if (result.mode === "trust") sessionAllow.add("*");
        if (result.mode === "always") await recordReviewAlwaysPermission(sessionAllow, toolName, input);
      }
      return Boolean(typeof result === "object" ? result.allowed : result) && !executingContext.signal.aborted;
    },
    preHook: (toolName, input, executingContext) => {
      args.output.toolCall(args.role, toolName, input);
      const hookResult = runPreHooksWithBlocking(toolName, args.config.hooks, executingContext.workspace, {
        input: JSON.stringify(input).substring(0, 10_000),
      });
      return hookResult.blocked ? { blocked: true, reason: hookResult.reason } : undefined;
    },
    checkpoint: (toolName, input, executingContext) => {
      for (const target of extractCheckpointTargets(toolName, input, executingContext.workspace)) checkpoint(target.path, target.tool);
    },
    postHook: (toolName, _input, _result, _error, executingContext) => {
      runHooks("post", toolName, args.config.hooks, executingContext.workspace);
    },
    event: (event) => {
      if (event.phase === "complete") args.onToolStatus?.("");
    },
  };
  const allTools = createToolDefinitions(args.workingDir, args.model as never, args.sandboxed, {
    executionContext,
    sandboxCapabilities: args.config.sandboxCapabilities,
  });
  const selected: Record<string, AnyToolDef> = {};
  for (const toolName of args.persona.tools) {
    const toolDef = allTools[toolName as keyof typeof allTools] as AnyToolDef;
    if (!toolDef || typeof toolDef.execute !== "function") continue;
    const original = toolDef.execute;
    selected[toolName] = {
      ...toolDef,
      execute: (input: Record<string, unknown>) => executeToolCall(toolName, input, () => original(input), executionContext),
    };
  }
  return selected;
}


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
  const preview = text.replace(/\s+/g, " ").slice(0, 240);
  const decisionMarkers = [...text.matchAll(/REVIEW_DECISION:\s*([^\s]+)/gi)].map((match) => match[1].toLowerCase());
  if (decisionMarkers.length === 0) {
    throw new Error(
      `Tech Lead output missing required marker: REVIEW_DECISION. ` +
      `Output preview: "${preview}${text.length > 240 ? "..." : ""}"`,
    );
  }
  if (decisionMarkers.some((marker) => marker !== "approved" && marker !== "revision_needed" && marker !== "rejected")) {
    throw new Error(`Tech Lead output has an invalid REVIEW_DECISION marker. Output preview: "${preview}${text.length > 240 ? "..." : ""}"`);
  }
  if (new Set(decisionMarkers).size !== 1) {
    throw new Error(`Tech Lead output has contradictory REVIEW_DECISION markers. Output preview: "${preview}${text.length > 240 ? "..." : ""}"`);
  }

  const scoreMarkers = [...text.matchAll(/CODE_QUALITY_SCORE:\s*([^\s]+)/gi)].map((match) => match[1]);
  if (scoreMarkers.length === 0) {
    throw new Error(
      `Tech Lead output missing required marker: CODE_QUALITY_SCORE. ` +
      `Output preview: "${preview}${text.length > 240 ? "..." : ""}"`,
    );
  }
  if (scoreMarkers.some((marker) => !/^\d+$/.test(marker))) {
    throw new Error(`Tech Lead output has an invalid CODE_QUALITY_SCORE marker. Output preview: "${preview}${text.length > 240 ? "..." : ""}"`);
  }
  if (new Set(scoreMarkers).size !== 1) {
    throw new Error(`Tech Lead output has contradictory CODE_QUALITY_SCORE markers. Output preview: "${preview}${text.length > 240 ? "..." : ""}"`);
  }
  const score = Number.parseInt(scoreMarkers[0], 10);
  if (score < 1 || score > 10) {
    throw new Error(`Tech Lead output has an out-of-range CODE_QUALITY_SCORE marker. Output preview: "${preview}${text.length > 240 ? "..." : ""}"`);
  }
  const decision = decisionMarkers[0] as "approved" | "revision_needed" | "rejected";
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
  const approved = parsed.decision === "approved" && parsed.score >= approvalThreshold;
  const decision = parsed.decision;
  const feedback = extractReviewFeedback(text, parsed.decision);
  return { decision, score: parsed.score, approved, feedback };
}

function isMissingRequiredReviewMarkerError(err: unknown): boolean {
  return err instanceof Error && (
    err.message.includes("Tech Lead output missing required marker: REVIEW_DECISION")
    || err.message.includes("Tech Lead output missing required marker: CODE_QUALITY_SCORE")
  );
}

function isInvalidReviewOutputError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("Tech Lead output ");
}

function isEmptyReviewOutputError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("Tech Lead review produced empty output");
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

function normalizeVisibleReviewText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function shouldPrintFeedbackFallback(feedback: string, visibleStreamedText: string): boolean {
  const normalizedFeedback = normalizeVisibleReviewText(feedback);
  if (!normalizedFeedback) return false;
  return !normalizeVisibleReviewText(visibleStreamedText).includes(normalizedFeedback);
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
  if (abortSignal?.aborted) {
    output.coordinatorLog("Review cancelled before startup.");
    output.statusDone();
    return null;
  }
  const reviewer = loadPersona("tech_lead");
  if (!reviewer) {
    output.error("Tech Lead persona not found.");
    return null;
  }

  const workingDir = process.cwd();
  const { provider: revProvider, model: revModel, apiKey: revApiKey, host: revHost, contextLength: revCtx } = getProviderForPersona(config, "tech_lead");

  // Set API key
  if (revApiKey) {
    const envVar = getApiKeyEnvVar(revProvider);
    const key = revApiKey.startsWith("{env:") ? process.env[revApiKey.slice(5, -1)] : revApiKey;
    if (envVar && key && !process.env[envVar]) process.env[envVar] = key;
  }

  output.coordinatorLog(`Starting Tech Lead review (${revProvider}/${revModel})...`);
  output.log("tech_lead", `Reviewing with \x1b[35m${revProvider}/${revModel}\x1b[0m (${formatContext(getModelContext(revModel, revCtx))} context)`);
  output.status("Reviewer -- Checking code quality");

  const requestedSandbox = config.sandbox ?? true;
  // An explicit OS request is resolved before creating a model or starting a
  // provider stream. It must never silently fall back to path mode here.
  const sandboxed = requestedSandbox === "os" ? resolveSandboxMode("os").effective : requestedSandbox;
  const reviewRunId = randomUUID();
  const reviewModel = createModel(revProvider as AIProvider, revModel, revHost, revCtx, revApiKey);

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

  const reviewerProjectInstructions = formatProjectInstructions(workingDir) + formatPromptProjectContext(workingDir);
  const reviewPrompt = `${reviewerProjectInstructions ? `${reviewerProjectInstructions}\n\n` : ""}## Code Changes

The diff below shows what was changed. Use your read_file tool to inspect specific files in detail.

${codeDiff || "(no code changes detected)"}

## Review Instructions

Review the code changes above for quality, correctness, and security.

### APPROVE when:
- Code correctly implements the requirements AND the reviewer has no substantive improvements to suggest
- Pure cosmetic issues (trailing whitespace, blank lines, import ordering) are NOT grounds for revision — mention them in feedback but still approve

### REVISION_NEEDED when:
- Code has functional bugs that affect correctness
- Security vulnerabilities that must be fixed
- Missing required functionality
- Broken imports, missing dependencies, or code that won't run
- Tests are weak or incomplete — e.g. a test that doesn't verify the behavior it claims to, or missing edge cases
- You identified a substantive improvement that strengthens correctness or prevents regressions

**IMPORTANT: If you mention an issue in your review, request the fix.** Do not label real issues as "non-blocking" and then approve. If it was worth writing about, it is worth fixing. The only exception is pure cosmetic preferences — those go in feedback as FYI only.

### REJECT when:
- Fundamental approach is wrong and cannot be fixed with revisions
- Security vulnerability that requires different architecture

**Quality gate stance**: Block for correctness, security, missing functionality, weak tests, and substantive improvements. Do NOT block for style or cosmetic preferences.

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
  let reviewerVisibleText = "";
  let reviewText = "";
  const reviewStartMs = Date.now();
  try {
    const reviewTimeoutMs = getReviewWallTimeoutMs();
    const maxReviewAttempts = 2;
    let reviewUsage: { inputTokens?: number; outputTokens?: number } | undefined;
    let lastReviewError: unknown;
    for (let attempt = 1; attempt <= maxReviewAttempts; attempt++) {
      if (abortSignal?.aborted) throw new Error("Tech Lead review cancelled");
      const timedAbort = createTimedAbortSignal(abortSignal, reviewTimeoutMs, "Tech Lead review");
      let attemptReviewerOutput = "";
      let attemptReviewerFinalText = "";
      let attemptReviewerVisibleText = "";
      try {
        const reviewerTools = createReviewTools({
          persona: reviewer,
          role: "tech_lead",
          model: reviewModel,
          config,
          output,
          workingDir,
          sandboxed,
          signal: timedAbort.signal,
          runId: `${reviewRunId}-standalone-${attempt}`,
          readOnlyRole: true,
        });
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
              attemptReviewerOutput += text + "\n";
              const lines = text.split("\n").filter((l: string) => l.trim());
              for (const line of lines) {
                if (line.includes("::review_score::") || line.includes("::review_verdict::") || line.includes("::code_quality_score::")) continue;
                attemptReviewerVisibleText += line + "\n";
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
        if (timedAbort.signal.aborted) throw new Error("Tech Lead review cancelled");
        attemptReviewerFinalText = result.finalText;
        const stepText = attemptReviewerOutput.trim();
        const candidateReviewText = attemptReviewerFinalText.length > stepText.length
          ? attemptReviewerFinalText
          : (stepText || attemptReviewerFinalText);
        if (!candidateReviewText.trim()) {
          throw new Error("Tech Lead review produced empty output.");
        }
        parseRequiredReviewOutcome(candidateReviewText);
        reviewerOutput = attemptReviewerOutput;
        reviewerFinalText = attemptReviewerFinalText;
        reviewerVisibleText = attemptReviewerVisibleText;
        reviewText = candidateReviewText;
        reviewUsage = result.usage;
        lastReviewError = undefined;
        break;
      } catch (err) {
        lastReviewError = err;
        const transient = isTransientError(err);
        const rl = isRateLimitError(err);
        const canRetry = !abortSignal?.aborted && attempt < maxReviewAttempts && (
          timedAbort.didTimeout()
          || transient
          || rl
          || isMissingRequiredReviewMarkerError(err)
          || isEmptyReviewOutputError(err)
        );
        if (!canRetry) throw err;
        const retryMessage = rl
          ? `Tech Lead review rate limited; retrying once in ${Math.ceil(rl.retryAfterMs / 1000)}s...`
          : "Tech Lead review stalled or returned incomplete output; retrying once...";
        output.coordinatorLog(retryMessage);
        if (rl) await rateLimitSleep(rl.retryAfterMs);
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
  const threshold = config.review?.approvalThreshold ?? 9;
  const interpretedReview = validateTechLeadReviewOutput(reviewText, threshold);
  const { score, approved, decision, feedback } = interpretedReview;

  // Display structured result
  output.log("tech_lead", "\u2500".repeat(60));
  output.log("tech_lead", `::code_quality_score::${score}/10`);
  output.log("tech_lead", `::review_decision::${decision}`);
  output.log("tech_lead", "\u2500".repeat(60));
  if (shouldPrintFeedbackFallback(feedback, reviewerVisibleText)) {
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


// ---------------------------------------------------------------------------
// Review loop result — returned by runReviewLoop
// ---------------------------------------------------------------------------

export interface ReviewLoopResult {
  /** The review text from the approved review (empty if not approved). */
  finalReviewText: string;
  /** True when the loop was interrupted by pause/cancel and the caller should return early. */
  aborted: boolean;
  /** Typed result for completion policy; callers must not infer approval from review prose. */
  outcome: ReviewOutcome;
}

export type ReviewOutcomeKind =
  | "approved"
  | "disabled"
  | "revision_needed"
  | "rejected"
  | "revision_exhausted"
  | "revision_declined"
  | "parse_failed"
  | "provider_failed"
  | "timed_out"
  | "cancelled"
  | "unavailable";

export interface ReviewOutcome {
  kind: ReviewOutcomeKind;
  approved: boolean;
  decision?: "approved" | "revision_needed" | "rejected";
  score?: number;
  feedback?: string;
  error?: string;
}

/** Interpret valid reviewer markers without allowing a score to override its decision. */
export function interpretTechLeadReviewOutput(text: string, approvalThreshold = 9): ReviewOutcome {
  const { decision, score, approved, feedback } = validateTechLeadReviewOutput(text, approvalThreshold);
  return {
    kind: approved ? "approved" : decision === "approved" ? "revision_needed" : decision,
    approved,
    decision,
    score,
    feedback,
  };
}

function reviewOutcomeFromError(error: unknown, timedOut = false, cancelled = false): ReviewOutcome {
  const message = error instanceof Error ? error.message : String(error);
  if (cancelled || /cancelled/i.test(message)) return { kind: "cancelled", approved: false, error: message };
  if (timedOut || /timed out|timeout/i.test(message)) return { kind: "timed_out", approved: false, error: message };
  if (isMissingRequiredReviewMarkerError(error) || isInvalidReviewOutputError(error) || isEmptyReviewOutputError(error)) {
    return { kind: "parse_failed", approved: false, error: message };
  }
  return { kind: "provider_failed", approved: false, error: message };
}


// ---------------------------------------------------------------------------
// Review loop parameters
// ---------------------------------------------------------------------------

export interface ReviewLoopParams {
  config: CliConfig;
  output: OrchestrationOutput;
  sorted: Story[];
  context: SharedContext;
  userTask: string;
  featureBranch: string | null;
  mainBranch: string;
  workingDir: string;
  costTracker: CostTracker;
  abortSignal: AbortSignal | undefined;
  trustAll: boolean | (() => boolean);
  sandboxed: boolean | "os";
  sessionAllow: Set<string>;
  liveViewServer?: import("../live-view-server.js").LiveViewServer;
  ticketOps: { postComment(body: string): Promise<void> } | null;
  gateResultsSection: string;
  waitWhilePaused: () => Promise<boolean>;
  pauseForBalanceIssue: (scope: string) => Promise<boolean>;
  logRetryHint: () => void;
}


// ---------------------------------------------------------------------------
// runReviewLoop — extracted inline review + revision loop from orchestrator
// ---------------------------------------------------------------------------

export async function runReviewLoop(params: ReviewLoopParams): Promise<ReviewLoopResult> {
  const {
    config, output, sorted, context, userTask,
    featureBranch, mainBranch, workingDir,
    costTracker, abortSignal, trustAll, sandboxed, sessionAllow,
    liveViewServer, ticketOps, gateResultsSection,
    waitWhilePaused, pauseForBalanceIssue, logRetryHint,
  } = params;

  // Review config
  const reviewEnabled = config.review?.enabled !== false; // default: true
  const maxRevisions = config.review?.maxRevisions ?? 3;
  let autoRevise = config.review?.autoRevise ?? false;
  let outcome: ReviewOutcome = reviewEnabled
    ? { kind: "unavailable", approved: false, error: "Tech Lead reviewer is unavailable." }
    : { kind: "disabled", approved: false };

  // Run inline review with revision loop
  let finalReviewText = ""; // Captures the approved review for use in PR body
  const reviewer = reviewEnabled ? loadPersona("tech_lead") : null;
  if (reviewer) {
    if (abortSignal?.aborted) {
      output.coordinatorLog("Build cancelled.");
      logRetryHint();
      return { finalReviewText: "", aborted: true, outcome: { kind: "cancelled", approved: false } };
    }
    const { provider: revProvider, model: revModel, apiKey: revApiKey, host: revHost, contextLength: revCtx } = getProviderForPersona(
      config,
      "tech_lead"
    );

    if (revApiKey) {
      const envVar = getApiKeyEnvVar(revProvider);
      const key = revApiKey.startsWith("{env:") ? process.env[revApiKey.slice(5, -1)] : revApiKey;
      if (envVar && key && !process.env[envVar]) process.env[envVar] = key;
    }

    // Fail an explicit OS request before the provider is initialized.
    const effectiveSandbox = sandboxed === "os" ? resolveSandboxMode("os").effective : sandboxed;
    const reviewRunId = randomUUID();
    const reviewModel = createModel(revProvider as AIProvider, revModel, revHost, revCtx, revApiKey);

    let previousReviewFeedback = "";
    let openMustFixItems: ReviewMustFixItem[] = [];
    let lastBlockerSignature = "";
    let repeatedBlockerCount = 0;
    logger.info("Starting review loop", { maxRevisions, provider: revProvider, model: revModel });
    let preRevisionHash = ""; // Tracks HEAD before each revision — so reviewer sees only what changed
    for (let reviewRound = 1; reviewRound <= maxRevisions; reviewRound++) {
      if (abortSignal?.aborted) {
        output.coordinatorLog("Build cancelled.");
        logRetryHint();
        return { finalReviewText: "", aborted: true, outcome: { kind: "cancelled", approved: false } };
      }
      if (await waitWhilePaused()) {
        return { finalReviewText: "", aborted: true, outcome: { kind: "cancelled", approved: false, error: "Review paused or cancelled." } };
      }
      const isRevision = reviewRound > 1;
      logger.info(`Review round ${reviewRound}`, { isRevision, maxRevisions });
      output.coordinatorLog(isRevision ? `Starting Tech Lead review (revision ${reviewRound - 1}/${maxRevisions - 1}, ${revProvider}/${revModel})...` : `Starting Tech Lead review (${revProvider}/${revModel})...`);
      output.log("tech_lead", `Reviewing with \x1b[35m${revProvider}/${revModel}\x1b[0m (${formatContext(getModelContext(revModel, revCtx))} context)`);

      output.status(isRevision ? "Reviewer -- Re-checking after revisions" : "Reviewer -- Checking code quality");

      let lastReviewFailure: ReviewOutcome | undefined;
      try {
        // Build review prompt with full context — matches WorkerMill's inline-reviewer.ts buildReviewPrompt()
        const mustFixSection = isRevision && openMustFixItems.length > 0
          ? `## Open Must-Fix Items
These blockers are still active until the next review clears them:

${formatMustFixItems(openMustFixItems)}

---

`
          : "";
        const previousFeedbackSection = isRevision && previousReviewFeedback
          ? `${mustFixSection}## Previous Review Feedback (Round ${reviewRound})
This is a revision attempt. The previous code was reviewed and these issues were identified:

${truncateForPrompt(previousReviewFeedback, 6_000, "previous review feedback")}

**Evaluate whether the revision addressed the issues you raised.**
- If your major issues were fixed, approve — even if minor items remain
- If a cosmetic or minor issue persists after being flagged, note it in feedback but don't block on it again
- If a functional bug, security issue, or missing requirement persists, you MUST block on it again — these are real problems regardless of how many times they've been flagged
- If the revision introduced NEW bugs, request another revision for those specific issues
- Score honestly based on current code quality, not relative to last round

---

`
          : "";

        const storyPlanDetails = sorted.map((s, idx) => {
          const parts = [`### Story ${idx + 1}: ${s.title} (${s.persona})`];
          parts.push(s.description);
          if (s.targetFiles?.length) parts.push(`**Target files:** ${s.targetFiles.join(", ")}`);
          if (s.referenceFiles?.length) parts.push(`**Reference patterns:** ${s.referenceFiles.join(", ")}`);
          if (s.implementationNotes) parts.push(`**Guidance:** ${s.implementationNotes}`);
          return parts.join("\n");
        }).join("\n\n");

        // Get clean diff from feature branch vs main — matches worker's consolidated PR diff.
        // On revision rounds, ALSO show what changed since the last review so the reviewer
        // can see progress instead of re-evaluating everything from scratch.
        let codeDiff = "";
        if (featureBranch) {
          if (isRevision && preRevisionHash) {
            // Revision rounds: send ONLY what changed since last review.
            // The reviewer already saw the full diff — sending it again wastes context
            // and risks exceeding the model's context window on later rounds.
            const revisionDelta = getDiffSinceCommit(workingDir, preRevisionHash);
            if (revisionDelta) {
              codeDiff += `## What Changed Since Last Review\n\nThis diff shows ONLY what the revision workers changed. Use read_file to inspect any file in full.\n\n${revisionDelta}`;
            } else {
              codeDiff += "(no changes detected since last review)";
            }
          } else {
            // First review: send the full branch diff
            const { stat, diff } = getDiffForReview(workingDir, mainBranch);
            if (stat) codeDiff += `## Branch Diff (${mainBranch}..HEAD)\n${stat}\n\n`;
            if (diff) codeDiff += diff;
          }
        } else {
          // Fallback: uncommitted changes diff
          try {
            const stat = execSync("git diff --stat HEAD 2>/dev/null || git diff --stat 2>/dev/null", {
              cwd: workingDir, encoding: "utf-8", stdio: "pipe",
            }).trim();
            const diff = execSync("git diff HEAD 2>/dev/null || git diff 2>/dev/null", {
              cwd: workingDir, encoding: "utf-8", stdio: "pipe",
            }).trim();
            if (stat) codeDiff += `## Diff Summary\n${stat}\n\n`;
            if (diff) codeDiff += diff;
          } catch { /* not a git repo */ }
        }

        // Cap diff to fit within the reviewer model's context window.
        // Rough estimate: 1 token ≈ 4 chars. Reserve 40% of context for system prompt,
        // tools, instructions, and response. The diff gets the remaining 60%.
        const revContextWindow = getModelContext(revModel, revCtx);
        const maxDiffChars = Math.floor(revContextWindow * 3 * 0.5);
        if (codeDiff.length > maxDiffChars) {
          // Write full diff to a temp file so the reviewer can read_file it
          const diffFile = path.join(workingDir, ".workermill-review-diff.tmp");
          try { fs.writeFileSync(diffFile, codeDiff, "utf-8"); } catch { /* best effort */ }
          const stat = codeDiff.match(/## Branch Diff.*?\n([\s\S]*?)\n\n/)?.[1] || "";
          codeDiff = codeDiff.slice(0, maxDiffChars) +
            `\n\n... (diff truncated to fit ${formatContext(revContextWindow)} context window)\n\n` +
            `**Full diff saved to:** \`${diffFile}\` — use \`read_file ${diffFile}\` to review the complete diff.\n\n` +
            `${stat ? `File list:\n${stat}` : ""}`;
        }

        const reviewerProjectInstructions = formatProjectInstructions(workingDir) + formatPromptProjectContext(workingDir);
        const loopGuardSection = isRevision && repeatedBlockerCount >= 2
          ? `## Loop Guard

Recent review rounds repeated similar blockers. Re-verify the current code directly before blocking again.

- Do NOT insist on a specific file path change unless that path is truly required for behavior correctness
- If behavior already works, approve and mention optional follow-ups as non-blocking
- If you still require revision, provide concrete failure evidence and the exact minimal fix needed
`
          : "";
        const reviewPrompt = `${previousFeedbackSection}${reviewerProjectInstructions ? `${reviewerProjectInstructions}\n\n` : ""}## Implementation Plan — THIS IS WHAT THE WORKERS WERE TOLD TO DO

Review the code against this plan. The planner analyzed the codebase and gave each worker specific guidance.

${storyPlanDetails}

## Code Changes

The diff below shows what was changed. For new files, use your read_file tool to inspect them.

Files created: ${context.filesCreated.join(", ") || "none"}
Files modified: ${context.filesModified.join(", ") || "none"}
${context.decisions.length > 0 ? `\nDecisions made:\n${context.decisions.map(d => `- ${d}`).join("\n")}` : ""}

${codeDiff || "(no code changes detected)"}${gateResultsSection}

## Original Spec (reference)

The plan above was derived from this spec. Use it to check completeness, but the plan is the workers' source of truth.

${userTask}

## Review Instructions

Review the actual code above. You also have tools (read_file, glob, grep) to examine files in more detail if needed.
${loopGuardSection ? `\n${loopGuardSection}` : ""}

## Feedback Guidelines

- **Be specific**: Point to exact files and issues when providing feedback
- **Be constructive**: Suggest alternatives, not just problems
- **Be balanced**: Acknowledge what's done well alongside improvements
- **Be pragmatic**: Distinguish must-fix from nice-to-have issues
- **Be evidence-based**: For blocking issues, cite concrete evidence (failing behavior, broken path, missing code, or reproducible command)

### APPROVE when:
- Code correctly implements the requirements AND the reviewer has no substantive improvements to suggest
- Pure cosmetic issues (trailing whitespace, blank lines, import ordering) are NOT grounds for revision — mention them in feedback but still approve

### REVISION_NEEDED when:
- Code has functional bugs that affect correctness
- Security vulnerabilities that must be fixed
- Missing required functionality from the task spec
- Broken imports, missing dependencies, or code that won't run
- Tests are weak or incomplete — e.g. a test that doesn't actually verify the behavior it claims to test, or missing edge case coverage for the feature being built
- You identified a substantive improvement that strengthens correctness, reliability, or prevents regressions — and you can describe the specific change needed

**IMPORTANT: If you mention an issue in your review, request the fix.** Do not label real issues as "non-blocking" and then approve. If it was worth analyzing and writing about, it is worth fixing while we are here. The only exception is pure cosmetic preferences (style, formatting, naming conventions) — those go in feedback as FYI only.

### REJECT when:
- Fundamental approach is wrong and cannot be fixed with revisions

**Quality gate stance**: Make decisions based on impact and evidence, not preference.
- Block for: correctness, security, missing functionality, weak tests, and substantive improvements you identified.
- Do NOT block for: style preferences, cosmetic formatting, naming conventions, or opinions without evidence.
- If uncertain, inspect files or run lightweight verification before blocking.

## Output Format

You MUST write your detailed feedback FIRST, THEN add the decision markers at the end.

**1. Write your full review** — analyze the code, list specific issues with file paths, explain what's good and what needs fixing. This is the most important part. Workers read this to know what to fix. Be thorough.

**2. Then add these markers at the end:**

REVIEW_DECISION: approved (or revision_needed or rejected)
CODE_QUALITY_SCORE: ${config.review?.approvalThreshold ?? 9}
FEEDBACK: One-line summary of your decision

For REVISION_NEEDED decisions, also include:
BLOCKING_EVIDENCE: concrete proof from this code state (repro step, failing command, or exact missing/wrong implementation)
ACTIONABLE_FIX: minimal specific change required to get approval

**Score guide (1-10):** 1-3 = fundamentally broken, 4-5 = major issues, 6 = functional but rough, 7 = solid with minor issues, ${config.review?.approvalThreshold ?? 9}+ = quality-gate pass. Use the score with your evidence: below ${config.review?.approvalThreshold ?? 9} means you found real blocking issues; ${config.review?.approvalThreshold ?? 9}+ means no blocking issues remain.

### For REVISION_NEEDED Decisions - Specify Affected Stories

There are exactly ${sorted.length} stories (numbered 1 to ${sorted.length}):
${sorted.map((s, i) => `  ${i + 1}. ${s.title} (${s.persona})`).join("\n")}

AFFECTED_STORIES MUST only contain numbers from 1 to ${sorted.length}. Do NOT invent story numbers that don't exist.

\`\`\`
AFFECTED_STORIES: [2, 3]
AFFECTED_REASONS: {"2": "reason for story 2", "3": "reason for story 3"}
\`\`\`

**Guidelines:**
- Only reference story numbers 1-${sorted.length} — these are the ONLY stories that exist
- Only include stories that have ACTUAL implementation issues in their code
- If ALL stories need revision, you may omit AFFECTED_STORIES (all will re-run)
- Be specific in AFFECTED_REASONS so developers know exactly what to fix
- Do NOT list issues as separate "stories" — map issues back to the story that should have handled them`;

        // Use onStepFinish for reviewer — same as WorkerMill ai-sdk-client.ts
        // Accumulate only the reviewer's NEW output (not the echoed prompt/previous feedback)
        let reviewerOutput = "";
        let reviewerFinalText = "";
        let reviewerVisibleText = "";
        const reviewStartMs = Date.now();
        const reviewTimeoutMs = getReviewWallTimeoutMs();
        const maxReviewAttempts = 2;
        let reviewUsage: { inputTokens?: number; outputTokens?: number } | undefined;
        let lastReviewError: unknown;
        for (let attempt = 1; attempt <= maxReviewAttempts; attempt++) {
          if (abortSignal?.aborted) throw new Error("Tech Lead review cancelled");
          const timedAbort = createTimedAbortSignal(abortSignal, reviewTimeoutMs, "Tech Lead review");
          try {
            const reviewerTools = createReviewTools({
              persona: reviewer,
              role: "tech_lead",
              model: reviewModel,
              config,
              output,
              workingDir,
              sandboxed: effectiveSandbox,
              signal: timedAbort.signal,
              runId: `${reviewRunId}-inline-${reviewRound}-${attempt}`,
              readOnlyRole: true,
            });
            const reviewStream = streamText({
              model: reviewModel,
              abortSignal: timedAbort.signal,
              system: reviewer.systemPrompt,
              prompt: reviewPrompt,
              tools: reviewerTools,
              stopWhen: stepCountIs(100),
              timeout: { chunkMs: 120_000 },
              ...buildOllamaOptions(revProvider as AIProvider, revCtx),
              ...buildReasoningOptions(revProvider, revModel),
              onStepFinish({ text }) {
                if (text) {
                  reviewerOutput += text + "\n";
                  const lines = text.split("\n").filter(l => l.trim());
                  for (const line of lines) {
                    if (line.includes("::review_score::") || line.includes("::review_verdict::") || line.includes("::code_quality_score::")) continue;
                    reviewerVisibleText += line + "\n";
                    output.log("tech_lead", line);
                  }
                }
              },
            });
            const result = await collectReviewStreamResult(
              reviewStream,
              reviewTimeoutMs,
              timedAbort,
              "Tech Lead review",
            );
            if (timedAbort.signal.aborted) throw new Error("Tech Lead review cancelled");
            reviewerFinalText = result.finalText;
            reviewUsage = result.usage;
            lastReviewError = undefined;
            lastReviewFailure = undefined;
            break;
          } catch (err) {
            lastReviewError = err;
            lastReviewFailure = reviewOutcomeFromError(err, timedAbort.didTimeout(), abortSignal?.aborted === true);
            const transient = isTransientError(err);
            const rl = isRateLimitError(err);
            const canRetry = !abortSignal?.aborted && attempt < maxReviewAttempts && (timedAbort.didTimeout() || transient || rl);
            if (!canRetry) throw err;
            const retryReason = timedAbort.didTimeout() ? "timed out" : rl ? `rate limited (waiting ${Math.ceil((rl.retryAfterMs) / 1000)}s)` : "hit a transient provider error";
            output.coordinatorLog(`Tech Lead review ${retryReason}; retrying once...`);
            if (rl) await rateLimitSleep(rl.retryAfterMs);
            logger.warn("Retrying tech lead review", {
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

        // Some providers/models put the decisive final answer in stream.text
        // rather than step chunks; prefer that when it is richer.
        const stepText = reviewerOutput.trim();
        const reviewText = reviewerFinalText.length > stepText.length
          ? reviewerFinalText
          : (stepText || reviewerFinalText);
        logger.debug("Reviewer output", { reviewRound, text: reviewText });

        output.statusDone();

        // Extract review decision — 3-tier system matching WorkerMill worker
        const threshold = config.review?.approvalThreshold ?? 9;
        outcome = interpretTechLeadReviewOutput(reviewText, threshold);
        const decision = outcome.decision!;
        const score = outcome.score!;
        const feedback = outcome.feedback!;
        const { approved } = outcome;
        const parsedAffected = sanitizeAffectedStories(parseAffectedStories(reviewText), sorted.length);
        if (!approved) {
          const blockerSignature = buildReviewBlockerSignature(reviewText, parsedAffected);
          if (blockerSignature && blockerSignature === lastBlockerSignature) {
            repeatedBlockerCount += 1;
          } else {
            repeatedBlockerCount = 1;
            lastBlockerSignature = blockerSignature;
          }
        } else {
          repeatedBlockerCount = 0;
          lastBlockerSignature = "";
        }
        const stuckOnSameBlocker = !approved && repeatedBlockerCount >= 2;
        const revInputTokens = reviewUsage?.inputTokens || 0;
        const revOutputTokens = reviewUsage?.outputTokens || 0;
        // Track tok/s for reviewer model
        const reviewElapsed = (Date.now() - reviewStartMs) / 1000;
        if (revOutputTokens > 0 && reviewElapsed > 0) {
          const reviewTokPerSec = Math.round(revOutputTokens / reviewElapsed);
          output.updateTokPerSec?.(`${revProvider}/${revModel}`, reviewTokPerSec);
          logger.info("Model performance", { provider: revProvider, model: revModel, tokPerSec: reviewTokPerSec });
        }
        logger.info(`Review round ${reviewRound} result`, { decision, score, approved, reviewTextLength: reviewText.length, inputTokens: revInputTokens, outputTokens: revOutputTokens });

        if (approved) {
          openMustFixItems = [];
        } else {
          const currentMustFixItems = extractStructuredMustFixItems(reviewText, parsedAffected);
          openMustFixItems = mergeMustFixItems(openMustFixItems, currentMustFixItems);
        }

        // Display review result with horizontal rules
        output.log("tech_lead", "\u2500".repeat(60));
        output.log("tech_lead", `::code_quality_score::${score}/10`);
        output.log("tech_lead", `::review_decision::${approved ? "approved" : decision === "rejected" ? "rejected" : "needs_revision"}`);
        output.log("tech_lead", "\u2500".repeat(60));
        // Only print feedback if the user did not already see the review streamed to the terminal.
        if (shouldPrintFeedbackFallback(feedback, reviewerVisibleText)) {
          output.log("tech_lead", "Fix context:");
          for (const line of feedback.split("\n").map((l) => l.trim()).filter(Boolean)) {
            output.log("tech_lead", line);
          }
        }
        output.coordinatorLog(approved ? `Review approved (${score}/10)` : `Review needs revision (${score}/10)`);
        if (stuckOnSameBlocker) {
          output.coordinatorLog(`Loop guard: reviewer repeated the same blockers for ${repeatedBlockerCount} rounds.`);
        }

        // Post review result to ticket — matches worker/epic/coordinator-review.ts
        if (ticketOps) {
          if (approved) {
            const roundLabel = reviewRound > 1 ? ` after ${reviewRound - 1} revision${reviewRound > 2 ? "s" : ""}` : "";
            ticketOps.postComment(
              `## ✅ Tech Lead Review — Approved${roundLabel} (${score}/10)\n\n${feedback}`
            ).catch(() => {});
          } else {
            ticketOps.postComment(
              `## 🔄 Tech Lead Review — Revision ${reviewRound - 1}/${maxRevisions - 1} (${score}/10)\n\n${feedback}`
            ).catch(() => {});
          }
        }

        // Save feedback for next review round — so tech_lead can check if issues were addressed
        previousReviewFeedback = reviewText;

        // Track reviewer cost
        costTracker.addUsage(`Reviewer (round ${reviewRound})`, revProvider, revModel,
          revInputTokens, revOutputTokens);
        output.updateCost?.(costTracker.getTotalCost());
        output.updateUsageSummary?.(costTracker.getUsageSummary());

        // If approved or out of revision attempts, done
        if (approved) {
          finalReviewText = reviewText;
          runLifecycleHooks("review_complete", config.hooks, workingDir, {
            WORKERMILL_REVIEW_SCORE: String(score),
            WORKERMILL_REVIEW_DECISION: "approved",
          });
          break;
        }
        const revisionsLeft = maxRevisions - reviewRound;
        if (revisionsLeft <= 0) {
          emitFailureCode(output, "review_blocker_unresolved", `Tech Lead review is still blocking after ${maxRevisions - 1} revision attempt(s).`);
          outcome = { ...outcome, kind: "revision_exhausted", approved: false };
          if (config.review?.strict) {
            output.coordinatorLog(`[strict] Max revisions reached without approval — build failed.`);
            output.error("Strict mode requires review approval. The build cannot proceed without it.");
            return { finalReviewText: reviewText, aborted: true, outcome };
          }
          output.coordinatorLog(`Max revisions (${maxRevisions - 1}) reached, proceeding to commit.`);
          break;
        }

        // Ask user or auto-revise
        let shouldRevise = autoRevise;
        if (autoRevise && stuckOnSameBlocker) {
          output.coordinatorLog("Loop guard: pausing auto-revise because reviewer feedback repeated without new signal.");
          shouldRevise = false;
        }
        if (!autoRevise) {
          try {
            const rv = await output.confirm(`Revise and re-review? (${revisionsLeft} left)`);
            if (typeof rv === "object") {
              shouldRevise = rv.allowed;
              if (rv.mode === "always") {
                // Switch to auto-revise for remaining rounds
                autoRevise = true;
                output.coordinatorLog("Auto-revise enabled for remaining rounds.");
                // Persist globally so future /build runs behave consistently.
                // Users can revert with: /settings review.autoRevise false
                try {
                  const globalCfg = loadConfig();
                  if (globalCfg) {
                    globalCfg.review = { ...globalCfg.review, autoRevise: true };
                    saveConfig(globalCfg);
                    output.coordinatorLog("Saved globally: /settings review.autoRevise true");
                  }
                } catch (persistErr) {
                  logger.warn("Failed to persist review.autoRevise", {
                    error: persistErr instanceof Error ? persistErr.message : String(persistErr),
                  });
                }
              }
            } else {
              shouldRevise = rv;
            }
          } catch (err) {
            logger.debug("Revision prompt cancelled", { error: err instanceof Error ? err.message : String(err) });
            shouldRevise = false; // cancelled
          }
        } else {
          output.coordinatorLog(`Auto-revising (${revisionsLeft} left)...`);
        }

        if (!shouldRevise) {
          emitFailureCode(output, "review_blocker_unresolved", "Tech Lead review still has blocking issues and revision was declined.");
          outcome = { ...outcome, kind: "revision_declined", approved: false };
          break;
        }

        // Parse which stories need revision — send feedback back to the original workers
        // (selective revision from inline-reviewer.ts)
        const affected = parsedAffected;
        const affectedSet = affected && affected.stories.length > 0 ? new Set(affected.stories) : null;

        if (affected && affected.stories.length > 0) {
          const selectiveInfo = `stories ${affected.stories.join(", ")}`;
          output.coordinatorLog(`Selective revision: ${selectiveInfo}`);
          if (Object.keys(affected.reasons).length > 0) {
            for (const [idx, reason] of Object.entries(affected.reasons)) {
              output.coordinatorLog(`  Story ${idx}: ${reason}`);
            }
          }
        } else {
          output.coordinatorLog("Full revision (all stories)");
        }

        output.log("system", "--- Revision Pass ---");

        // Capture HEAD before revision — so next review shows only what changed
        if (featureBranch) {
          preRevisionHash = getHeadHash(workingDir);
        }

        for (let i = 0; i < sorted.length; i++) {
          if (await waitWhilePaused()) {
            return { finalReviewText: "", aborted: true, outcome: { kind: "cancelled", approved: false, error: "Review paused or cancelled." } };
          }
          const story = sorted[i];

          // Skip stories not affected by the review (selective revision)
          if (affectedSet && !affectedSet.has(i + 1)) {
            output.coordinatorLog(`Skipping story ${i + 1}/${sorted.length} — not affected`);
            continue;
          }

          const storyPersona = loadPersona(story.persona);
          if (!storyPersona) continue;

          const { provider: sProvider, model: sModel, apiKey: sApiKey, host: sHost, contextLength: sCtx } = getProviderForPersona(
            config, storyPersona.provider || story.persona
          );
          if (sProvider && sApiKey) {
              const envVar = getApiKeyEnvVar(sProvider);
              if (envVar && !process.env[envVar]) {
                const key = sApiKey.startsWith("{env:") ? process.env[sApiKey.slice(5, -1)] : sApiKey;
                if (key) process.env[envVar] = key;
              }
          }

          // Build per-story feedback: use AFFECTED_REASONS if available, otherwise full review text
          const storyReason = affected?.reasons?.[i + 1];
          const storyMustFixItems = openMustFixItems.filter((item) => item.storyNumber === undefined || item.storyNumber === i + 1);
          const fallbackReviewFeedback = truncateForPrompt(reviewText, 6_000, "review feedback");
          const storyFeedback = storyReason
            ? `Story ${i + 1} (${story.title}):\n${storyReason}`
            : fallbackReviewFeedback;
          const loopGuardReminder = stuckOnSameBlocker
            ? `

## Loop Guard
The reviewer has repeated similar blockers across rounds. Before changing code, verify whether the claimed gap is truly still present.
- If behavior already works, prefer minimal clarifying changes (focused tests or explicit handling) instead of broad rewrites
- If behavior is broken, fix only the smallest change needed and keep scope tight
`
            : "";

          output.coordinatorLog(`Revising story ${i + 1} of ${sorted.length}: ${story.title}`);
          logger.info(`Revision started`, { story: i + 1, persona: story.persona, title: story.title, hasSpecificFeedback: !!storyReason });
          output.log(story.persona, `Starting revision: ${story.title} (\x1b[38;5;208m${sProvider}/${sModel}\x1b[0m, ${formatContext(getModelContext(sModel, sCtx))} context)`);

          output.status(`${story.persona}: revising...`);

          if (abortSignal?.aborted) return { finalReviewText: "", aborted: true, outcome: { kind: "cancelled", approved: false } };
          const storyModel = createModel(sProvider as AIProvider, sModel, sHost, sCtx, sApiKey);

          // Revision prompt follows WorkerMill platform pattern (prompt-builder.ts):
          // Per-story feedback + what was tried before + efficiency tips + scope enforcement.
          // The worker gets enough context to fix its own mistakes without re-implementing.

          // Capture per-story prior work from git history — matches worker/epic/git-ops.ts:captureStoryBranchSummaries()
          const whatYouDidLastTime = featureBranch
            ? captureStoryPriorWork(workingDir, mainBranch, i + 1)
            : "";

          const revisionSystemPrompt = `${storyPersona.systemPrompt}

Working directory: ${workingDir}`;

          const revisionTimedAbort = createTimedAbortSignal(abortSignal, getReviewWallTimeoutMs(), "Revision worker");
          try {
            if (abortSignal?.aborted) return { finalReviewText: "", aborted: true, outcome: { kind: "cancelled", approved: false } };
            const storyTools = createReviewTools({
              persona: storyPersona,
              role: story.persona,
              model: storyModel,
              config,
              output,
              workingDir,
              sandboxed: effectiveSandbox,
              signal: revisionTimedAbort.signal,
              runId: `${reviewRunId}-revision-${reviewRound}-${story.id}-${randomUUID()}`,
              readOnlyRole: false,
              trustAll,
              sessionAllow,
              onToolStatus: (status) => output.status(status),
            });
            const revisionStartMs = Date.now();
            const revisionReasoningLength = { value: 0 };
            const revStream = streamText({
              model: storyModel,
              abortSignal: revisionTimedAbort.signal,
              system: revisionSystemPrompt,
              prompt: `## ⚠️ REVISION REQUIRED — Tech Lead Feedback

### Your Story's Required Fix
${storyFeedback}
${loopGuardReminder}
${storyMustFixItems.length > 0 ? `## Structured Must-Fix Items\n${formatMustFixItems(storyMustFixItems)}\n\n` : ""}${whatYouDidLastTime}
## Your Story Scope
Story ${i + 1}: "${story.title}" — ${story.description}
${story.targetFiles?.length ? `**Target files:** ${story.targetFiles.join(", ")}` : ""}
${story.primaryPattern ? `\n**Primary pattern file:** ${story.primaryPattern}` : ""}
${story.integrationPoints?.length ? `\n**Integration points:** ${story.integrationPoints.join(", ")}` : ""}
${story.nonGoals?.length ? `\n**Non-goals:** ${story.nonGoals.join(", ")}` : ""}
${story.validationSignal ? `\n**Validation signal:** ${story.validationSignal}` : ""}
${story.implementationNotes ? `\n## Architect's Guidance\n${story.implementationNotes}` : ""}

**IMPORTANT: Only fix issues that are YOUR story's responsibility.**
- Fix the specific issues listed above
- Do NOT fix issues in files that belong to other stories
- Do NOT rewrite files from scratch — use edit_file for targeted changes
- READ each file BEFORE editing it

**EFFICIENCY TIP: Go straight to the files mentioned in the feedback.**
- You already built this code in the previous attempt
- Skip re-reading files unless they're directly relevant to the feedback
- Focus on the specific issues, not re-implementation

**Communication:** Think out loud with short progress updates. Before major tool calls, state intent; after tool calls, state what changed and next step.`,
              tools: storyTools as ToolSet,
              stopWhen: stepCountIs(100),
              timeout: { chunkMs: 120_000 },
              ...buildReasoningOptions(sProvider, sModel),
              ...buildOllamaOptions(sProvider as AIProvider, sCtx),
              onStepFinish({ text, toolCalls, reasoningText }) {
                emitReasoningDelta((line) => output.log(story.persona, line), reasoningText, revisionReasoningLength);
                if (toolCalls && toolCalls.length > 0) {
                  for (const tc of toolCalls) {
                    const filePath = extractToolFilePath(tc.toolName, tc.input as Record<string, unknown>);
                    if (!filePath) continue;
                    if (tc.toolName === "write_file") {
                      if (liveViewServer) liveViewServer.emitFileChange(story.persona, i + 1, story.title, filePath, "created");
                    } else if (tc.toolName === "edit_file" || tc.toolName === "multi_edit_file" || tc.toolName === "patch") {
                      if (liveViewServer) liveViewServer.emitFileChange(story.persona, i + 1, story.title, filePath, "edited");
                    }
                  }
                }
                if ((!text || !text.trim()) && toolCalls && toolCalls.length > 0) {
                  const first = toolCalls[0];
                  const detail = formatToolCallDisplay(first.toolName, first.input as Record<string, unknown>);
                  output.log(story.persona, `${first.toolName}${detail ? ` ${detail}` : ""}`);
                }
                if (text) {
                  const lines = text.split("\n").filter(l => l.trim());
                  for (const line of lines) {
                    if (line.includes("::")) continue;
                    output.log(story.persona, line);
                  }
                }
                output.status(`${story.persona}: working...`);
              },
            });

            for await (const _chunk of revStream.textStream) { /* drive */ }
            const revUsage = await revStream.totalUsage;
            if (revisionTimedAbort.signal.aborted) {
              return {
                finalReviewText: "",
                aborted: true,
                outcome: { kind: revisionTimedAbort.didTimeout() ? "timed_out" : "cancelled", approved: false },
              };
            }

            costTracker.addUsage(`${storyPersona.name} (revision)`, sProvider, sModel,
              revUsage?.inputTokens || 0, revUsage?.outputTokens || 0);
            output.updateCost?.(costTracker.getTotalCost());
            output.updateUsageSummary?.(costTracker.getUsageSummary());

            // Track tok/s for revision worker model
            const revisionElapsed = (Date.now() - revisionStartMs) / 1000;
            const revisionOutTokens = revUsage?.outputTokens || 0;
            if (revisionOutTokens > 0 && revisionElapsed > 0) {
              const revisionTokPerSec = Math.round(revisionOutTokens / revisionElapsed);
              output.updateTokPerSec?.(`${sProvider}/${sModel}`, revisionTokPerSec);
              logger.info("Model performance", { provider: sProvider, model: sModel, tokPerSec: revisionTokPerSec });
            }

            logger.info(`Revision completed`, { story: i + 1, persona: story.persona, inputTokens: revUsage?.inputTokens || 0, outputTokens: revUsage?.outputTokens || 0 });
            output.log(story.persona, `${story.title} — revision complete!`);
          } catch (err) {
            output.statusDone();
            if (isBalanceOrQuotaError(err)) {
              const shouldStop = await pauseForBalanceIssue(`Revision story ${i + 1}`);
              if (shouldStop) {
                return { finalReviewText: "", aborted: true, outcome: { kind: "provider_failed", approved: false, error: "Revision provider balance or quota error." } };
              }
              continue;
            }
            const revRl = isRateLimitError(err);
            if (revRl) {
              const waitSec = Math.ceil(revRl.retryAfterMs / 1000);
              output.log("system", `Revision rate limited — retrying in ${waitSec}s`);
              logger.info("Revision rate limit retry", { story: i + 1, waitSec });
              await rateLimitSleep(revRl.retryAfterMs);
              // Fall through to next review loop iteration which will re-attempt
            } else {
              const errMsg = err instanceof Error ? err.message : String(err);
              logger.error(`Revision failed`, { story: i + 1, persona: story.persona, error: errMsg });
              output.log("system", `Revision failed for story ${i + 1}: ${errMsg}`);
            }
          } finally {
            revisionTimedAbort.dispose();
          }

          // Commit revision changes — checkpoint on the feature branch
          if (featureBranch) {
            const hash = commitRevisionChanges(workingDir, i + 1, story.title, story.persona, reviewRound);
            if (hash) output.coordinatorLog(`Committed revision ${reviewRound} for story ${i + 1}: ${hash}`);
          }
        }
        // Loop back to review again
      } catch (err) {
        output.statusDone();
        if (isBalanceOrQuotaError(err)) {
          const shouldStop = await pauseForBalanceIssue("Tech Lead review");
          if (shouldStop) {
            return { finalReviewText: "", aborted: true, outcome: { kind: "provider_failed", approved: false, error: "Tech Lead reviewer balance or quota error." } };
          }
          continue;
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error("Review failed", {
          error: errMsg,
          stack: err instanceof Error ? err.stack : undefined,
          provider: revProvider,
          model: revModel,
          reviewRound,
        });
        output.log("system", `Review skipped: ${errMsg}`);
        outcome = lastReviewFailure ?? reviewOutcomeFromError(err, false, abortSignal?.aborted === true);
        break;
      }
    } // end review loop
  }

  return { finalReviewText, aborted: false, outcome };
}
