/**
 * Planning Validation Service
 *
 * Provides deterministic validation rules and quality scoring for execution plans.
 * All validation and scoring logic is non-LLM based for consistency.
 */

import { logger } from "../utils/logger.js";
import {
  PlanningTheme,
  PlannedStoryV2,
  ExecutionPlanV2,
  StoryQualityScore,
  PlanQualityScore,
  ValidationResult,
  ValidationReport,
  ThemeCategory,
  THEME_CATEGORY_ORDER,
  MIN_PLAN_QUALITY_SCORE,
  MIN_STORY_QUALITY_SCORE,
  AVAILABLE_PERSONAS,
  isValidCodingPersona,
  WorkerPersona,
} from "./planning-types.js";

// ============================================================================
// STORY QUALITY SCORING
// ============================================================================

/**
 * Score a single story's quality
 */
export function scoreStory(
  story: PlannedStoryV2,
  allStories: PlannedStoryV2[],
  themes: PlanningTheme[]
): StoryQualityScore {
  const issues: string[] = [];
  const suggestions: string[] = [];

  // 1. Completeness: Check if story has all required fields and content
  let completeness = 5;
  if (!story.scope || story.scope.length < 10) {
    completeness -= 1;
    issues.push("Scope is too brief");
  }
  if (!story.acceptanceCriteria || story.acceptanceCriteria.length === 0) {
    completeness -= 2;
    issues.push("Missing acceptance criteria");
  } else if (story.acceptanceCriteria.length < 2) {
    completeness -= 1;
    suggestions.push("Consider adding more acceptance criteria");
  }
  if (!story.targetFiles || story.targetFiles.length === 0) {
    completeness -= 1;
    issues.push("No target files specified");
  }

  // 2. Specificity: Check if acceptance criteria are concrete
  let specificity = 5;
  const vaguePatterns = [
    /works?$/i,
    /^handles?/i,
    /properly/i,
    /correctly/i,
    /appropriate/i,
    /good/i,
    /nice/i,
  ];
  for (const criterion of story.acceptanceCriteria || []) {
    if (criterion.length < 20) {
      specificity -= 0.5;
      suggestions.push(`Criterion too short: "${criterion.slice(0, 30)}..."`);
    }
    for (const pattern of vaguePatterns) {
      if (pattern.test(criterion)) {
        specificity -= 0.3;
        issues.push(`Vague criterion: "${criterion.slice(0, 50)}..."`);
        break;
      }
    }
  }
  specificity = Math.max(1, specificity);

  // 3. Independence: Fewer dependencies = better
  let independence = 5;
  const depCount = story.dependencies?.length || 0;
  if (depCount >= 4) {
    independence = 1;
    issues.push(`Too many dependencies (${depCount})`);
  } else if (depCount === 3) {
    independence = 2;
    suggestions.push("Consider reducing dependencies");
  } else if (depCount === 2) {
    independence = 3;
  } else if (depCount === 1) {
    independence = 4;
  }

  // 4. Sizing: Check story points and file count
  let sizing = 5;
  const points = story.storyPoints || 2;
  const fileCount = story.targetFiles?.length || 0;

  if (points > 3) {
    sizing -= 2;
    issues.push(`Story exceeds max 3 points (has ${points})`);
  }
  if (fileCount > 3) {
    sizing -= 1;
    issues.push(`Story targets too many files (${fileCount})`);
    suggestions.push("Consider splitting into smaller stories");
  }
  if (fileCount === 0) {
    sizing -= 1;
    issues.push("No target files - story may be too vague");
  }

  // Check theme alignment
  const theme = themes.find((t) => t.id === story.themeId);
  if (theme) {
    if (!theme.suggestedPersonas.includes(story.persona as WorkerPersona)) {
      issues.push(`Persona ${story.persona} not in theme's suggested personas`);
    }
  }

  // Calculate overall score
  const overall = parseFloat(
    ((completeness + specificity + independence + sizing) / 4).toFixed(2)
  );

  return {
    storyIndex: story.index,
    completeness: Math.round(completeness * 10) / 10,
    specificity: Math.round(specificity * 10) / 10,
    independence,
    sizing: Math.round(sizing * 10) / 10,
    overall,
    issues: [...new Set(issues)], // Dedupe
    suggestions: [...new Set(suggestions)],
  };
}

/**
 * Score the entire execution plan
 */
export function scorePlan(
  themes: PlanningTheme[],
  stories: PlannedStoryV2[],
  prdRequirements?: string[]
): PlanQualityScore {
  const suggestions: string[] = [];
  const blockers: string[] = [];

  // Score each story
  const storyScores = stories.map((story) => scoreStory(story, stories, themes));

  // 1. Completeness: Do themes/stories cover all requirements?
  let completeness = 5;
  const coveredRequirements = new Set<string>();
  for (const theme of themes) {
    for (const req of theme.coveredRequirements || []) {
      coveredRequirements.add(req);
    }
  }
  if (prdRequirements && prdRequirements.length > 0) {
    const coverage = coveredRequirements.size / prdRequirements.length;
    completeness = Math.max(1, Math.min(5, Math.round(coverage * 5)));
    if (coverage < 0.8) {
      suggestions.push(
        `Only ${Math.round(coverage * 100)}% of PRD requirements are covered`
      );
    }
  }

  // Check for foundation theme
  const hasFoundation = themes.some((t) => t.category === "foundation");
  if (!hasFoundation) {
    completeness -= 1;
    blockers.push("Missing foundation theme (documentation/architecture)");
  }

  // Check for testing theme if we have core stories
  const hasCoreStories = stories.some((s) => s.phase === "core");
  const hasTestingTheme = themes.some((t) => t.category === "testing");
  if (hasCoreStories && !hasTestingTheme) {
    suggestions.push("Consider adding a testing theme for QA coverage");
  }

  // 2. Ordering: Is the dependency/phase order correct?
  let ordering = 5;
  const orderingIssues: string[] = [];

  // Check that Story 0 is foundation
  if (stories.length > 0 && stories[0].phase !== "foundation") {
    ordering -= 1;
    orderingIssues.push("Story 0 should be a foundation story");
  }

  // Check phase ordering (foundation before core, core before integration, etc.)
  let lastPhaseOrder = 0;
  for (const story of stories.sort((a, b) => a.canonicalOrder - b.canonicalOrder)) {
    const phaseOrder = THEME_CATEGORY_ORDER[story.phase];
    if (phaseOrder < lastPhaseOrder) {
      ordering -= 0.5;
      orderingIssues.push(
        `Story ${story.index} (${story.phase}) appears after later phase`
      );
    }
    lastPhaseOrder = Math.max(lastPhaseOrder, phaseOrder);
  }

  // Check for forward dependencies
  for (const story of stories) {
    for (const dep of story.dependencies || []) {
      if (dep >= story.index) {
        ordering -= 1;
        orderingIssues.push(
          `Story ${story.index} has forward dependency on Story ${dep}`
        );
      }
    }
  }

  if (orderingIssues.length > 0) {
    suggestions.push(...orderingIssues.slice(0, 3)); // Limit noise
  }

  // 3. Balance: Is work evenly distributed across personas/themes?
  let balance = 5;
  const personaCounts: Record<string, number> = {};
  const themeCounts: Record<string, number> = {};

  for (const story of stories) {
    personaCounts[story.persona] = (personaCounts[story.persona] || 0) + 1;
    themeCounts[story.themeId] = (themeCounts[story.themeId] || 0) + 1;
  }

  // Check for persona imbalance
  const personaValues = Object.values(personaCounts);
  if (personaValues.length > 1) {
    const max = Math.max(...personaValues);
    const min = Math.min(...personaValues);
    if (max > min * 3) {
      balance -= 1;
      suggestions.push("Uneven work distribution across personas");
    }
  }

  // Check for very large themes
  for (const [themeId, count] of Object.entries(themeCounts)) {
    if (count > 10) {
      balance -= 0.5;
      suggestions.push(`Theme ${themeId} has ${count} stories - consider splitting`);
    }
  }

  // Calculate overall score
  const avgStoryScore =
    storyScores.length > 0
      ? storyScores.reduce((sum, s) => sum + s.overall, 0) / storyScores.length
      : 5;

  // Weight: 30% story scores, 25% completeness, 25% ordering, 20% balance
  const overall = parseFloat(
    (avgStoryScore * 0.3 + completeness * 0.25 + ordering * 0.25 + balance * 0.2).toFixed(2)
  );

  // Add blockers for low-scoring stories
  for (const score of storyScores) {
    if (score.overall < MIN_STORY_QUALITY_SCORE) {
      blockers.push(
        `Story ${score.storyIndex} has low quality score (${score.overall}/${MIN_STORY_QUALITY_SCORE})`
      );
    }
  }

  return {
    completeness: Math.round(completeness * 10) / 10,
    ordering: Math.round(ordering * 10) / 10,
    balance: Math.round(balance * 10) / 10,
    storyScores,
    overall,
    suggestions: [...new Set(suggestions)],
    blockers: [...new Set(blockers)],
  };
}

// ============================================================================
// VALIDATION RULES
// ============================================================================

/**
 * Validate that at least one foundation theme exists
 */
function validateFoundationExists(
  themes: PlanningTheme[],
  stories: PlannedStoryV2[]
): ValidationResult {
  const hasFoundation = themes.some((t) => t.category === "foundation");

  if (hasFoundation) {
    return {
      passed: true,
      ruleName: "foundation_exists",
      message: "Plan has at least one foundation theme",
    };
  }

  return {
    passed: false,
    ruleName: "foundation_exists",
    message: "Missing foundation theme - documentation/architecture should come first",
    autoFixed: false,
  };
}

/**
 * Validate that Story 0 is a foundation story
 */
function validateStoryZeroIsFoundation(
  themes: PlanningTheme[],
  stories: PlannedStoryV2[]
): ValidationResult {
  if (stories.length === 0) {
    return {
      passed: true,
      ruleName: "story_zero_foundation",
      message: "No stories to validate",
    };
  }

  const storyZero = stories.find((s) => s.canonicalOrder === 0);
  if (!storyZero) {
    return {
      passed: false,
      ruleName: "story_zero_foundation",
      message: "No story with canonicalOrder 0 found",
    };
  }

  if (storyZero.phase === "foundation") {
    return {
      passed: true,
      ruleName: "story_zero_foundation",
      message: "Story 0 is a foundation story",
    };
  }

  return {
    passed: false,
    ruleName: "story_zero_foundation",
    message: `Story 0 is ${storyZero.phase}, not foundation`,
    autoFixed: false,
  };
}

/**
 * Validate that stories follow phase ordering
 */
function validatePhaseOrdering(
  themes: PlanningTheme[],
  stories: PlannedStoryV2[]
): ValidationResult {
  const sortedStories = [...stories].sort(
    (a, b) => a.canonicalOrder - b.canonicalOrder
  );

  const violations: string[] = [];
  let lastPhaseOrder = 0;

  for (const story of sortedStories) {
    const phaseOrder = THEME_CATEGORY_ORDER[story.phase];
    if (phaseOrder < lastPhaseOrder) {
      violations.push(
        `Story ${story.index} (${story.phase}) appears after ${story.phase === "foundation" ? "core/integration" : "later"} phase`
      );
    }
    lastPhaseOrder = Math.max(lastPhaseOrder, phaseOrder);
  }

  if (violations.length === 0) {
    return {
      passed: true,
      ruleName: "phase_ordering",
      message: "Stories follow correct phase ordering",
    };
  }

  return {
    passed: false,
    ruleName: "phase_ordering",
    message: `Phase ordering violations: ${violations.join("; ")}`,
    details: { violations },
  };
}

/**
 * Validate that no story has forward dependencies
 */
function validateForwardDependencies(
  themes: PlanningTheme[],
  stories: PlannedStoryV2[]
): ValidationResult {
  const violations: string[] = [];

  for (const story of stories) {
    for (const dep of story.dependencies || []) {
      const depStory = stories.find((s) => s.index === dep);
      if (depStory && depStory.canonicalOrder >= story.canonicalOrder) {
        violations.push(
          `Story ${story.index} depends on Story ${dep} which comes later`
        );
      }
    }
  }

  if (violations.length === 0) {
    return {
      passed: true,
      ruleName: "forward_dependencies",
      message: "No forward dependencies found",
    };
  }

  return {
    passed: false,
    ruleName: "forward_dependencies",
    message: `Forward dependencies: ${violations.join("; ")}`,
    details: { violations },
  };
}

/**
 * Validate that testing stories depend on what they test
 */
function validateTestingDependencies(
  themes: PlanningTheme[],
  stories: PlannedStoryV2[]
): ValidationResult {
  const testingStories = stories.filter((s) => s.phase === "testing");
  const coreStories = stories.filter((s) => s.phase === "core");

  if (testingStories.length === 0 || coreStories.length === 0) {
    return {
      passed: true,
      ruleName: "testing_dependencies",
      message: "No testing/core stories to validate",
    };
  }

  const missingDeps: string[] = [];

  for (const testStory of testingStories) {
    const hasCoreDependent = coreStories.some(
      (core) =>
        testStory.dependencies?.includes(core.index) ||
        core.canonicalOrder < testStory.canonicalOrder
    );

    if (!hasCoreDependent) {
      missingDeps.push(
        `Testing Story ${testStory.index} has no core dependencies`
      );
    }
  }

  if (missingDeps.length === 0) {
    return {
      passed: true,
      ruleName: "testing_dependencies",
      message: "Testing stories properly depend on core stories",
    };
  }

  return {
    passed: false,
    ruleName: "testing_dependencies",
    message: missingDeps.join("; "),
    details: { missingDeps },
  };
}

/**
 * Validate that all personas are valid coding personas
 */
/**
 * Map of common invalid persona names to their valid replacements.
 * Handles LLM-invented personas that don't exist in the system.
 */
const PERSONA_REMAP: Record<string, string> = {
  // Generic / fullstack -> backend
  fullstack_developer: "backend_developer",
  full_stack_developer: "backend_developer",
  fullstack: "backend_developer",
  developer: "backend_developer",
  engineer: "backend_developer",
  software_engineer: "backend_developer",
  // Frontend aliases
  web_developer: "frontend_developer",
  ui_developer: "frontend_developer",
  ux_developer: "frontend_developer",
  // Mobile consolidation
  mobile_developer: "mobile_developer",
  mobile_developer_ios: "mobile_developer",
  mobile_developer_android: "mobile_developer",
  // DevOps aliases
  sre: "devops_engineer",
  platform_engineer: "devops_engineer",
  infra_engineer: "devops_engineer",
  infrastructure_engineer: "devops_engineer",
  // QA aliases
  tester: "qa_engineer",
  test_engineer: "qa_engineer",
  // Absorbed personas -> new homes
  api_developer: "backend_developer",
  database_administrator: "backend_developer",
  dba: "backend_developer",
  data_engineer: "data_ml_engineer",
  ml_engineer: "data_ml_engineer",
  // New personas (self-remap for completeness)
  architect: "architect",
  data_ml_engineer: "data_ml_engineer",
};

function validatePersonas(
  themes: PlanningTheme[],
  stories: PlannedStoryV2[]
): ValidationResult {
  const invalidPersonas: string[] = [];
  const remapped: string[] = [];

  for (const story of stories) {
    if (!isValidCodingPersona(story.persona)) {
      const original = story.persona;
      const normalized = original.toLowerCase().replace(/[^a-z]/g, "_");
      const replacement = PERSONA_REMAP[normalized] || "backend_developer";
      logger.warn(`Auto-remapping invalid persona "${original}" → "${replacement}" for story ${story.index}`);
      story.persona = replacement;
      remapped.push(`Story ${story.index}: "${original}" → "${replacement}"`);
    }
  }

  if (remapped.length === 0) {
    return {
      passed: true,
      ruleName: "valid_personas",
      message: "All stories use valid coding personas",
    };
  }

  return {
    passed: true,
    autoFixed: true,
    ruleName: "valid_personas",
    message: `Auto-remapped ${remapped.length} invalid persona(s): ${remapped.join("; ")}`,
    details: { remapped },
  };
}

/**
 * Validate story sizing constraints
 */
function validateStorySizing(
  themes: PlanningTheme[],
  stories: PlannedStoryV2[]
): ValidationResult {
  const violations: string[] = [];

  for (const story of stories) {
    if (story.storyPoints > 3) {
      violations.push(
        `Story ${story.index} exceeds max 3 points (has ${story.storyPoints})`
      );
    }
    if (story.targetFiles && story.targetFiles.length > 5) {
      violations.push(
        `Story ${story.index} targets too many files (${story.targetFiles.length})`
      );
    }
  }

  if (violations.length === 0) {
    return {
      passed: true,
      ruleName: "story_sizing",
      message: "All stories are properly sized",
    };
  }

  return {
    passed: false,
    ruleName: "story_sizing",
    message: violations.join("; "),
    details: { violations },
  };
}

// ============================================================================
// AUTO-FIX FUNCTIONS
// ============================================================================

/**
 * Auto-fix: Add a default foundation theme if missing
 */
export function autoFixAddFoundationTheme(
  themes: PlanningTheme[],
  stories: PlannedStoryV2[]
): { themes: PlanningTheme[]; stories: PlannedStoryV2[]; fixed: boolean } {
  const hasFoundation = themes.some((t) => t.category === "foundation");
  if (hasFoundation) {
    return { themes, stories, fixed: false };
  }

  // Create a default foundation theme
  const foundationTheme: PlanningTheme = {
    id: "T0",
    name: "Documentation & Architecture",
    category: "foundation",
    description: "Document the architecture and implementation approach",
    suggestedPersonas: ["tech_writer"],
    estimatedStoryCount: 1,
    dependencies: [],
  };

  // Create a default foundation story
  const foundationStory: PlannedStoryV2 = {
    index: 0,
    title: "Document architecture and implementation approach",
    persona: "tech_writer",
    scope: "Create documentation outlining the architecture and implementation plan",
    acceptanceCriteria: [
      "README.md updated with project overview and setup instructions",
      "docs/architecture.md created with system design and component relationships",
      "Key technical decisions documented with rationale",
    ],
    dependencies: [],
    estimatedComplexity: "small",
    storyPoints: 1,
    targetFiles: ["README.md", "docs/architecture.md"],
    themeId: "T0",
    phase: "foundation",
    canonicalOrder: 0,
  };

  // Shift existing theme IDs and story indices
  const updatedThemes = [
    foundationTheme,
    ...themes.map((t) => ({
      ...t,
      id: `T${parseInt(t.id.replace("T", "")) + 1}`,
      dependencies: t.dependencies.map((d) => `T${parseInt(d.replace("T", "")) + 1}`),
    })),
  ];

  const updatedStories = [
    foundationStory,
    ...stories.map((s) => ({
      ...s,
      index: s.index + 1,
      canonicalOrder: s.canonicalOrder + 1,
      themeId: `T${parseInt(s.themeId.replace("T", "")) + 1}`,
      dependencies: s.dependencies.map((d) => d + 1),
    })),
  ];

  logger.info("Auto-fix: Added foundation theme and story", {
    newTheme: foundationTheme,
    newStory: foundationStory,
  });

  return { themes: updatedThemes, stories: updatedStories, fixed: true };
}

/**
 * Auto-fix: Reorder stories to follow phase sequence
 */
export function autoFixPhaseOrdering(
  themes: PlanningTheme[],
  stories: PlannedStoryV2[]
): { stories: PlannedStoryV2[]; fixed: boolean } {
  // Sort stories by phase order, then by original index within phase
  const sorted = [...stories].sort((a, b) => {
    const phaseOrderA = THEME_CATEGORY_ORDER[a.phase];
    const phaseOrderB = THEME_CATEGORY_ORDER[b.phase];
    if (phaseOrderA !== phaseOrderB) {
      return phaseOrderA - phaseOrderB;
    }
    return a.index - b.index;
  });

  // Check if ordering changed
  const orderChanged = sorted.some(
    (s, i) => s.canonicalOrder !== i
  );

  if (!orderChanged) {
    return { stories, fixed: false };
  }

  // Assign new canonical orders
  const reordered = sorted.map((s, i) => ({
    ...s,
    canonicalOrder: i,
  }));

  // Update dependencies to use new indices
  const indexMap = new Map<number, number>();
  sorted.forEach((s, newIndex) => {
    indexMap.set(s.index, newIndex);
  });

  const finalStories = reordered.map((s) => ({
    ...s,
    dependencies: s.dependencies
      .map((d) => indexMap.get(d))
      .filter((d): d is number => d !== undefined && d < s.canonicalOrder),
  }));

  logger.info("Auto-fix: Reordered stories by phase", {
    originalOrder: stories.map((s) => s.index),
    newOrder: finalStories.map((s) => s.index),
  });

  return { stories: finalStories, fixed: true };
}

/**
 * Auto-fix: Remove invalid forward dependencies
 */
export function autoFixForwardDependencies(
  stories: PlannedStoryV2[]
): { stories: PlannedStoryV2[]; fixed: boolean } {
  let fixed = false;

  const fixedStories = stories.map((story) => {
    const validDeps = story.dependencies.filter((dep) => {
      const depStory = stories.find((s) => s.index === dep);
      return depStory && depStory.canonicalOrder < story.canonicalOrder;
    });

    if (validDeps.length !== story.dependencies.length) {
      fixed = true;
      return { ...story, dependencies: validDeps };
    }
    return story;
  });

  if (fixed) {
    logger.info("Auto-fix: Removed forward dependencies");
  }

  return { stories: fixedStories, fixed };
}

/**
 * Auto-fix: Cap story points at 3
 */
export function autoFixStorySizing(
  stories: PlannedStoryV2[]
): { stories: PlannedStoryV2[]; fixed: boolean } {
  let fixed = false;

  const fixedStories = stories.map((story) => {
    if (story.storyPoints > 3) {
      fixed = true;
      return { ...story, storyPoints: 3 };
    }
    return story;
  });

  if (fixed) {
    logger.info("Auto-fix: Capped story points at 3");
  }

  return { stories: fixedStories, fixed };
}

// ============================================================================
// MAIN VALIDATION FUNCTION
// ============================================================================

/**
 * Run all validation rules on a plan
 */
export function validatePlan(
  themes: PlanningTheme[],
  stories: PlannedStoryV2[],
  autoFix: boolean = true
): ValidationReport {
  let currentThemes = [...themes];
  let currentStories = [...stories];
  let autoFixesApplied = 0;

  // Run validations
  const results: ValidationResult[] = [];

  // 1. Foundation exists
  let foundationResult = validateFoundationExists(currentThemes, currentStories);
  if (!foundationResult.passed && autoFix) {
    const fix = autoFixAddFoundationTheme(currentThemes, currentStories);
    if (fix.fixed) {
      currentThemes = fix.themes;
      currentStories = fix.stories;
      autoFixesApplied++;
      foundationResult = { ...foundationResult, autoFixed: true };
    }
  }
  results.push(foundationResult);

  // 2. Story zero is foundation
  const storyZeroResult = validateStoryZeroIsFoundation(currentThemes, currentStories);
  results.push(storyZeroResult);

  // 3. Phase ordering
  let phaseOrderResult = validatePhaseOrdering(currentThemes, currentStories);
  if (!phaseOrderResult.passed && autoFix) {
    const fix = autoFixPhaseOrdering(currentThemes, currentStories);
    if (fix.fixed) {
      currentStories = fix.stories;
      autoFixesApplied++;
      phaseOrderResult = { ...phaseOrderResult, autoFixed: true };
    }
  }
  results.push(phaseOrderResult);

  // 4. Forward dependencies
  let forwardDepResult = validateForwardDependencies(currentThemes, currentStories);
  if (!forwardDepResult.passed && autoFix) {
    const fix = autoFixForwardDependencies(currentStories);
    if (fix.fixed) {
      currentStories = fix.stories;
      autoFixesApplied++;
      forwardDepResult = { ...forwardDepResult, autoFixed: true };
    }
  }
  results.push(forwardDepResult);

  // 5. Testing dependencies
  const testingDepResult = validateTestingDependencies(currentThemes, currentStories);
  results.push(testingDepResult);

  // 6. Valid personas
  const personasResult = validatePersonas(currentThemes, currentStories);
  results.push(personasResult);

  // 7. Story sizing
  let sizingResult = validateStorySizing(currentThemes, currentStories);
  if (!sizingResult.passed && autoFix) {
    const fix = autoFixStorySizing(currentStories);
    if (fix.fixed) {
      currentStories = fix.stories;
      autoFixesApplied++;
      sizingResult = { ...sizingResult, autoFixed: true };
    }
  }
  results.push(sizingResult);

  // Determine overall validity
  const criticalRules = ["foundation_exists", "valid_personas"];
  const criticalIssues = results
    .filter((r) => !r.passed && !r.autoFixed && criticalRules.includes(r.ruleName))
    .map((r) => r.message);

  const valid =
    criticalIssues.length === 0 &&
    results.filter((r) => !r.passed && !r.autoFixed).length === 0;

  return {
    valid,
    results,
    autoFixesApplied,
    criticalIssues,
  };
}

/**
 * Check if a plan meets the minimum quality threshold for approval
 */
export function planMeetsQualityThreshold(qualityScore: PlanQualityScore): boolean {
  return (
    qualityScore.overall >= MIN_PLAN_QUALITY_SCORE &&
    qualityScore.blockers.length === 0
  );
}

/**
 * Generate a human-readable quality report
 */
export function generateQualityReport(
  qualityScore: PlanQualityScore,
  themes: PlanningTheme[],
  stories: PlannedStoryV2[]
): string {
  const lines: string[] = [
    "***REMOVED*** Plan Quality Report",
    "",
    `Overall Score: ${qualityScore.overall}/${MIN_PLAN_QUALITY_SCORE} required`,
    "",
    "***REMOVED******REMOVED*** Dimension Scores",
    `- Completeness: ${qualityScore.completeness}/5`,
    `- Ordering: ${qualityScore.ordering}/5`,
    `- Balance: ${qualityScore.balance}/5`,
    "",
    `***REMOVED******REMOVED*** Themes: ${themes.length}`,
    ...themes.map((t) => `- ${t.id}: ${t.name} (${t.category})`),
    "",
    `***REMOVED******REMOVED*** Stories: ${stories.length}`,
    ...stories.map((s) => {
      const score = qualityScore.storyScores.find(
        (ss) => ss.storyIndex === s.index
      );
      return `- Story ${s.index}: ${s.title} [${score?.overall || "N/A"}/5]`;
    }),
  ];

  if (qualityScore.blockers.length > 0) {
    lines.push("", "***REMOVED******REMOVED*** Blockers (must fix)", ...qualityScore.blockers.map((b) => `- ${b}`));
  }

  if (qualityScore.suggestions.length > 0) {
    lines.push(
      "",
      "***REMOVED******REMOVED*** Suggestions",
      ...qualityScore.suggestions.map((s) => `- ${s}`)
    );
  }

  return lines.join("\n");
}

// ============================================================================
// V3 VALIDATION (MUTEX GROUPS & DUAL SCORING)
// ============================================================================

/**
 * Validate mutex groups are properly assigned
 */
export function validateMutexGroups(
  stories: PlannedStoryV2[],
  mutexGroups?: Record<string, number[]>
): ValidationResult {
  if (!mutexGroups || Object.keys(mutexGroups).length === 0) {
    // No mutex groups is valid (just means no concurrency control)
    return {
      passed: true,
      ruleName: "mutex_groups",
      message: "No mutex groups defined (parallel execution allowed)",
    };
  }

  const issues: string[] = [];

  // Check that mutex group indices are valid
  for (const [group, indices] of Object.entries(mutexGroups)) {
    for (const idx of indices) {
      const story = stories.find(s => s.canonicalOrder === idx || s.index === idx);
      if (!story) {
        issues.push(`Mutex group "${group}" references non-existent story index ${idx}`);
      }
    }
  }

  // Check that stories with mutexGroups field match the plan's mutexGroups map
  for (const story of stories) {
    if (story.mutexGroups && story.mutexGroups.length > 0) {
      for (const group of story.mutexGroups) {
        if (!mutexGroups[group]) {
          issues.push(`Story ${story.index} references undefined mutex group "${group}"`);
        } else if (!mutexGroups[group].includes(story.index) &&
                   !mutexGroups[group].includes(story.canonicalOrder)) {
          issues.push(`Story ${story.index} claims mutex group "${group}" but not listed in plan`);
        }
      }
    }
  }

  if (issues.length === 0) {
    return {
      passed: true,
      ruleName: "mutex_groups",
      message: `${Object.keys(mutexGroups).length} mutex groups properly configured`,
    };
  }

  return {
    passed: false,
    ruleName: "mutex_groups",
    message: issues.join("; "),
    details: { issues },
  };
}

/**
 * Validate story count against dual score target
 */
export function validateStoryCountAgainstDualScore(
  stories: PlannedStoryV2[],
  dualScore?: { targetStories: number; scope: number; risk: number }
): ValidationResult {
  if (!dualScore) {
    return {
      passed: true,
      ruleName: "story_count_dual_score",
      message: "No dual score available for validation",
    };
  }

  const storyCount = stories.length;
  const target = dualScore.targetStories;

  // Allow +/- 50% variance from target
  const minAcceptable = Math.floor(target * 0.5);
  const maxAcceptable = Math.ceil(target * 1.5);

  if (storyCount >= minAcceptable && storyCount <= maxAcceptable) {
    return {
      passed: true,
      ruleName: "story_count_dual_score",
      message: `Story count (${storyCount}) is within target range (${minAcceptable}-${maxAcceptable})`,
    };
  }

  const suggestion = storyCount < minAcceptable
    ? "Plan may be under-decomposed - consider splitting large stories"
    : "Plan may be over-decomposed - consider combining related stories";

  return {
    passed: false,
    ruleName: "story_count_dual_score",
    message: `Story count (${storyCount}) outside target range (${minAcceptable}-${maxAcceptable}). ${suggestion}`,
    details: {
      storyCount,
      targetStories: target,
      scope: dualScore.scope,
      risk: dualScore.risk,
    },
  };
}

/**
 * Generate quality report including V3 dual score info
 */
export function generateQualityReportV3(
  qualityScore: PlanQualityScore,
  themes: PlanningTheme[],
  stories: PlannedStoryV2[],
  dualScore?: { scope: number; risk: number; targetStories: number },
  mutexGroups?: Record<string, number[]>
): string {
  const lines: string[] = [
    "***REMOVED*** Plan Quality Report (V3)",
    "",
    `Overall Score: ${qualityScore.overall}/${MIN_PLAN_QUALITY_SCORE} required`,
    "",
  ];

  // Add dual score section if available
  if (dualScore) {
    lines.push(
      "***REMOVED******REMOVED*** Dual Score Analysis",
      `- Scope: ${dualScore.scope}/100`,
      `- Risk: ${dualScore.risk}/100`,
      `- Target Stories: ${dualScore.targetStories}`,
      `- Actual Stories: ${stories.length}`,
      ""
    );
  }

  lines.push(
    "***REMOVED******REMOVED*** Dimension Scores",
    `- Completeness: ${qualityScore.completeness}/5`,
    `- Ordering: ${qualityScore.ordering}/5`,
    `- Balance: ${qualityScore.balance}/5`,
    ""
  );

  // Add mutex groups section if available
  if (mutexGroups && Object.keys(mutexGroups).length > 0) {
    lines.push(
      "***REMOVED******REMOVED*** Mutex Groups (Concurrency Control)",
      ...Object.entries(mutexGroups).map(([group, indices]) =>
        `- ${group}: Stories ${indices.join(", ")}`
      ),
      ""
    );
  }

  lines.push(
    `***REMOVED******REMOVED*** Themes: ${themes.length}`,
    ...themes.map((t) => `- ${t.id}: ${t.name} (${t.category})`),
    "",
    `***REMOVED******REMOVED*** Stories: ${stories.length}`,
    ...stories.map((s) => {
      const score = qualityScore.storyScores.find(
        (ss) => ss.storyIndex === s.index
      );
      const mutexInfo = s.mutexGroups && s.mutexGroups.length > 0
        ? ` [mutex: ${s.mutexGroups.join(", ")}]`
        : "";
      return `- Story ${s.index}: ${s.title} [${score?.overall || "N/A"}/5]${mutexInfo}`;
    })
  );

  if (qualityScore.blockers.length > 0) {
    lines.push("", "***REMOVED******REMOVED*** Blockers (must fix)", ...qualityScore.blockers.map((b) => `- ${b}`));
  }

  if (qualityScore.suggestions.length > 0) {
    lines.push(
      "",
      "***REMOVED******REMOVED*** Suggestions",
      ...qualityScore.suggestions.map((s) => `- ${s}`)
    );
  }

  return lines.join("\n");
}

// ============================================================================
// V2 FORMAT CONVERSION (ported from planning-agent-local.ts for unified path)
// ============================================================================

/**
 * Simple story format used by the local planning agent.
 * Matches the interface in planning-agent-local.ts.
 */
export interface LocalPlannedStory {
  id: string;
  title: string;
  description: string;
  persona: string;
  priority: number;
  estimatedEffort: "small" | "medium" | "large";
  dependencies: string[];
  acceptanceCriteria: string[];
  targetFiles?: string[];
  scope?: string;
}

/**
 * Simple execution plan format used by the local planning agent.
 */
export interface LocalExecutionPlan {
  summary: string;
  stories: LocalPlannedStory[];
  risks: string[];
  assumptions: string[];
}

/**
 * Token usage from the planning agent.
 */
export interface PlanningUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalCostUsd: number;
}

/**
 * Extended execution plan with V2 data for the coordinator.
 */
export interface ValidatedExecutionPlan extends LocalExecutionPlan {
  storiesV2: PlannedStoryV2[];
  mutexGroups: Record<string, number[]>;
  validationApplied: boolean;
  usage?: PlanningUsage;
}

/**
 * Convert raw plan stories to V2 format with numeric indices.
 * Creates synthetic themes based on personas for validation.
 * Ported from planning-agent-local.ts:824-919.
 */
export function convertToV2Format(plan: LocalExecutionPlan): {
  themes: PlanningTheme[];
  stories: PlannedStoryV2[];
  mutexGroups: Record<string, number[]>;
} {
  // Build ID to index mapping
  const idToIndex = new Map<string, number>();
  plan.stories.forEach((story, index) => {
    idToIndex.set(story.id, index);
  });

  // Infer phase from persona
  function inferPhase(persona: string, index: number): ThemeCategory {
    if (index === 0) return "foundation";
    if (persona === "tech_writer") return "foundation";
    if (persona === "qa_engineer") return "testing";
    if (persona === "devops_engineer") return "integration";
    if (persona === "security_engineer") return "integration";
    return "core";
  }

  // Convert stories to V2 format
  const storiesV2: PlannedStoryV2[] = plan.stories.map((story, index) => {
    // Convert string dependency IDs to numeric indices
    const numericDeps = story.dependencies
      .map(depId => idToIndex.get(depId))
      .filter((idx): idx is number => idx !== undefined && idx < index);

    const phase = inferPhase(story.persona, index);

    return {
      index,
      title: story.title,
      persona: story.persona,
      scope: story.scope || story.description,
      acceptanceCriteria: story.acceptanceCriteria,
      dependencies: numericDeps,
      estimatedComplexity: story.estimatedEffort,
      storyPoints: story.estimatedEffort === "small" ? 1 : story.estimatedEffort === "medium" ? 2 : 3,
      targetFiles: story.targetFiles || [],
      themeId: `T-${story.persona}`,
      phase,
      canonicalOrder: index,
    };
  });

  // Create synthetic themes from unique personas
  const personaSet = new Set(plan.stories.map(s => s.persona));
  const themes: PlanningTheme[] = Array.from(personaSet).map(persona => {
    const storiesForPersona = storiesV2.filter(s => s.persona === persona);
    const phase = storiesForPersona[0]?.phase || "core";
    return {
      id: `T-${persona}`,
      name: `${persona.replace(/_/g, " ")} tasks`,
      category: phase,
      description: `Tasks assigned to ${persona}`,
      suggestedPersonas: [persona],
      estimatedStoryCount: storiesForPersona.length,
      dependencies: [],
    };
  });

  // Build mutex groups from target files
  // Stories touching the same files should not run in parallel
  const mutexGroups: Record<string, number[]> = {};
  storiesV2.forEach(story => {
    if (story.targetFiles && story.targetFiles.length > 0) {
      // Group by directory (first path component)
      const dirs = new Set<string>();
      story.targetFiles.forEach(file => {
        const parts = file.split("/");
        if (parts.length > 1) {
          dirs.add(`dir:${parts[0]}`);
        }
        // Also add specific file mutex for exact file matches
        dirs.add(`file:${file}`);
      });
      dirs.forEach(dir => {
        if (!mutexGroups[dir]) {
          mutexGroups[dir] = [];
        }
        mutexGroups[dir].push(story.index);
      });
    }
  });

  // Filter out mutex groups with only 1 story (no conflict possible)
  const filteredMutexGroups: Record<string, number[]> = {};
  Object.entries(mutexGroups).forEach(([key, indices]) => {
    if (indices.length > 1) {
      filteredMutexGroups[key] = indices;
    }
  });

  return { themes, stories: storiesV2, mutexGroups: filteredMutexGroups };
}

/**
 * Validate and auto-fix an execution plan.
 * Returns the fixed plan with proper ordering and dependencies.
 * Ported from planning-agent-local.ts:925-953.
 */
export function validateAndFixPlan(
  themes: PlanningTheme[],
  stories: PlannedStoryV2[],
  taskId: string
): { themes: PlanningTheme[]; stories: PlannedStoryV2[] } {
  // Run validation with auto-fix enabled
  const validationResult = validatePlan(themes, stories, true);

  if (validationResult.autoFixesApplied > 0) {
    logger.info("Auto-fixed planning issues", {
      taskId,
      fixesApplied: validationResult.autoFixesApplied,
      results: validationResult.results
        .filter(r => r.autoFixed)
        .map(r => r.ruleName),
    });
  }

  if (validationResult.criticalIssues.length > 0) {
    logger.warn("Plan has critical issues that could not be auto-fixed", {
      taskId,
      issues: validationResult.criticalIssues,
    });
  }

  // Return the potentially modified stories
  // Note: validatePlan modifies in place when auto-fixing
  return { themes, stories };
}

/**
 * Convert validated V2 plan back to local ExecutionPlan format for compatibility.
 * Ported from planning-agent-local.ts:958-986.
 */
export function convertBackToExecutionPlan(
  originalPlan: LocalExecutionPlan,
  storiesV2: PlannedStoryV2[],
  mutexGroups: Record<string, number[]>
): LocalExecutionPlan & { storiesV2: PlannedStoryV2[]; mutexGroups: Record<string, number[]> } {
  // Sort by canonical order
  const sortedStories = [...storiesV2].sort((a, b) => a.canonicalOrder - b.canonicalOrder);

  // Convert back to original format but preserve V2 data
  const stories: LocalPlannedStory[] = sortedStories.map((s, idx) => ({
    id: `story-${idx + 1}`,
    title: s.title,
    description: s.scope,
    persona: s.persona,
    priority: idx + 1,
    estimatedEffort: s.estimatedComplexity as "small" | "medium" | "large",
    dependencies: s.dependencies.map(d => `story-${d + 1}`),
    acceptanceCriteria: s.acceptanceCriteria,
    targetFiles: s.targetFiles,
    scope: s.scope,
  }));

  return {
    ...originalPlan,
    stories,
    storiesV2: sortedStories,
    mutexGroups,
  };
}
