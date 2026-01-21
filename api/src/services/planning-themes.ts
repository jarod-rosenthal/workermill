/**
 * Planning Themes Service
 *
 * Handles theme extraction and per-theme story decomposition.
 * Uses multiple LLM calls for better quality on complex PRDs.
 */

import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../utils/logger.js";
import {
  PlanningTheme,
  PlannedStoryV2,
  ThemeCategory,
  ThemeExtractionInput,
  ThemeExtractionResult,
  StoryDecompositionInput,
  StoryDecompositionResult,
  AVAILABLE_PERSONAS,
  DEFAULT_PERSONAS_BY_CATEGORY,
  WorkerPersona,
  THEME_CATEGORY_ORDER,
} from "./planning-types.js";

// Model for planning operations - Sonnet 4.5 for high-quality planning
export const THEME_EXTRACTION_MODEL = "claude-sonnet-4-5-20250514";
export const STORY_DECOMPOSITION_MODEL = "claude-sonnet-4-5-20250514";

// ============================================================================
// THEME EXTRACTION TOOL
// ============================================================================

const THEME_EXTRACTION_TOOL: Anthropic.Tool = {
  name: "extract_themes",
  description:
    "Extract logical themes from a PRD. Each theme groups related requirements and maps to a development phase.",
  input_schema: {
    type: "object" as const,
    properties: {
      themes: {
        type: "array",
        description: "3-8 themes extracted from the PRD, ordered by category",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Theme identifier (T1, T2, etc.)",
            },
            name: {
              type: "string",
              description: "Human-readable theme name",
            },
            category: {
              type: "string",
              enum: ["foundation", "core", "integration", "testing", "polish"],
              description:
                "Phase category: foundation (docs/models), core (main features), integration (wiring), testing (QA), polish (optimization)",
            },
            description: {
              type: "string",
              description: "Brief description of what this theme covers",
            },
            suggestedPersonas: {
              type: "array",
              items: {
                type: "string",
                enum: AVAILABLE_PERSONAS as unknown as string[],
              },
              description: "Recommended personas for stories in this theme",
            },
            estimatedStoryCount: {
              type: "number",
              minimum: 1,
              maximum: 10,
              description: "Expected number of stories (1-10)",
            },
            dependencies: {
              type: "array",
              items: { type: "string" },
              description: "Theme IDs this theme depends on",
            },
            coveredRequirements: {
              type: "array",
              items: { type: "string" },
              description: "PRD requirements addressed by this theme",
            },
          },
          required: [
            "id",
            "name",
            "category",
            "description",
            "suggestedPersonas",
            "estimatedStoryCount",
            "dependencies",
          ],
        },
      },
      prdRequirements: {
        type: "array",
        items: { type: "string" },
        description: "All requirements extracted from the PRD",
      },
      reasoning: {
        type: "string",
        description: "Brief explanation of how themes were determined",
      },
    },
    required: ["themes", "prdRequirements", "reasoning"],
  },
};

const THEME_EXTRACTION_PROMPT = `You are a technical planning agent extracting themes from a PRD.

***REMOVED******REMOVED*** YOUR TASK

Analyze the PRD and extract 3-8 logical themes. Each theme groups related requirements and maps to a development phase.

***REMOVED******REMOVED*** STORY COUNT GUIDANCE

**Complexity Score: {{COMPLEXITY_SCORE}}/12**
**Target Total Stories: {{TARGET_MIN}}-{{TARGET_MAX}} (aim for ~{{TARGET}})**

Your themes should collectively yield approximately {{TARGET}} stories.
- Adjust each theme's estimatedStoryCount proportionally
- Simple themes: 2-3 stories, Complex themes: 4-8 stories
- Total across all themes should be close to {{TARGET}}

***REMOVED******REMOVED*** THEME CATEGORIES (in execution order)

| Category | Description | Typical Personas |
|----------|-------------|------------------|
| **foundation** | Data models, schemas, shared types (NOT documentation) | backend_developer, database_administrator |
| **core** | Main feature development (backend, frontend) | backend_developer, frontend_developer, api_developer |
| **integration** | Wiring components together, external services | backend_developer, devops_engineer, security_engineer |
| **testing** | E2E tests, QA validation | qa_engineer |
| **polish** | Optimizations, cleanup (optional) | backend_developer, frontend_developer |

***REMOVED******REMOVED*** DEPENDENCY RULES - CREATE NATURAL FLOW

**CRITICAL: The dependency graph must flow naturally. Every theme (except the first) should depend on at least one prior theme.**

1. **First theme has no dependencies** - It establishes the groundwork (data models, schemas)
2. **Every other theme MUST depend on at least one prior theme** - This creates natural execution flow
3. **integration depends on core** - Wiring requires components to exist
4. **testing depends on what it tests** - Usually core or integration
5. **Each theme should yield 2-8 stories** - Split large themes
6. **NO ORPHAN THEMES** - If a theme has no dependencies and nothing depends on it, something is wrong

***REMOVED******REMOVED*** AVAILABLE PERSONAS

Only use these personas in suggestedPersonas:
${AVAILABLE_PERSONAS.map((p) => `- ${p}`).join("\n")}

***REMOVED******REMOVED*** REPOSITORY CONTEXT

***REMOVED******REMOVED******REMOVED*** File Tree
\`\`\`
{{FILE_TREE}}
\`\`\`

***REMOVED******REMOVED******REMOVED*** Tech Stack
{{TECH_STACK}}

***REMOVED******REMOVED******REMOVED*** README Summary
\`\`\`
{{README_SUMMARY}}
\`\`\`

***REMOVED******REMOVED*** PRD TO ANALYZE

**Jira Key:** {{JIRA_KEY}}
**Summary:** {{SUMMARY}}

**Description:**
{{DESCRIPTION}}

**Labels:** {{LABELS}}

***REMOVED******REMOVED*** OUTPUT

Call the extract_themes tool with:
1. themes: Array of 3-8 themes, ordered by category (foundation first, testing last)
2. prdRequirements: All requirements you identified in the PRD
3. reasoning: Brief explanation of your theme groupings

IMPORTANT:
- Every theme after the first MUST have at least one dependency
- The dependency graph should flow naturally from start to finish
- NO orphan themes that connect to nothing`;

// ============================================================================
// STORY DECOMPOSITION TOOL
// ============================================================================

const STORY_DECOMPOSITION_TOOL: Anthropic.Tool = {
  name: "decompose_theme",
  description:
    "Decompose a single theme into implementation stories. Each story should be small enough for one worker.",
  input_schema: {
    type: "object" as const,
    properties: {
      themeId: {
        type: "string",
        description: "The theme ID being decomposed",
      },
      stories: {
        type: "array",
        description: "Stories for this theme (1-10 per theme)",
        minItems: 1,
        maxItems: 10,
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Brief, descriptive story title",
            },
            persona: {
              type: "string",
              enum: AVAILABLE_PERSONAS as unknown as string[],
              description: "The persona best suited to implement this story",
            },
            scope: {
              type: "string",
              description: "Clear description of what this story accomplishes",
            },
            acceptanceCriteria: {
              type: "array",
              items: { type: "string" },
              minItems: 2,
              description:
                "Specific, testable criteria. Include exact endpoints, field names, status codes where applicable.",
            },
            dependencies: {
              type: "array",
              items: { type: "number" },
              description:
                "Story indices within THIS THEME that must complete first. Use [] for no dependencies.",
            },
            estimatedComplexity: {
              type: "string",
              enum: ["small", "medium", "large"],
              description: "Rough estimate of story complexity",
            },
            storyPoints: {
              type: "number",
              enum: [1, 2, 3],
              description: "Story points (1-3). MUST be ≤3.",
            },
            targetFiles: {
              type: "array",
              items: { type: "string" },
              description: "Files to create or modify. Max 3 files per story.",
            },
            referenceFiles: {
              type: "array",
              items: { type: "string" },
              description: "Files to read for context but not modify",
            },
          },
          required: [
            "title",
            "persona",
            "scope",
            "acceptanceCriteria",
            "dependencies",
            "estimatedComplexity",
            "storyPoints",
            "targetFiles",
          ],
        },
      },
      reasoning: {
        type: "string",
        description: "Brief explanation of decomposition decisions",
      },
    },
    required: ["themeId", "stories", "reasoning"],
  },
};

const STORY_DECOMPOSITION_PROMPT = `You are a technical planning agent decomposing a theme into stories.

***REMOVED******REMOVED*** YOUR TASK

Create implementation stories for the theme below. Each story should be small enough for one AI worker to complete.

***REMOVED******REMOVED*** THEME TO DECOMPOSE

**Theme ID:** {{THEME_ID}}
**Theme Name:** {{THEME_NAME}}
**Category:** {{THEME_CATEGORY}}
**Description:** {{THEME_DESCRIPTION}}
**Suggested Personas:** {{SUGGESTED_PERSONAS}}
**Expected Stories:** {{ESTIMATED_STORY_COUNT}}
**Covered Requirements:** {{COVERED_REQUIREMENTS}}

***REMOVED******REMOVED*** STORY SIZING RULES (CRITICAL)

**CONSTRAINT: Maximum 3 story points per story.**

| Points | Scope | Files | Example |
|--------|-------|-------|---------|
| 1 | Single file, trivial change | 1 | Fix typo, add field |
| 2 | Single file, clear logic | 1-2 | Add validation, simple endpoint |
| 3 | Multi-file, clear pattern | 2-3 | Feature with model + route |

***REMOVED******REMOVED*** PERSONA CONSTRAINT

**ONLY use personas from the theme's suggestedPersonas:**
{{SUGGESTED_PERSONAS}}

Do NOT use other personas unless absolutely necessary.

***REMOVED******REMOVED*** DEPENDENCY RULES - CREATE NATURAL FLOW

**CRITICAL: Stories within a theme should flow naturally. Avoid orphan stories.**

- The FIRST story in a theme can have dependencies: []
- Every other story should have at least one dependency
- Dependencies are INDICES within this theme (0, 1, 2, etc.)

Good pattern (natural flow):
- Story 0: Create models - dependencies: []
- Story 1: Add endpoints - dependencies: [0]
- Story 2: Add UI - dependencies: [1]

Bad pattern (orphans):
- Story 0: dependencies: []
- Story 1: dependencies: []  ← orphan!
- Story 2: dependencies: []  ← orphan!

***REMOVED******REMOVED*** ACCEPTANCE CRITERIA GUIDELINES

Each criterion MUST be:
- **SPECIFIC**: Include exact endpoints, field names, status codes
- **TESTABLE**: Can be verified with a concrete test

BAD: "Login endpoint works"
GOOD: "POST /api/auth/login accepts { email: string, password: string } and returns 200 with { token: string }"

***REMOVED******REMOVED*** REPOSITORY CONTEXT

***REMOVED******REMOVED******REMOVED*** File Tree
\`\`\`
{{FILE_TREE}}
\`\`\`

***REMOVED******REMOVED******REMOVED*** Tech Stack
{{TECH_STACK}}

***REMOVED******REMOVED*** PRD CONTEXT

**Jira Key:** {{JIRA_KEY}}
**Summary:** {{SUMMARY}}

**Description:**
{{DESCRIPTION}}

***REMOVED******REMOVED*** PRIOR THEMES/STORIES (for context)

{{PRIOR_CONTEXT}}

***REMOVED******REMOVED*** OUTPUT

Call the decompose_theme tool with:
1. themeId: "{{THEME_ID}}"
2. stories: Array of stories for this theme
3. reasoning: Brief explanation of decomposition

IMPORTANT:
- Each story ≤3 points
- Each story ≤3 target files
- Use ONLY suggested personas
- Include specific acceptance criteria`;

// ============================================================================
// THEME EXTRACTION
// ============================================================================

/**
 * Extract themes from a PRD using LLM
 *
 * @param input - Theme extraction input with PRD details
 * @param complexityScore - Optional complexity score for story count guidance
 */
export async function extractThemes(
  input: ThemeExtractionInput,
  complexityScore?: { totalScore: number; targetStories: { min: number; target: number; max: number } }
): Promise<ThemeExtractionResult> {
  logger.info("Extracting themes from PRD", {
    jiraKey: input.jiraKey,
    summaryLength: input.summary?.length || 0,
    descriptionLength: input.description?.length || 0,
    complexityScore: complexityScore?.totalScore,
    targetStories: complexityScore?.targetStories,
  });

  // Format codebase context
  const fileTree = input.codebaseContext?.fileTree || "Not available";
  const techStack = input.codebaseContext?.techStack
    ? JSON.stringify(input.codebaseContext.techStack, null, 2).slice(0, 500)
    : "Not detected";
  const readmeSummary = input.codebaseContext?.readme?.slice(0, 1000) || "Not available";

  // Extract target story counts (default to moderate if not provided)
  const targetMin = complexityScore?.targetStories?.min || 6;
  const targetMax = complexityScore?.targetStories?.max || 15;
  const target = complexityScore?.targetStories?.target || 10;
  const score = complexityScore?.totalScore || 0;

  // Build prompt
  const prompt = THEME_EXTRACTION_PROMPT.replace("{{JIRA_KEY}}", input.jiraKey)
    .replace("{{SUMMARY}}", input.summary || "No summary")
    .replace("{{DESCRIPTION}}", input.description || "No description")
    .replace("{{LABELS}}", JSON.stringify(input.labels || []))
    .replace("{{FILE_TREE}}", fileTree)
    .replace("{{TECH_STACK}}", techStack)
    .replace("{{README_SUMMARY}}", readmeSummary)
    .replace("{{COMPLEXITY_SCORE}}", String(score))
    .replace("{{TARGET_MIN}}", String(targetMin))
    .replace("{{TARGET_MAX}}", String(targetMax))
    .replace(/\{\{TARGET\}\}/g, String(target));

  // Call LLM
  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model: THEME_EXTRACTION_MODEL,
    max_tokens: 4096,
    temperature: 0,
    tools: [THEME_EXTRACTION_TOOL],
    tool_choice: { type: "tool", name: "extract_themes" },
    messages: [{ role: "user", content: prompt }],
  });

  // Extract tool result
  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Theme extraction did not return tool_use response");
  }

  const result = toolUse.input as {
    themes: PlanningTheme[];
    prdRequirements: string[];
    reasoning: string;
  };

  // Validate and fix themes
  const validatedThemes = validateAndFixThemes(result.themes);

  logger.info("Themes extracted", {
    jiraKey: input.jiraKey,
    themeCount: validatedThemes.length,
    categories: validatedThemes.map((t) => t.category),
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  return {
    themes: validatedThemes,
    prdRequirements: result.prdRequirements || [],
    reasoning: result.reasoning,
  };
}

/**
 * Validate and fix extracted themes
 *
 * Note: We no longer auto-insert a foundation theme. The LLM is now guided
 * by complexity scoring to create appropriate themes based on the PRD content.
 */
function validateAndFixThemes(themes: PlanningTheme[]): PlanningTheme[] {
  const validatedThemes: PlanningTheme[] = [];

  // Process each theme
  for (const theme of themes) {
    // Validate category
    const validCategories: ThemeCategory[] = [
      "foundation",
      "core",
      "integration",
      "testing",
      "polish",
    ];
    const category = validCategories.includes(theme.category as ThemeCategory)
      ? (theme.category as ThemeCategory)
      : "core";

    // Validate personas
    const validPersonas = (theme.suggestedPersonas || []).filter((p) =>
      AVAILABLE_PERSONAS.includes(p as WorkerPersona)
    ) as WorkerPersona[];

    // Use default personas if none valid
    const personas =
      validPersonas.length > 0
        ? validPersonas
        : DEFAULT_PERSONAS_BY_CATEGORY[category];

    // Validate story count
    const storyCount = Math.max(1, Math.min(10, theme.estimatedStoryCount || 3));

    // Validate dependencies (only earlier themes)
    const validDeps = (theme.dependencies || []).filter((d) => {
      const depTheme = themes.find((t) => t.id === d);
      return depTheme && themes.indexOf(depTheme) < themes.indexOf(theme);
    });

    validatedThemes.push({
      ...theme,
      category,
      suggestedPersonas: personas,
      estimatedStoryCount: storyCount,
      dependencies: validDeps,
    });
  }

  // Sort by category order
  return validatedThemes.sort(
    (a, b) => THEME_CATEGORY_ORDER[a.category] - THEME_CATEGORY_ORDER[b.category]
  );
}

// ============================================================================
// STORY DECOMPOSITION
// ============================================================================

/**
 * Decompose a single theme into stories
 */
export async function decomposeTheme(
  input: StoryDecompositionInput
): Promise<StoryDecompositionResult> {
  const { theme, prdContext, codebaseContext, priorContext } = input;

  logger.info("Decomposing theme into stories", {
    themeId: theme.id,
    themeName: theme.name,
    category: theme.category,
    estimatedStories: theme.estimatedStoryCount,
  });

  // Format codebase context
  const fileTree = codebaseContext?.fileTree || "Not available";
  const techStack = codebaseContext?.techStack
    ? JSON.stringify(codebaseContext.techStack, null, 2).slice(0, 500)
    : "Not detected";

  // Format prior context
  let priorContextStr = "None (this is the first theme)";
  if (priorContext && (priorContext.themes.length > 0 || priorContext.stories.length > 0)) {
    const themesList = priorContext.themes
      .map((t) => `- ${t.id}: ${t.name} (${t.category})`)
      .join("\n");
    const storiesList = priorContext.stories
      .slice(-5) // Last 5 stories for context
      .map((s) => `- Story ${s.index}: ${s.title} [${s.persona}]`)
      .join("\n");
    priorContextStr = `Prior themes:\n${themesList}\n\nRecent stories:\n${storiesList}`;
  }

  // Build prompt
  const prompt = STORY_DECOMPOSITION_PROMPT.replace(/\{\{THEME_ID\}\}/g, theme.id)
    .replace("{{THEME_NAME}}", theme.name)
    .replace("{{THEME_CATEGORY}}", theme.category)
    .replace("{{THEME_DESCRIPTION}}", theme.description)
    .replace(/\{\{SUGGESTED_PERSONAS\}\}/g, theme.suggestedPersonas.join(", "))
    .replace("{{ESTIMATED_STORY_COUNT}}", String(theme.estimatedStoryCount))
    .replace(
      "{{COVERED_REQUIREMENTS}}",
      (theme.coveredRequirements || []).join("\n- ") || "See PRD description"
    )
    .replace("{{FILE_TREE}}", fileTree)
    .replace("{{TECH_STACK}}", techStack)
    .replace("{{JIRA_KEY}}", prdContext.jiraKey)
    .replace("{{SUMMARY}}", prdContext.summary || "No summary")
    .replace("{{DESCRIPTION}}", prdContext.description || "No description")
    .replace("{{PRIOR_CONTEXT}}", priorContextStr);

  // Call LLM - use Sonnet for higher quality story decomposition
  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model: STORY_DECOMPOSITION_MODEL,
    max_tokens: 8192,
    temperature: 0,
    tools: [STORY_DECOMPOSITION_TOOL],
    tool_choice: { type: "tool", name: "decompose_theme" },
    messages: [{ role: "user", content: prompt }],
  });

  // Extract tool result
  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Story decomposition did not return tool_use response");
  }

  const result = toolUse.input as {
    themeId: string;
    stories: Omit<PlannedStoryV2, "index" | "canonicalOrder" | "themeId" | "phase">[];
    reasoning: string;
  };

  // Validate and enhance stories
  const validatedStories = validateAndFixStories(result.stories, theme);

  logger.info("Theme decomposed into stories", {
    themeId: theme.id,
    storyCount: validatedStories.length,
    personas: [...new Set(validatedStories.map((s) => s.persona))],
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  return {
    themeId: theme.id,
    stories: validatedStories,
    reasoning: result.reasoning,
  };
}

/**
 * Validate and fix decomposed stories
 */
function validateAndFixStories(
  stories: Omit<PlannedStoryV2, "index" | "canonicalOrder" | "themeId" | "phase">[],
  theme: PlanningTheme
): Omit<PlannedStoryV2, "canonicalOrder">[] {
  return stories.map((story, index) => {
    // Validate persona
    let persona = story.persona as WorkerPersona;
    if (!AVAILABLE_PERSONAS.includes(persona)) {
      persona = theme.suggestedPersonas[0] || "backend_developer";
    }

    // Prefer theme's suggested personas
    if (!theme.suggestedPersonas.includes(persona)) {
      // Use first suggested persona if current is not in list
      persona = theme.suggestedPersonas[0] || persona;
    }

    // Validate story points (max 3)
    const storyPoints = Math.max(1, Math.min(3, story.storyPoints || 2));

    // Validate dependencies (within theme only)
    const validDeps = (story.dependencies || []).filter(
      (d) => typeof d === "number" && d >= 0 && d < index
    );

    // Validate target files (max 5, warn if >3)
    const targetFiles = (story.targetFiles || []).slice(0, 5);

    return {
      ...story,
      index,
      themeId: theme.id,
      phase: theme.category,
      persona,
      storyPoints,
      dependencies: validDeps,
      targetFiles,
      referenceFiles: story.referenceFiles || [],
      estimatedComplexity: story.estimatedComplexity || "medium",
    } as Omit<PlannedStoryV2, "canonicalOrder">;
  });
}

// ============================================================================
// PLAN ASSEMBLY
// ============================================================================

/**
 * Assemble final execution plan from themes and stories
 * Assigns canonical order and converts intra-theme dependencies to global indices
 */
export function assembleFinalPlan(
  themes: PlanningTheme[],
  storiesByTheme: Map<string, Omit<PlannedStoryV2, "canonicalOrder">[]>
): PlannedStoryV2[] {
  // Sort themes by category order
  const sortedThemes = [...themes].sort(
    (a, b) => THEME_CATEGORY_ORDER[a.category] - THEME_CATEGORY_ORDER[b.category]
  );

  // Flatten stories in theme order
  const allStories: PlannedStoryV2[] = [];
  const themeStartIndices = new Map<string, number>();

  for (const theme of sortedThemes) {
    const themeStories = storiesByTheme.get(theme.id) || [];
    themeStartIndices.set(theme.id, allStories.length);

    for (const story of themeStories) {
      allStories.push({
        ...story,
        canonicalOrder: allStories.length,
      });
    }
  }

  // Convert intra-theme dependencies to global indices
  for (const story of allStories) {
    const themeStart = themeStartIndices.get(story.themeId) || 0;

    // Convert local (within-theme) indices to global indices
    story.dependencies = story.dependencies.map((localDep) => themeStart + localDep);

    // Also update story.index to match canonicalOrder for consistency
    story.index = story.canonicalOrder;
  }

  // Add cross-theme dependencies based on theme dependencies
  for (const theme of sortedThemes) {
    if (theme.dependencies.length === 0) continue;

    const themeStories = allStories.filter((s) => s.themeId === theme.id);
    if (themeStories.length === 0) continue;

    // First story in theme depends on last story of each dependency theme
    const firstStory = themeStories[0];
    for (const depThemeId of theme.dependencies) {
      const depThemeStories = allStories.filter((s) => s.themeId === depThemeId);
      if (depThemeStories.length > 0) {
        const lastDepStory = depThemeStories[depThemeStories.length - 1];
        if (!firstStory.dependencies.includes(lastDepStory.index)) {
          firstStory.dependencies.push(lastDepStory.index);
        }
      }
    }
  }

  logger.info("Final plan assembled", {
    themeCount: sortedThemes.length,
    storyCount: allStories.length,
    phases: [...new Set(allStories.map((s) => s.phase))],
  });

  return allStories;
}

/**
 * Create a default foundation story for when theme extraction fails
 */
export function createDefaultFoundationStory(): PlannedStoryV2 {
  return {
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
}

/**
 * Create a default foundation theme
 */
export function createDefaultFoundationTheme(): PlanningTheme {
  return {
    id: "T0",
    name: "Documentation & Architecture",
    category: "foundation",
    description: "Document the architecture and implementation approach",
    suggestedPersonas: ["tech_writer"],
    estimatedStoryCount: 1,
    dependencies: [],
  };
}
