/**
 * Worker Decision Engine
 *
 * Centralized decision-making service that encapsulates worker intelligence
 * previously embedded in the worker container image. This enables the API
 * to make all routing, classification, quality, and review decisions so that
 * workers can be thin execution layers.
 *
 * Functions are pure (no DB, no HTTP) except getWorkerConfig which reads
 * a static file from disk.
 */

import { readFile } from "fs/promises";
import { join } from "path";
import {
  COORDINATION_INSTRUCTIONS,
  LEARNING_INSTRUCTIONS,
  TECH_LEAD_REVIEW_PROMPT,
  DEVOPS_PHASE1_PROMPT,
  DEVOPS_DEPLOY_AUTO_PROMPT,
  DEVOPS_DEPLOY_MANUAL_PROMPT,
  DEVOPS_CREATE_PROMPT,
  IMPROVER_PROMPT,
} from "./prompt-templates.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ErrorCategory =
  | "typescript"
  | "lint"
  | "test"
  | "build"
  | "auth"
  | "auth_transient"
  | "network"
  | "resource"
  | "unknown";

export interface ClassifyErrorRequest {
  errorText: string;
  retryCount: number;
  maxAutoRetries: number;
  storyContext: {
    title: string;
    persona: string;
    targetFiles: string[];
  };
}

export interface ClassifyErrorResponse {
  category: ErrorCategory;
  fixable: boolean;
  action: "auto_retry" | "escalate" | "skip";
  affectedFiles: string[];
  summary: string;
  fixStrategy: string | null;
}

export interface EvaluateQualityRequest {
  metrics: {
    qualityScore?: number;
    testCoveragePercent?: number;
    securityVulnsHigh?: number;
    typeErrors?: boolean;
    testFailures?: boolean;
    lintErrors?: boolean;
    e2eFailures?: boolean;
  };
  taskId?: string;
  bypassRequested: boolean;
  qualityGateEnabled: boolean;
  thresholds?: {
    minQualityScore?: number | null;
    minTestCoveragePercent?: number | null;
    maxSecurityHighVulns?: number | null;
    blockOnTypeErrors?: boolean;
    blockOnTestFailures?: boolean;
    blockOnLintErrors?: boolean;
    blockOnE2EFailures?: boolean;
  };
}

export interface EvaluateQualityResponse {
  pass: boolean;
  reasons: string[];
  blockers: string[];
}

export interface ParseReviewOutcomeRequest {
  reviewerOutput: string;
  revisionCount: number;
  maxRevisions: number;
  perStoryRevisionCount: number;
  maxPerStoryRevisions: number;
}

export interface ParseReviewOutcomeResponse {
  decision: "approved" | "revision_needed" | "rejected";
  score: number | null;
  feedback: string | null;
  shouldRevise: boolean;
  revisionExhausted: boolean;
  reason: string;
}

export interface RouteQuestionRequest {
  question: string;
  targetPersona?: string;
  idleExperts: string[];
  allExperts: string[];
}

export interface RouteQuestionResponse {
  targetExpert: string | null;
  routingTier: 1 | 2 | 3;
  reason: string;
}

export interface RouteProviderRequest {
  persona: string;
  modelName?: string;
  providerRouting?: string;
  availableProviders: string[];
}

export interface RouteProviderResponse {
  provider: string;
  model: string;
  inferenceSource: "explicit" | "routing" | "model_name" | "default";
}

export interface WorkerConfig {
  agentsMd: string;
  personaIcons: Record<string, string>;
  providerIcons: Record<string, string>;
  reviewSchema: {
    decision: string[];
    scoreRange: [number, number];
  };
  claudeMdTemplate: string;
  defaults: {
    blockerMaxAutoRetries: number;
    maxReviewRevisions: number;
    maxPerStoryRevisions: number;
  };
  promptTemplates?: {
    coordinationInstructions: string;
    learningInstructions: string;
    techLeadReviewPrompt: string;
    devopsPhase1Prompt: string;
    devopsDeployAutoPrompt: string;
    devopsDeployManualPrompt: string;
    devopsCreatePrompt: string;
    improverPrompt: string;
  };
}

// ─── Error Classification Patterns ───────────────────────────────────────────

interface ErrorPattern {
  category: ErrorCategory;
  patterns: RegExp[];
  fixStrategy?: string;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  // TypeScript errors (FIXABLE)
  {
    category: "typescript",
    patterns: [
      /error TS\d+:/i,
      /Cannot find module ['"]([^'"]+)['"]/i,
      /Property ['"]([^'"]+)['"] does not exist on type/i,
      /Type ['"]([^'"]+)['"] is not assignable to type/i,
      /Argument of type ['"]([^'"]+)['"] is not assignable/i,
      /Object is possibly ['"]null['"]|['"]undefined['"]/i,
      /has no exported member ['"]([^'"]+)['"]/i,
      /Cannot find name ['"]([^'"]+)['"]/i,
      /tsconfig\.json.*no inputs were found/i,
      /The types of ['"]([^'"]+)['"] are incompatible/i,
      /Expected \d+ arguments?, but got \d+/i,
      /Duplicate identifier ['"]([^'"]+)['"]/i,
    ],
    fixStrategy:
      "Fix TypeScript compilation errors by correcting types, imports, or signatures",
  },

  // Lint errors (FIXABLE)
  {
    category: "lint",
    patterns: [
      /eslint.*error/i,
      /prettier.*error/i,
      /Parsing error:/i,
      /\d+ error(s)?.*found/i,
      /Definition for rule ['"]([^'"]+)['"] was not found/i,
      /Unexpected token/i,
      /'([^']+)' is defined but never used/i,
      /Missing semicolon/i,
      /Strings must use singlequote/i,
      /Unexpected console statement/i,
    ],
    fixStrategy: "Fix linting errors by following ESLint/Prettier rules",
  },

  // Test failures (FIXABLE)
  {
    category: "test",
    patterns: [
      /FAIL.*\.test\./i,
      /FAILED.*\.spec\./i,
      /AssertionError/i,
      /Expected.*to (be|equal|match|contain)/i,
      /Test Suites:.*failed/i,
      /Tests:.*failed/i,
      /expect\(received\)\.to/i,
      /Received:.*Expected:/i,
      /toMatchSnapshot.*failed/i,
      /jest.*exited with code 1/i,
      /vitest.*failed/i,
      /mocha.*failing/i,
    ],
    fixStrategy:
      "Fix failing tests by correcting assertions or updating test expectations",
  },

  // Build errors (FIXABLE)
  {
    category: "build",
    patterns: [
      /Build failed/i,
      /Module not found/i,
      /webpack.*error/i,
      /vite.*error/i,
      /esbuild.*error/i,
      /rollup.*error/i,
      /Could not resolve ['"]([^'"]+)['"]/i,
      /Failed to compile/i,
      /Module parse failed/i,
      /SyntaxError.*Unexpected/i,
      /npm ERR! code ELIFECYCLE/i,
    ],
    fixStrategy:
      "Fix build errors by resolving module imports or fixing syntax",
  },

  // Auth errors — transient (token refresh, revocation) are auto-retryable
  {
    category: "auth_transient",
    patterns: [
      /OAuth.*revok/i,
      /token.*revok/i,
      /Token expired/i,
      /Please run \/login/i,
    ],
    fixStrategy:
      "Retry — transient auth error (token revoked/expired, will refresh on retry)",
  },

  // Auth errors — permanent (wrong credentials, missing permissions)
  {
    category: "auth",
    patterns: [
      /401 Unauthorized/i,
      /403 Forbidden/i,
      /Permission denied/i,
      /Authentication failed/i,
      /Invalid (API|access) (key|token)/i,
      /Not authorized/i,
      /Access denied/i,
    ],
  },

  // Network errors (NOT FIXABLE)
  {
    category: "network",
    patterns: [
      /ECONNREFUSED/i,
      /ETIMEDOUT/i,
      /ENOTFOUND/i,
      /ENETUNREACH/i,
      /socket hang up/i,
      /network timeout/i,
      /fetch failed/i,
      /getaddrinfo.*failed/i,
      /502 Bad Gateway/i,
      /503 Service Unavailable/i,
      /504 Gateway Timeout/i,
      /(?:Request failed with )?status code 502/i,
      /(?:Request failed with )?status code 503/i,
      /(?:Request failed with )?status code 504/i,
    ],
  },

  // Resource errors (NOT FIXABLE)
  {
    category: "resource",
    patterns: [
      /ENOMEM/i,
      /ENOSPC/i,
      /heap out of memory/i,
      /JavaScript heap/i,
      /Out of memory/i,
      /Killed.*signal 9/i,
      /OOM/i,
      /disk quota exceeded/i,
      /no space left on device/i,
    ],
  },
];

const FIXABLE_CATEGORIES: Set<ErrorCategory> = new Set([
  "typescript",
  "lint",
  "test",
  "build",
  "auth_transient",
]);

/**
 * Category descriptions for human-readable summaries.
 */
const CATEGORY_INFO: Record<
  string,
  { description: string; explanation: string; userAction: string }
> = {
  typescript: {
    description: "TypeScript compilation error",
    explanation:
      "The code has type errors that prevent it from compiling. This usually means a variable has the wrong type, a function is called with wrong arguments, or an import is missing.",
    userAction:
      "You can retry with guidance about the expected types, or provide more context about the intended behavior.",
  },
  lint: {
    description: "Linting/code style error",
    explanation:
      "The code doesn't follow the project's style rules (ESLint/Prettier). This could be formatting issues, unused variables, or style violations.",
    userAction:
      "Usually auto-fixable. Retry to let the worker apply lint fixes.",
  },
  test: {
    description: "Test failure",
    explanation:
      "One or more tests failed. The code may work but doesn't match what the tests expect, or there's a bug in the implementation.",
    userAction:
      "Review the test expectations. Retry with guidance about whether to fix the code or update the tests.",
  },
  build: {
    description: "Build/bundler error",
    explanation:
      "The build process failed. This could be missing dependencies, incorrect imports, or configuration issues with the bundler (webpack, vite, etc.).",
    userAction:
      "Check if a new dependency needs to be installed. Retry with guidance about missing packages.",
  },
  auth_transient: {
    description: "Transient authentication error",
    explanation:
      "A token was revoked or expired during execution. This is a temporary issue — the token will be refreshed on retry.",
    userAction:
      "Auto-retryable. The worker will re-authenticate on the next attempt.",
  },
  auth: {
    description: "Authentication/permission error",
    explanation:
      "The worker doesn't have permission to perform an action. This could be an invalid API key, wrong credentials, or insufficient permissions.",
    userAction:
      "Check that all API keys and tokens are valid and have the required permissions. This usually needs manual intervention.",
  },
  network: {
    description: "Network connectivity error",
    explanation:
      "The worker couldn't connect to a service. This could be a temporary outage, DNS issue, or the service being unreachable.",
    userAction:
      "This is often temporary. Wait a moment and retry. If it persists, check that the target service is running.",
  },
  resource: {
    description: "Resource limit error",
    explanation:
      "The system ran out of resources (memory, disk space, etc.). This usually happens with very large operations.",
    userAction:
      "This needs infrastructure changes. Consider increasing resource limits or breaking the task into smaller pieces.",
  },
  unknown: {
    description: "Unclassified error",
    explanation:
      "The worker encountered an error that doesn't match known patterns. The full error details may provide more context.",
    userAction:
      "Review the full error details below and provide specific guidance for the retry.",
  },
};

// ─── Persona & Provider Icons ────────────────────────────────────────────────

const PERSONA_ICONS: Record<string, string> = {
  architect: "\uD83C\uDFD7\uFE0F",         // 🏗️
  frontend_developer: "\uD83C\uDFA8",      // 🎨
  backend_developer: "\uD83D\uDCBB",       // 💻 (was ⚙️ — narrow in terminals)
  devops_engineer: "\uD83D\uDD27",         // 🔧
  security_engineer: "\uD83D\uDEE1\uFE0F", // 🛡️
  qa_engineer: "\uD83E\uDDEA",             // 🧪
  tech_writer: "\uD83D\uDCDD",             // 📝
  project_manager: "\uD83D\uDCCB",         // 📋
  data_ml_engineer: "\uD83D\uDCCA",        // 📊
  mobile_developer: "\uD83D\uDCF1",        // 📱
  tech_lead: "\uD83D\uDC51",               // 👑 (was 👨‍💼 — ZWJ renders inconsistently)
  planning_agent: "\uD83D\uDCA1",          // 💡 (was 🗺️ — FE0F renders inconsistently)
  manager: "\uD83D\uDC54",                 // 👔
};

const PROVIDER_ICONS: Record<string, string> = {
  anthropic: "\uD83E\uDD16",
  openai: "\uD83D\uDD37",
  google: "\uD83D\uDD35",
  gemini: "\uD83D\uDD35",
  ollama: "\uD83C\uDFE0",
};

// ─── Provider Defaults ───────────────────────────────────────────────────────

const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-haiku-4-5",
  openai: "gpt-4o",
  google: "gemini-2.0-flash",
  gemini: "gemini-2.0-flash",
  ollama: "qwen2.5-coder:32b",
};

// ─── Question Routing Filters ────────────────────────────────────────────────

/**
 * Personas excluded from Tier 3 (round-robin) question routing.
 * These non-coding personas give poor answers to technical questions.
 * They can still answer questions explicitly targeted at them (Tier 1).
 */
const QUESTION_INELIGIBLE_PERSONAS = new Set([
  "support_agent",
  "project_manager",
  "tech_writer",
]);

// ─── Keyword-to-Specialty Mapping (for question routing) ─────────────────────

const KEYWORD_SPECIALTY: { keywords: RegExp; persona: string }[] = [
  {
    keywords: /\bsecurity\b/i,
    persona: "security_engineer",
  },
  {
    keywords: /\b(?:frontend|css|react|ui|component|styled|tailwind)\b/i,
    persona: "frontend_developer",
  },
  {
    keywords: /\b(?:database|sql|migration|postgres|mysql|mongo|redis)\b/i,
    persona: "backend_developer",
  },
  {
    keywords:
      /\b(?:deploy|ci|docker|infrastructure|kubernetes|k8s|pipeline|terraform|aws)\b/i,
    persona: "devops_engineer",
  },
  {
    keywords: /\b(?:test|coverage|e2e|playwright|jest|vitest|spec)\b/i,
    persona: "qa_engineer",
  },
  {
    keywords:
      /\b(?:api|endpoint|rest|graphql|route|middleware|express|fastify)\b/i,
    persona: "backend_developer",
  },
  {
    keywords:
      /\b(?:ml|machine.learning|tensorflow|pytorch|model.training|mlops|etl|data.pipeline)\b/i,
    persona: "data_ml_engineer",
  },
  {
    keywords:
      /\b(?:ios|android|swift|kotlin|react.native|mobile)\b/i,
    persona: "mobile_developer",
  },
];

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Classify an error message against known patterns. Returns the category
 * and whether the category is auto-fixable.
 */
function classifyErrorCategory(errorMessage: string): {
  category: ErrorCategory;
  isFixable: boolean;
  fixStrategy?: string;
} {
  const normalizedError = errorMessage.trim();

  for (const errorPattern of ERROR_PATTERNS) {
    for (const pattern of errorPattern.patterns) {
      if (pattern.test(normalizedError)) {
        return {
          category: errorPattern.category,
          isFixable: FIXABLE_CATEGORIES.has(errorPattern.category),
          fixStrategy: errorPattern.fixStrategy,
        };
      }
    }
  }

  return { category: "unknown", isFixable: false };
}

/**
 * Extract affected file paths from an error message.
 */
function extractAffectedFiles(errorMessage: string): string[] {
  const files = new Set<string>();

  // File paths with line numbers (e.g., "src/index.ts:10:5")
  const filePathWithLinePattern =
    /([a-zA-Z0-9_\-./]+\.(ts|tsx|js|jsx|json|css|scss|vue|svelte)):\d+/g;
  let match;
  while ((match = filePathWithLinePattern.exec(errorMessage)) !== null) {
    files.add(match[1]);
  }

  // Quoted file paths (e.g., "'./src/index.ts'" or '"./src/index.ts"')
  const quotedPathPattern =
    /['"]([a-zA-Z0-9_\-./@]+\.(ts|tsx|js|jsx|json|css|scss|vue|svelte))['"]/g;
  while ((match = quotedPathPattern.exec(errorMessage)) !== null) {
    const filePath = match[1].replace(/^\.\//, "");
    files.add(filePath);
  }

  // "in file" or "at file" mentions
  const inFilePattern =
    /(?:in|at)\s+([a-zA-Z0-9_\-./]+\.(ts|tsx|js|jsx|json))/gi;
  while ((match = inFilePattern.exec(errorMessage)) !== null) {
    files.add(match[1]);
  }

  return Array.from(files);
}

/**
 * Extract the most relevant error snippet from full output.
 */
function extractSpecificError(
  errorMessage: string,
  category: string,
): string | null {
  if (errorMessage.length < 50) {
    return null;
  }

  const lines = errorMessage.split("\n");

  if (category === "typescript") {
    const tsError = lines.find((l) => /error TS\d+:/.test(l));
    if (tsError) {
      const m = tsError.match(/error TS\d+:\s*(.+)/);
      return m ? m[1].trim() : tsError.trim();
    }
    const typeError = lines.find((l) =>
      /Cannot find|is not assignable|does not exist on type/i.test(l),
    );
    if (typeError) return typeError.trim();
  }

  if (category === "test") {
    const failLine = lines.find((l) =>
      /FAIL|FAILED|AssertionError/i.test(l),
    );
    if (failLine) return failLine.trim();
    const expectLine = lines.find((l) =>
      /Expected.*to|expect\(.*\)/i.test(l),
    );
    if (expectLine) return expectLine.trim();
  }

  if (category === "build") {
    const buildError = lines.find((l) =>
      /Build failed|Module not found|Could not resolve|Failed to compile/i.test(
        l,
      ),
    );
    if (buildError) return buildError.trim();
  }

  if (category === "lint") {
    const lintError = lines.find(
      (l) => /error|Error/i.test(l) && !/^\s*$/.test(l),
    );
    if (lintError) return lintError.trim();
  }

  if (category === "auth") {
    const authError = lines.find((l) =>
      /401|403|Unauthorized|Forbidden|Permission denied|Authentication failed/i.test(
        l,
      ),
    );
    if (authError) return authError.trim();
  }

  if (category === "network") {
    const netError = lines.find((l) =>
      /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|fetch failed|socket hang up|status code 50[234]/i.test(
        l,
      ),
    );
    if (netError) return netError.trim();
  }

  if (category === "resource") {
    const resError = lines.find((l) =>
      /out of memory|heap|ENOMEM|ENOSPC|disk quota/i.test(l),
    );
    if (resError) return resError.trim();
  }

  const genericError = lines.find(
    (l) => /error/i.test(l) && l.trim().length > 10,
  );
  if (genericError) return genericError.trim();

  return null;
}

/**
 * Generate a human-readable blocker summary.
 */
function generateBlockerSummary(
  errorMessage: string,
  category: ErrorCategory,
  affectedFiles: string[],
  storyTitle: string,
): string {
  const info = CATEGORY_INFO[category] || CATEGORY_INFO.unknown;
  const specificError = extractSpecificError(errorMessage, category);

  const parts: string[] = [];

  if (specificError) {
    parts.push(`**${info.description}:** ${specificError}`);
  } else {
    parts.push(
      `**${info.description}** while working on "${storyTitle}"`,
    );
  }

  parts.push(`**Why:** ${info.explanation}`);

  if (affectedFiles.length > 0) {
    if (affectedFiles.length <= 3) {
      parts.push(`**Files:** ${affectedFiles.join(", ")}`);
    } else {
      parts.push(
        `**Files:** ${affectedFiles.slice(0, 3).join(", ")} (+${affectedFiles.length - 3} more)`,
      );
    }
  }

  parts.push(`**Suggested action:** ${info.userAction}`);

  return parts.join("\n\n");
}

/**
 * Infer provider from model name string.
 */
function inferProviderFromModel(model: string): string {
  const modelLower = model.toLowerCase();
  if (modelLower.includes("claude") || modelLower.includes("anthropic")) {
    return "anthropic";
  }
  if (
    modelLower.includes("gpt") ||
    modelLower.includes("o1") ||
    modelLower.includes("o3")
  ) {
    return "openai";
  }
  if (modelLower.includes("gemini")) {
    return "google";
  }
  if (
    modelLower.includes("qwen") ||
    modelLower.includes("deepseek") ||
    modelLower.includes("llama") ||
    modelLower.includes("codestral")
  ) {
    return "ollama";
  }
  return "anthropic";
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Classify an error and determine the recommended action.
 *
 * Combines error pattern matching, fixability assessment, and retry logic
 * into a single decision. Lifted from worker/epic/error-classifier.ts and
 * worker/epic/blocker-manager.ts.
 */
export function classifyError(req: ClassifyErrorRequest): ClassifyErrorResponse {
  const classification = classifyErrorCategory(req.errorText);
  const affectedFiles = extractAffectedFiles(req.errorText);

  let action: "auto_retry" | "escalate" | "skip";
  if (classification.isFixable && req.retryCount < req.maxAutoRetries) {
    action = "auto_retry";
  } else {
    action = "escalate";
  }

  const summary = generateBlockerSummary(
    req.errorText,
    classification.category,
    affectedFiles,
    req.storyContext.title,
  );

  return {
    category: classification.category,
    fixable: classification.isFixable,
    action,
    affectedFiles,
    summary,
    fixStrategy: classification.fixStrategy ?? null,
  };
}

/**
 * Evaluate quality metrics against thresholds.
 *
 * Lifted from worker/epic/quality-gate.ts.
 */
export function evaluateQuality(
  req: EvaluateQualityRequest,
): EvaluateQualityResponse {
  const reasons: string[] = [];
  const blockers: string[] = [];

  // If quality gate is disabled, auto-pass
  if (!req.qualityGateEnabled) {
    return { pass: true, reasons: ["Quality gate disabled"], blockers: [] };
  }

  // If bypass is requested (verified server-side by route handler), auto-pass
  if (req.bypassRequested) {
    return { pass: true, reasons: ["Quality gate bypass authorized"], blockers: [] };
  }

  const thresholds = req.thresholds ?? {};

  // Check: minimum quality score
  if (
    thresholds.minQualityScore != null &&
    req.metrics.qualityScore != null
  ) {
    if (req.metrics.qualityScore >= thresholds.minQualityScore) {
      reasons.push(
        `Quality score ${req.metrics.qualityScore}% meets minimum ${thresholds.minQualityScore}%`,
      );
    } else {
      blockers.push(
        `Quality score (${req.metrics.qualityScore}%) below threshold (${thresholds.minQualityScore}%)`,
      );
    }
  }

  // Check: minimum test coverage
  if (
    thresholds.minTestCoveragePercent != null &&
    req.metrics.testCoveragePercent != null
  ) {
    if (
      req.metrics.testCoveragePercent >= thresholds.minTestCoveragePercent
    ) {
      reasons.push(
        `Test coverage ${req.metrics.testCoveragePercent}% meets minimum ${thresholds.minTestCoveragePercent}%`,
      );
    } else {
      blockers.push(
        `Test coverage (${req.metrics.testCoveragePercent}%) below threshold (${thresholds.minTestCoveragePercent}%)`,
      );
    }
  }

  // Check: maximum high-severity security vulnerabilities
  if (
    thresholds.maxSecurityHighVulns != null &&
    req.metrics.securityVulnsHigh != null
  ) {
    if (req.metrics.securityVulnsHigh <= thresholds.maxSecurityHighVulns) {
      reasons.push(
        `High-severity vulnerabilities (${req.metrics.securityVulnsHigh}) within limit (${thresholds.maxSecurityHighVulns})`,
      );
    } else {
      blockers.push(
        `High-severity vulnerabilities (${req.metrics.securityVulnsHigh}) exceed threshold (${thresholds.maxSecurityHighVulns})`,
      );
    }
  }

  // Check: type errors
  if (thresholds.blockOnTypeErrors && req.metrics.typeErrors) {
    blockers.push("TypeScript errors detected and blocking is enabled");
  }

  // Check: test failures
  if (thresholds.blockOnTestFailures && req.metrics.testFailures) {
    blockers.push("Test failures detected and blocking is enabled");
  }

  // Check: lint errors
  if (thresholds.blockOnLintErrors && req.metrics.lintErrors) {
    blockers.push("Lint errors detected and blocking is enabled");
  }

  // Check: E2E test failures
  if (thresholds.blockOnE2EFailures && req.metrics.e2eFailures) {
    blockers.push("E2E test failures detected and blocking is enabled");
  }

  const pass = blockers.length === 0;
  return { pass, reasons, blockers };
}

/**
 * Parse the output of a code reviewer to extract the review decision,
 * score, and feedback.
 *
 * Lifted from worker/epic/coordinator.ts:3041-3093.
 */
export function parseReviewOutcome(
  req: ParseReviewOutcomeRequest,
): ParseReviewOutcomeResponse {
  const output = req.reviewerOutput;

  // ── Parse decision ──────────────────────────────────────────────────────
  // Priority: structured marker > text marker > natural language
  const structuredDecisionMatch = output.match(
    /::review_decision::(approved|revision_needed|rejected)/i,
  );
  const textDecisionMatch = output.match(
    /REVIEW_DECISION:\s*(approved|revision_needed|rejected)/i,
  );

  let decision: "approved" | "revision_needed" | "rejected";

  if (structuredDecisionMatch) {
    decision = structuredDecisionMatch[1].toLowerCase() as typeof decision;
  } else if (textDecisionMatch) {
    decision = textDecisionMatch[1].toLowerCase() as typeof decision;
  } else {
    // Natural language fallback
    const lowerOutput = output.toLowerCase();
    const approvalPatterns = [
      /\bapproving\b/,
      /\bapproved\b/,
      /\blgtm\b/,
      /\bship it\b/,
      /\bmerge this\b/,
      /\bready to merge\b/,
      /gh pr review.*--approve/,
    ];
    const rejectionPatterns = [
      /\brejecting\b/,
      /\brejected\b/,
      /\bcannot approve\b/,
      /\bdo not merge\b/,
    ];

    if (approvalPatterns.some((p) => p.test(lowerOutput))) {
      decision = "approved";
    } else if (rejectionPatterns.some((p) => p.test(lowerOutput))) {
      decision = "rejected";
    } else {
      decision = "revision_needed";
    }
  }

  // ── Parse feedback ──────────────────────────────────────────────────────
  const structuredFeedbackMatch = output.match(
    /::feedback::(.+?)(?=\n|$)/i,
  );
  const textFeedbackMatch = output.match(
    /FEEDBACK:\s*([\s\S]*?)(?=\n\s*(?:REVIEW_DECISION:|CODE_QUALITY_SCORE:)|$)/i,
  );
  const feedback =
    structuredFeedbackMatch?.[1]?.trim() ||
    textFeedbackMatch?.[1]?.trim() ||
    null;

  // ── Parse score ─────────────────────────────────────────────────────────
  const structuredScoreMatch = output.match(
    /::code_quality_score::(\d+)/i,
  );
  const textScoreMatch = output.match(/CODE_QUALITY_SCORE:\s*(\d+)/i);
  let score: number | null = null;

  if (structuredScoreMatch) {
    score = Math.min(10, Math.max(1, parseInt(structuredScoreMatch[1], 10)));
  } else if (textScoreMatch) {
    score = Math.min(10, Math.max(1, parseInt(textScoreMatch[1], 10)));
  } else {
    score = 5; // default
  }

  // ── Determine revision state ────────────────────────────────────────────
  const revisionExhausted =
    req.revisionCount >= req.maxRevisions ||
    req.perStoryRevisionCount >= req.maxPerStoryRevisions;

  const shouldRevise =
    decision === "revision_needed" && !revisionExhausted;

  // ── Build reason ────────────────────────────────────────────────────────
  let reason: string;
  if (structuredDecisionMatch) {
    reason = `Structured marker ::review_decision::${decision}`;
  } else if (textDecisionMatch) {
    reason = `Text marker REVIEW_DECISION: ${decision}`;
  } else {
    reason = `Natural language inference: ${decision}`;
  }

  if (revisionExhausted && decision === "revision_needed") {
    reason += " (revision limit reached)";
  }

  return {
    decision,
    score,
    feedback,
    shouldRevise,
    revisionExhausted,
    reason,
  };
}

/**
 * Route a question to the best-fit expert using a 3-tier algorithm.
 *
 * Tier 1: Explicit target persona (if idle).
 * Tier 2: Keyword-based specialty matching.
 * Tier 3: First idle expert (or null).
 *
 * Lifted from coordinator.ts question routing logic.
 */
export function routeQuestion(
  req: RouteQuestionRequest,
): RouteQuestionResponse {
  const idleSet = new Set(req.idleExperts);

  // Tier 1: explicit target persona
  if (req.targetPersona && idleSet.has(req.targetPersona)) {
    return {
      targetExpert: req.targetPersona,
      routingTier: 1,
      reason: `Explicit target persona '${req.targetPersona}' is idle`,
    };
  }

  // Tier 2: keyword matching
  const questionLower = req.question.toLowerCase();
  for (const mapping of KEYWORD_SPECIALTY) {
    if (mapping.keywords.test(questionLower)) {
      if (idleSet.has(mapping.persona)) {
        return {
          targetExpert: mapping.persona,
          routingTier: 2,
          reason: `Keyword match for '${mapping.persona}' specialty`,
        };
      }
    }
  }

  // Tier 3: first idle expert (excluding non-coding personas)
  const eligibleExperts = req.idleExperts.filter(
    (p) => !QUESTION_INELIGIBLE_PERSONAS.has(p),
  );
  if (eligibleExperts.length > 0) {
    return {
      targetExpert: eligibleExperts[0],
      routingTier: 3,
      reason: "Fallback to first idle expert",
    };
  }

  return {
    targetExpert: null,
    routingTier: 3,
    reason: "No idle experts available",
  };
}

/**
 * Route a persona to the appropriate AI provider and model.
 *
 * Priority: (1) explicit providerRouting JSON, (2) infer from modelName,
 * (3) default to anthropic/claude-haiku-4-5.
 *
 * Lifted from worker/multi-expert/index.ts:195-241.
 */
export function routeProvider(
  req: RouteProviderRequest,
): RouteProviderResponse {
  // 1. Check explicit per-persona routing
  if (req.providerRouting) {
    try {
      const routing = JSON.parse(req.providerRouting) as Record<
        string,
        { provider: string; model: string }
      >;
      const entry = routing[req.persona];
      if (entry?.provider && entry?.model) {
        return {
          provider: entry.provider,
          model: entry.model,
          inferenceSource: "routing",
        };
      }
    } catch {
      // Invalid JSON, fall through
    }
  }

  // 2. Infer provider from model name
  if (req.modelName) {
    const provider = inferProviderFromModel(req.modelName);
    return {
      provider,
      model: req.modelName,
      inferenceSource: "model_name",
    };
  }

  // 3. Default to anthropic
  return {
    provider: "anthropic",
    model: PROVIDER_DEFAULT_MODELS.anthropic,
    inferenceSource: "default",
  };
}

/**
 * Return static worker configuration, including persona/provider icons,
 * review schema, defaults, and the AGENTS.md content.
 */
export async function getWorkerConfig(): Promise<WorkerConfig> {
  // Read AGENTS.md from api/data/AGENTS.md
  let agentsMd = "";
  try {
    const agentsPath = join(__dirname, "..", "..", "data", "AGENTS.md");
    agentsMd = await readFile(agentsPath, "utf-8");
  } catch (err) {
    console.error("[worker-decision-engine] AGENTS.md read failed:", err instanceof Error ? err.message : err);
    agentsMd = "# AGENTS.md not found\n";
  }

  return {
    agentsMd,
    personaIcons: { ...PERSONA_ICONS },
    providerIcons: { ...PROVIDER_ICONS },
    reviewSchema: {
      decision: ["approved", "revision_needed", "rejected"],
      scoreRange: [1, 10],
    },
    claudeMdTemplate:
      "# Project\n\nThis project uses TypeScript and follows standard patterns.\n",
    defaults: {
      blockerMaxAutoRetries: 3,
      maxReviewRevisions: 4,
      maxPerStoryRevisions: 0,
    },
    promptTemplates: {
      coordinationInstructions: COORDINATION_INSTRUCTIONS,
      learningInstructions: LEARNING_INSTRUCTIONS,
      techLeadReviewPrompt: TECH_LEAD_REVIEW_PROMPT,
      devopsPhase1Prompt: DEVOPS_PHASE1_PROMPT,
      devopsDeployAutoPrompt: DEVOPS_DEPLOY_AUTO_PROMPT,
      devopsDeployManualPrompt: DEVOPS_DEPLOY_MANUAL_PROMPT,
      devopsCreatePrompt: DEVOPS_CREATE_PROMPT,
      improverPrompt: IMPROVER_PROMPT,
    },
  };
}
