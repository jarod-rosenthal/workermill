/**
 * Directive Validation Service
 *
 * Validates persona directive content before saving.
 * Checks for required sections, size limits, and forbidden patterns.
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// Maximum directive size in bytes (50KB)
const MAX_DIRECTIVE_SIZE = 50 * 1024;

// Required sections for readme directives
const REQUIRED_SECTIONS = ["## Role", "## Guidelines"];

// Forbidden patterns (security concerns)
const FORBIDDEN_PATTERNS = [
  /\beval\s*\(/gi,
  /\bexec\s*\(/gi,
  /process\.env\.[A-Z_]+\s*=/gi, // Setting env vars
  /require\s*\(\s*['"`]child_process['"`]\s*\)/gi,
  /import\s+[^\n]*from\s+['"`]child_process['"`]/gi,
];

/**
 * Validate directive content
 */
export function validateDirective(
  content: string,
  type: "readme" | "common" = "readme"
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check size
  const sizeBytes = Buffer.byteLength(content, "utf-8");
  if (sizeBytes > MAX_DIRECTIVE_SIZE) {
    errors.push(
      `Directive exceeds maximum size of ${MAX_DIRECTIVE_SIZE / 1024}KB (current: ${Math.round(sizeBytes / 1024)}KB)`
    );
  } else if (sizeBytes > MAX_DIRECTIVE_SIZE * 0.8) {
    warnings.push(
      `Directive is approaching size limit (${Math.round(sizeBytes / 1024)}KB of ${MAX_DIRECTIVE_SIZE / 1024}KB)`
    );
  }

  // Check for empty content
  if (!content.trim()) {
    errors.push("Directive content cannot be empty");
    return { valid: false, errors, warnings };
  }

  // Check required sections for readme type
  if (type === "readme") {
    for (const section of REQUIRED_SECTIONS) {
      if (!content.includes(section)) {
        warnings.push(`Missing recommended section: ${section}`);
      }
    }
  }

  // Check for forbidden patterns
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(content)) {
      errors.push(`Directive contains forbidden pattern: ${pattern.source}`);
    }
  }

  // Check markdown structure
  const markdownIssues = validateMarkdownStructure(content);
  warnings.push(...markdownIssues);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate basic markdown structure
 */
function validateMarkdownStructure(content: string): string[] {
  const warnings: string[] = [];

  // Check for unclosed code blocks
  const codeBlockMatches = content.match(/```/g);
  if (codeBlockMatches && codeBlockMatches.length % 2 !== 0) {
    warnings.push("Unclosed code block detected (odd number of ``` markers)");
  }

  // Check for very long lines (might cause rendering issues)
  const lines = content.split("\n");
  const longLines = lines.filter((line) => line.length > 500);
  if (longLines.length > 0) {
    warnings.push(`${longLines.length} line(s) exceed 500 characters and may cause rendering issues`);
  }

  // Check for heading hierarchy (H1 followed by H3 without H2)
  const headings = lines
    .filter((line) => line.match(/^#{1,6}\s/))
    .map((line) => line.match(/^(#{1,6})\s/)?.[1].length || 0);

  for (let i = 1; i < headings.length; i++) {
    if (headings[i] > headings[i - 1] + 1) {
      warnings.push("Heading hierarchy skip detected (e.g., H1 to H3 without H2)");
      break;
    }
  }

  return warnings;
}

/**
 * Sanitize directive content (remove potentially harmful content)
 */
export function sanitizeDirective(content: string): string {
  let sanitized = content;

  // Remove any script tags (just in case)
  sanitized = sanitized.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");

  // Remove on* event handlers
  sanitized = sanitized.replace(/\son\w+\s*=/gi, " data-removed=");

  return sanitized;
}

/**
 * Extract variable interpolations from directive content
 */
export function extractVariables(content: string): string[] {
  const matches = content.match(/\{\{([^}]+)\}\}/g);
  if (!matches) return [];

  return [...new Set(matches.map((m) => m.replace(/\{\{|\}\}/g, "").trim()))];
}

/**
 * Validate variable interpolations
 */
export function validateVariables(content: string): { valid: string[]; invalid: string[] } {
  const VALID_VARIABLES = [
    "task.summary",
    "task.description",
    "task.jiraIssueKey",
    "task.githubRepo",
    "task.branch",
    "org.name",
    "org.slug",
    "persona.name",
    "persona.slug",
    "persona.description",
  ];

  const variables = extractVariables(content);
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const variable of variables) {
    if (VALID_VARIABLES.includes(variable)) {
      valid.push(variable);
    } else {
      invalid.push(variable);
    }
  }

  return { valid, invalid };
}
