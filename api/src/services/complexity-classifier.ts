/**
 * Complexity Classifier for Incoming Tasks
 *
 * Analyzes task descriptions to estimate complexity tier.
 * Uses heuristics based on:
 * - Keywords indicating scope/complexity
 * - Description length and detail
 * - Technical indicators
 * - System/component mentions
 */

export type ComplexityTier = "simple" | "medium" | "complex" | "expert";

export interface ComplexityAssessment {
  tier: ComplexityTier;
  score: number; // 0-100 scale
  confidence: "low" | "medium" | "high";
  factors: string[];
  estimatedCostRange: { min: number; max: number };
  estimatedTokenRange: { min: number; max: number };
}

// Keywords that indicate higher complexity
const COMPLEXITY_KEYWORDS = {
  expert: [
    "architecture",
    "redesign",
    "migration",
    "security audit",
    "performance optimization",
    "scalability",
    "distributed",
    "microservices",
    "infrastructure",
    "database migration",
    "breaking change",
    "backwards compatible",
    "critical system",
    "production hotfix",
    "data pipeline",
    "machine learning",
    "ml model",
    "ai system",
  ],
  complex: [
    "refactor",
    "rewrite",
    "integration",
    "authentication",
    "authorization",
    "api design",
    "multiple components",
    "cross-service",
    "workflow",
    "state management",
    "caching",
    "real-time",
    "websocket",
    "event-driven",
    "batch processing",
    "reporting system",
    "analytics",
  ],
  medium: [
    "feature",
    "endpoint",
    "component",
    "page",
    "form",
    "validation",
    "crud",
    "table",
    "list view",
    "detail view",
    "modal",
    "dropdown",
    "filter",
    "search",
    "pagination",
    "sorting",
  ],
  simple: [
    "fix",
    "bug",
    "typo",
    "update",
    "change",
    "rename",
    "adjust",
    "tweak",
    "minor",
    "small",
    "quick",
    "simple",
    "style",
    "css",
    "text",
    "label",
    "copy",
    "message",
  ],
};

// Keywords indicating scope expansion
const SCOPE_KEYWORDS = [
  "all",
  "every",
  "entire",
  "comprehensive",
  "complete",
  "full",
  "across",
  "throughout",
  "system-wide",
  "global",
];

// Technical system indicators
const SYSTEM_INDICATORS = [
  "database",
  "api",
  "frontend",
  "backend",
  "worker",
  "queue",
  "cache",
  "storage",
  "cdn",
  "gateway",
  "proxy",
  "service",
  "microservice",
  "container",
  "kubernetes",
  "aws",
  "terraform",
];

/**
 * Classify the complexity of a task based on its description
 */
export function classifyComplexity(
  summary: string,
  description?: string
): ComplexityAssessment {
  const text = `${summary} ${description || ""}`.toLowerCase();
  const factors: string[] = [];
  let score = 30; // Base score (medium-simple)

  // 1. Check for expert keywords
  let expertMatches = 0;
  for (const keyword of COMPLEXITY_KEYWORDS.expert) {
    if (text.includes(keyword)) {
      expertMatches++;
      factors.push(`Expert keyword: "${keyword}"`);
    }
  }
  score += expertMatches * 15;

  // 2. Check for complex keywords
  let complexMatches = 0;
  for (const keyword of COMPLEXITY_KEYWORDS.complex) {
    if (text.includes(keyword)) {
      complexMatches++;
      if (complexMatches <= 3) factors.push(`Complex keyword: "${keyword}"`);
    }
  }
  score += complexMatches * 8;

  // 3. Check for medium keywords (slight bump)
  let mediumMatches = 0;
  for (const keyword of COMPLEXITY_KEYWORDS.medium) {
    if (text.includes(keyword)) {
      mediumMatches++;
    }
  }
  score += Math.min(mediumMatches * 3, 15);

  // 4. Check for simple keywords (reduce score)
  let simpleMatches = 0;
  for (const keyword of COMPLEXITY_KEYWORDS.simple) {
    if (text.includes(keyword)) {
      simpleMatches++;
    }
  }
  if (simpleMatches > 0 && expertMatches === 0 && complexMatches === 0) {
    score -= simpleMatches * 5;
    factors.push(`Simple indicators detected (${simpleMatches})`);
  }

  // 5. Scope expansion check
  let scopeExpansion = 0;
  for (const keyword of SCOPE_KEYWORDS) {
    if (text.includes(keyword)) {
      scopeExpansion++;
    }
  }
  if (scopeExpansion > 0) {
    score += scopeExpansion * 10;
    factors.push(`Scope expansion keywords (${scopeExpansion})`);
  }

  // 6. Multiple systems check
  let systemsCount = 0;
  for (const system of SYSTEM_INDICATORS) {
    if (text.includes(system)) {
      systemsCount++;
    }
  }
  if (systemsCount >= 3) {
    score += 15;
    factors.push(`Multiple systems involved (${systemsCount})`);
  } else if (systemsCount >= 2) {
    score += 8;
    factors.push(`Cross-system work (${systemsCount})`);
  }

  // 7. Description length indicator
  const wordCount = text.split(/\s+/).filter(w => w.length > 2).length;
  if (wordCount > 200) {
    score += 10;
    factors.push(`Detailed description (${wordCount} words)`);
  } else if (wordCount > 100) {
    score += 5;
  } else if (wordCount < 20) {
    score -= 5;
    factors.push(`Brief description (${wordCount} words)`);
  }

  // 8. Acceptance criteria indicators
  const hasAcceptanceCriteria = text.includes("given") && text.includes("when") && text.includes("then");
  const bulletPoints = (text.match(/[-*•]/g) || []).length;
  if (hasAcceptanceCriteria) {
    factors.push("Formal acceptance criteria present");
  }
  if (bulletPoints > 5) {
    score += 5;
    factors.push(`Multiple requirements (${bulletPoints} bullets)`);
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score));

  // Determine tier
  let tier: ComplexityTier;
  if (score >= 75) {
    tier = "expert";
  } else if (score >= 50) {
    tier = "complex";
  } else if (score >= 25) {
    tier = "medium";
  } else {
    tier = "simple";
  }

  // Confidence based on factor count
  const confidence = factors.length >= 5 ? "high" :
    factors.length >= 2 ? "medium" : "low";

  // Estimate cost and token ranges based on tier
  const costRanges: Record<ComplexityTier, { min: number; max: number }> = {
    simple: { min: 0.05, max: 0.50 },
    medium: { min: 0.30, max: 2.00 },
    complex: { min: 1.50, max: 8.00 },
    expert: { min: 5.00, max: 25.00 },
  };

  const tokenRanges: Record<ComplexityTier, { min: number; max: number }> = {
    simple: { min: 5000, max: 50000 },
    medium: { min: 30000, max: 150000 },
    complex: { min: 100000, max: 500000 },
    expert: { min: 300000, max: 1500000 },
  };

  return {
    tier,
    score,
    confidence,
    factors: factors.slice(0, 8), // Limit to top 8 factors
    estimatedCostRange: costRanges[tier],
    estimatedTokenRange: tokenRanges[tier],
  };
}

/**
 * Get a human-readable description of the complexity tier
 */
export function getTierDescription(tier: ComplexityTier): string {
  switch (tier) {
    case "simple":
      return "Quick fix or minor change. Typically involves single file edits, text updates, or small bug fixes.";
    case "medium":
      return "Standard feature or component. Involves multiple files, some testing, and moderate implementation effort.";
    case "complex":
      return "Multi-component feature or refactoring. Requires careful planning, cross-service changes, and thorough testing.";
    case "expert":
      return "Architecture-level change or critical system work. Requires expert review, extensive testing, and potential infrastructure changes.";
  }
}

/**
 * Convert complexity tier to the planning agent format
 */
export function tierToPlanningLevel(tier: ComplexityTier): string {
  switch (tier) {
    case "simple":
      return "low";
    case "medium":
      return "medium";
    case "complex":
      return "high";
    case "expert":
      return "high";
  }
}
