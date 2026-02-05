/**
 * Error Classifier for Epic Mode
 *
 * Classifies errors by category to determine if they are auto-fixable.
 * Used by the blocker handling system to decide between auto-retry and human escalation.
 */

import type { ErrorCategory, ErrorClassification } from "./types.js";

/**
 * Pattern definition for error classification.
 */
interface ErrorPattern {
  category: ErrorCategory;
  patterns: RegExp[];
  fixStrategy?: string;
}

/**
 * Error patterns organized by category.
 * Fixable categories: typescript, lint, test, build
 * Non-fixable categories: auth, network, resource, unknown
 */
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
    fixStrategy: "Fix TypeScript compilation errors by correcting types, imports, or signatures",
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
    fixStrategy: "Fix failing tests by correcting assertions or updating test expectations",
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
    fixStrategy: "Fix build errors by resolving module imports or fixing syntax",
  },

  // Auth errors (NOT FIXABLE - requires human intervention)
  {
    category: "auth",
    patterns: [
      /401 Unauthorized/i,
      /403 Forbidden/i,
      /Permission denied/i,
      /Authentication failed/i,
      /Invalid (API|access) (key|token)/i,
      /Token expired/i,
      /Not authorized/i,
      /Access denied/i,
    ],
  },

  // Network errors (NOT FIXABLE - transient or infrastructure issue)
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
    ],
  },

  // Resource errors (NOT FIXABLE - requires infrastructure change)
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

/**
 * Categories that can be automatically fixed by the agent.
 */
const FIXABLE_CATEGORIES: Set<ErrorCategory> = new Set([
  "typescript",
  "lint",
  "test",
  "build",
]);

/**
 * Classify an error message to determine its category and fixability.
 */
export function classifyError(errorMessage: string): ErrorClassification {
  // Normalize the error message for matching
  const normalizedError = errorMessage.trim();

  // Try to match against known patterns
  for (const errorPattern of ERROR_PATTERNS) {
    for (const pattern of errorPattern.patterns) {
      if (pattern.test(normalizedError)) {
        return {
          category: errorPattern.category,
          isFixable: FIXABLE_CATEGORIES.has(errorPattern.category),
          matchedPattern: pattern.source,
          fixStrategy: errorPattern.fixStrategy,
        };
      }
    }
  }

  // Unknown error - not automatically fixable
  return {
    category: "unknown",
    isFixable: false,
  };
}

/**
 * Check if an error category is fixable.
 */
export function isFixableCategory(category: ErrorCategory): boolean {
  return FIXABLE_CATEGORIES.has(category);
}

/**
 * Extract affected files from an error message.
 * Looks for common file path patterns.
 */
export function extractAffectedFiles(errorMessage: string): string[] {
  const files = new Set<string>();

  // Pattern for file paths with line numbers (e.g., "src/index.ts:10:5")
  const filePathWithLinePattern = /([a-zA-Z0-9_\-./]+\.(ts|tsx|js|jsx|json|css|scss|vue|svelte)):\d+/g;
  let match;
  while ((match = filePathWithLinePattern.exec(errorMessage)) !== null) {
    files.add(match[1]);
  }

  // Pattern for quoted file paths (e.g., "'./src/index.ts'" or '"./src/index.ts"')
  const quotedPathPattern = /['"]([a-zA-Z0-9_\-./@]+\.(ts|tsx|js|jsx|json|css|scss|vue|svelte))['"]/g;
  while ((match = quotedPathPattern.exec(errorMessage)) !== null) {
    // Remove leading ./ if present
    const filePath = match[1].replace(/^\.\//, "");
    files.add(filePath);
  }

  // Pattern for "in file" or "at file" mentions
  const inFilePattern = /(?:in|at)\s+([a-zA-Z0-9_\-./]+\.(ts|tsx|js|jsx|json))/gi;
  while ((match = inFilePattern.exec(errorMessage)) !== null) {
    files.add(match[1]);
  }

  return Array.from(files);
}

/**
 * Generate a fix prompt for the agent based on error classification.
 */
export function generateFixPrompt(
  classification: ErrorClassification,
  errorMessage: string,
  affectedFiles: string[]
): string {
  const basePrompt = classification.fixStrategy || "Fix the error";
  const filesContext =
    affectedFiles.length > 0
      ? `\n\nAffected files:\n${affectedFiles.map((f) => `- ${f}`).join("\n")}`
      : "";

  return `${basePrompt}

Error message:
${errorMessage}${filesContext}

Please analyze the error and implement the necessary fixes. After fixing, verify the changes work correctly.`;
}

/**
 * Category descriptions and explanations for human-readable summaries.
 */
const CATEGORY_INFO: Record<string, { description: string; explanation: string; userAction: string }> = {
  typescript: {
    description: "TypeScript compilation error",
    explanation: "The code has type errors that prevent it from compiling. This usually means a variable has the wrong type, a function is called with wrong arguments, or an import is missing.",
    userAction: "You can retry with guidance about the expected types, or provide more context about the intended behavior.",
  },
  lint: {
    description: "Linting/code style error",
    explanation: "The code doesn't follow the project's style rules (ESLint/Prettier). This could be formatting issues, unused variables, or style violations.",
    userAction: "Usually auto-fixable. Retry to let the worker apply lint fixes.",
  },
  test: {
    description: "Test failure",
    explanation: "One or more tests failed. The code may work but doesn't match what the tests expect, or there's a bug in the implementation.",
    userAction: "Review the test expectations. Retry with guidance about whether to fix the code or update the tests.",
  },
  build: {
    description: "Build/bundler error",
    explanation: "The build process failed. This could be missing dependencies, incorrect imports, or configuration issues with the bundler (webpack, vite, etc.).",
    userAction: "Check if a new dependency needs to be installed. Retry with guidance about missing packages.",
  },
  auth: {
    description: "Authentication/permission error",
    explanation: "The worker doesn't have permission to perform an action. This could be an expired token, missing API key, or insufficient permissions.",
    userAction: "Check that all API keys and tokens are valid and have the required permissions. This usually needs manual intervention.",
  },
  network: {
    description: "Network connectivity error",
    explanation: "The worker couldn't connect to a service. This could be a temporary outage, DNS issue, or the service being unreachable.",
    userAction: "This is often temporary. Wait a moment and retry. If it persists, check that the target service is running.",
  },
  resource: {
    description: "Resource limit error",
    explanation: "The system ran out of resources (memory, disk space, etc.). This usually happens with very large operations.",
    userAction: "This needs infrastructure changes. Consider increasing resource limits or breaking the task into smaller pieces.",
  },
  unknown: {
    description: "Unclassified error",
    explanation: "The worker encountered an error that doesn't match known patterns. The full error details may provide more context.",
    userAction: "Review the full error details below and provide specific guidance for the retry.",
  },
};

/**
 * Generate a human-readable summary of a blocker.
 * This summary is shown prominently to users so they understand what went wrong.
 */
export function generateBlockerSummary(
  errorMessage: string,
  classification: ErrorClassification,
  affectedFiles: string[],
  storyTitle: string
): string {
  const info = CATEGORY_INFO[classification.category] || CATEGORY_INFO.unknown;

  // Try to extract specific error details
  const specificError = extractSpecificError(errorMessage, classification.category);

  // Build the summary
  const parts: string[] = [];

  // Main problem - what went wrong
  if (specificError) {
    parts.push(`**${info.description}:** ${specificError}`);
  } else {
    parts.push(`**${info.description}** while working on "${storyTitle}"`);
  }

  // Explanation - why this happened
  parts.push(`**Why:** ${info.explanation}`);

  // Files involved
  if (affectedFiles.length > 0) {
    if (affectedFiles.length <= 3) {
      parts.push(`**Files:** ${affectedFiles.join(", ")}`);
    } else {
      parts.push(`**Files:** ${affectedFiles.slice(0, 3).join(", ")} (+${affectedFiles.length - 3} more)`);
    }
  }

  // What the user can do
  parts.push(`**Suggested action:** ${info.userAction}`);

  return parts.join("\n\n");
}

/**
 * Extract the most relevant error snippet from full output.
 */
function extractSpecificError(errorMessage: string, category: string): string | null {
  // If the error message is very short (like "exit 1"), it's useless
  if (errorMessage.length < 50) {
    return null;
  }

  const lines = errorMessage.split("\n");

  // TypeScript: look for "error TSxxxx:" lines
  if (category === "typescript") {
    const tsError = lines.find(l => /error TS\d+:/.test(l));
    if (tsError) {
      // Get the error message part
      const match = tsError.match(/error TS\d+:\s*(.+)/);
      return match ? match[1].trim() : tsError.trim();
    }
    // Look for "Cannot find" or "Type ... is not assignable"
    const typeError = lines.find(l => /Cannot find|is not assignable|does not exist on type/i.test(l));
    if (typeError) return typeError.trim().substring(0, 200);
  }

  // Test failures: look for test name and assertion
  if (category === "test") {
    const failLine = lines.find(l => /FAIL|FAILED|AssertionError/i.test(l));
    if (failLine) return failLine.trim().substring(0, 200);
    const expectLine = lines.find(l => /Expected.*to|expect\(.*\)/i.test(l));
    if (expectLine) return expectLine.trim().substring(0, 200);
  }

  // Build errors: look for the main error message
  if (category === "build") {
    const buildError = lines.find(l => /Build failed|Module not found|Could not resolve|Failed to compile/i.test(l));
    if (buildError) return buildError.trim().substring(0, 200);
  }

  // Lint errors: look for the rule violation
  if (category === "lint") {
    const lintError = lines.find(l => /error|Error/i.test(l) && !/^\s*$/.test(l));
    if (lintError) return lintError.trim().substring(0, 200);
  }

  // Auth errors
  if (category === "auth") {
    const authError = lines.find(l => /401|403|Unauthorized|Forbidden|Permission denied|Authentication failed/i.test(l));
    if (authError) return authError.trim().substring(0, 200);
  }

  // Network errors
  if (category === "network") {
    const netError = lines.find(l => /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|fetch failed|socket hang up/i.test(l));
    if (netError) return netError.trim().substring(0, 200);
  }

  // Resource errors
  if (category === "resource") {
    const resError = lines.find(l => /out of memory|heap|ENOMEM|ENOSPC|disk quota/i.test(l));
    if (resError) return resError.trim().substring(0, 200);
  }

  // Fallback: look for any line with "error" in it
  const genericError = lines.find(l => /error/i.test(l) && l.trim().length > 10);
  if (genericError) return genericError.trim().substring(0, 200);

  return null;
}
