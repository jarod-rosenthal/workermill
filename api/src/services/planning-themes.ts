/**
 * Planning Themes Service
 *
 * Handles theme extraction and per-theme story decomposition.
 * Uses multiple LLM calls for better quality on complex PRDs.
 *
 * V5: Action-anchored theme extraction. Themes now own explicit action indices.
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
import { PRDAction } from "./planning-inventory.js";

// Model for planning operations - Sonnet 4.6 for high-quality planning
export const THEME_EXTRACTION_MODEL = "claude-sonnet-4-6";
export const STORY_DECOMPOSITION_MODEL = "claude-sonnet-4-6";

// ============================================================================
// THEME EXTRACTION TOOL
// ============================================================================

const THEME_EXTRACTION_TOOL: Anthropic.Tool = {
  name: "extract_themes",
  description:
    "Extract logical themes from a PRD and assign actions to each theme. Each theme groups related actions and maps to a development phase.",
  input_schema: {
    type: "object" as const,
    properties: {
      themes: {
        type: "array",
        description: "3-8 themes extracted from the PRD, ordered by category. EVERY action must be assigned to exactly one theme.",
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
            // V5: Action ownership - CRITICAL for deterministic story generation
            ownedActionIds: {
              type: "array",
              items: { type: "string" },
              description: "Action IDs (ACT-XX) that belong to this theme. EVERY action from the input list MUST appear in exactly one theme's ownedActionIds.",
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
            "ownedActionIds", // V5: Now required
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
        description: "Brief explanation of how themes were determined and actions assigned",
      },
    },
    required: ["themes", "prdRequirements", "reasoning"],
  },
};

const THEME_EXTRACTION_PROMPT = `You are a technical planning agent. Your job is to CLUSTER actions into themes.

***REMOVED******REMOVED*** YOUR TASK (V5 - ACTION CLUSTERING)

**CRITICAL: You are NOT inventing work. You are GROUPING the actions provided below into logical themes.**

The actions below are the ONLY work to be done. Each action must be assigned to exactly one theme.

***REMOVED******REMOVED*** ACTION LIST (YOUR INPUT - ASSIGN THESE TO THEMES)

{{ACTION_LIST}}

**Total Actions: {{ACTION_COUNT}}**

***REMOVED******REMOVED*** RULES FOR ACTION ASSIGNMENT

1. **EVERY action MUST appear in exactly one theme's ownedActionIds**
2. **Do NOT invent new work** - Only reference action IDs from the list above
3. **Do NOT leave actions unassigned** - The sum of all ownedActionIds across themes must equal {{ACTION_COUNT}}
4. **Group related actions together** - Actions from the same source (journey, endpoint, UI) often belong together

***REMOVED******REMOVED*** STORY COUNT CONSTRAINT (CRITICAL)

**HARD LIMIT: Total stories across ALL themes = {{TARGET}} (range: {{TARGET_MIN}}-{{TARGET_MAX}})**

**MATH: Each theme MUST have at least 1 story, so:**
- **Maximum {{TARGET}} themes allowed** (1 theme = 1 story minimum)
- If you create N themes, sum of estimatedStoryCount MUST equal {{TARGET}}
- {{ACTION_COUNT}} actions ÷ {{TARGET}} stories = ~{{ACTIONS_PER_STORY_GLOBAL}} actions per story
- Cluster aggressively - it's OK to have many actions per story

***REMOVED******REMOVED*** THEME CATEGORIES (in execution order)

| Category | Description | Action Types |
|----------|-------------|--------------|
| **foundation** | Data models, schemas | DATA_MUTATION, entity creation |
| **core** | Main feature development | API_CALL, UI_INTERACTION, SYSTEM_PROCESS |
| **integration** | External services, wiring | INTEGRATION_CALL |
| **testing** | E2E tests, QA validation | Validation actions |
| **polish** | Optimizations (optional) | Performance-related actions |

***REMOVED******REMOVED*** DEPENDENCY RULES

1. **First theme has no dependencies** - Usually foundation with schema actions
2. **Every other theme MUST depend on at least one prior theme**
3. **Actions that use entities depend on themes that create entities**
4. **UI actions depend on API actions** - frontend themes depend on backend themes

***REMOVED******REMOVED*** AVAILABLE PERSONAS

${AVAILABLE_PERSONAS.map((p) => `- ${p}`).join("\n")}

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

***REMOVED******REMOVED*** OUTPUT

Call the extract_themes tool with:
1. **themes**: Array of 1-{{TARGET}} themes (CRITICAL: cannot exceed {{TARGET}} because each theme needs at least 1 story)
2. **prdRequirements**: Requirements extracted from the PRD
3. **reasoning**: How you grouped actions into themes and ensured story count = {{TARGET}}

**VALIDATION (WILL BE CHECKED):**
- Union of all themes' ownedActionIds must equal the input action IDs
- No action ID can appear in multiple themes
- No action ID can be missing
- Sum of estimatedStoryCount across all themes MUST equal {{TARGET}}
- Number of themes MUST NOT exceed {{TARGET}}`;

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
              description:
                "Role assignment: what portion of the ticket this expert owns. Do NOT rewrite ticket requirements — the worker reads the original ticket as its spec.",
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
            providesEntities: {
              type: "array",
              items: { type: "string" },
              description:
                "Entity IDs this story CREATES or MODIFIES. Use the exact IDs from the entity list (e.g., ENT-0, ENT-1).",
            },
            requiresEntities: {
              type: "array",
              items: { type: "string" },
              description:
                "Entity IDs this story NEEDS to exist before running. Use exact IDs from the entity list.",
            },
            entityAction: {
              type: "string",
              enum: ["create", "update"],
              description: "Whether this story creates new entities or updates existing ones",
            },
            coveredActionIds: {
              type: "array",
              items: { type: "string" },
              description:
                "V5: Action IDs (ACT-XX) this story implements. EVERY action from the theme's ownedActionIds MUST appear in exactly one story's coveredActionIds.",
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
            "coveredActionIds", // V5: Now required for action-anchored decomposition
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

***REMOVED******REMOVED*** YOUR TASK (V5 - ACTION CLUSTERING)

**CRITICAL: You are NOT inventing work. You are GROUPING the actions below into stories.**

Each story is a CLUSTER of related actions. Every action must be assigned to exactly one story.

***REMOVED******REMOVED*** THEME TO DECOMPOSE

**Theme ID:** {{THEME_ID}}
**Theme Name:** {{THEME_NAME}}
**Category:** {{THEME_CATEGORY}}
**Description:** {{THEME_DESCRIPTION}}
**Suggested Personas:** {{SUGGESTED_PERSONAS}}
**Expected Stories:** {{ESTIMATED_STORY_COUNT}}
**Covered Requirements:** {{COVERED_REQUIREMENTS}}

***REMOVED******REMOVED*** ACTIONS TO CLUSTER (YOUR INPUT)

**These are the ONLY actions to implement. Group them into stories.**

{{THEME_ACTION_LIST}}

**Total Actions: {{THEME_ACTION_COUNT}}**

***REMOVED******REMOVED*** SCOPE FIELD — ROLE ASSIGNMENT, NOT SPEC REWRITE

The \`scope\` field tells the worker what portion of the ticket they own. Do NOT rewrite the ticket requirements — workers read the original ticket as their spec.

**GOOD scope (role assignment):**
- "Own the API endpoints and database migrations for this feature"
- "Handle all frontend components and state management"
- "Set up CI/CD pipeline and deployment configuration"

**BAD scope (spec rewrite — DO NOT DO THIS):**
- "Create a REST API with POST /users endpoint that accepts name, email fields and returns 201..."
- "Build a React form with email validation using Zod schema..."

***REMOVED******REMOVED*** ACTION CLUSTERING RULES

**CRITICAL: Create EXACTLY {{ESTIMATED_STORY_COUNT}} stories. No more, no less.**

1. **TARGET: {{ESTIMATED_STORY_COUNT}} stories** - This is your constraint, not a suggestion
2. **{{THEME_ACTION_COUNT}} actions ÷ {{ESTIMATED_STORY_COUNT}} stories = ~{{ACTIONS_PER_STORY}} actions per story**
3. **EVERY action MUST appear in exactly one story's coveredActionIds**
4. **Group related actions together** - Actions on same file/endpoint should cluster
5. **It's OK to have large stories** - If you have 50 actions and target 2 stories, each story gets ~25 actions

***REMOVED******REMOVED*** VALIDATION (WILL BE CHECKED)

- Union of all stories' coveredActionIds must equal the theme's actions
- No action ID can appear in multiple stories
- No action ID can be missing

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

***REMOVED******REMOVED*** DEPENDENCY RULES - MAXIMIZE PARALLELISM

**CRITICAL: Stories should only depend on stories that produce artifacts they literally need. Independent work streams should have \`dependencies: []\`.**

- Dependencies are INDICES within this theme (0, 1, 2, etc.)
- Stories touching different parts of the codebase (backend vs frontend, different services) should be independent
- Only add a dependency when a story cannot proceed without another story's output
- **FAN-IN PATTERN**: When a final integration story needs work from multiple parallel stories, include ALL dependencies

Good pattern (parallel work):
- Story 0: Backend API endpoints - dependencies: []
- Story 1: Frontend components - dependencies: []
- Story 2: Integration and wiring - dependencies: [0, 1]

Good pattern (minimal foundation + fan-out):
- Story 0: Database schema (2-3 files) - dependencies: []
- Story 1: API endpoints - dependencies: [0]
- Story 2: Frontend components - dependencies: []  ← no backend dependency needed to build UI
- Story 3: Integration - dependencies: [1, 2]  ← MUST include BOTH parallel stories!

Bad pattern (serialized chain):
- Story 0: Foundation (10+ files) - dependencies: []  ← TOO BIG, blocks everything
- Story 1: API work - dependencies: [0]
- Story 2: UI work - dependencies: [1]  ← WRONG! Doesn't actually need API to build components

Bad pattern (missing fan-in):
- Story 0: Setup - dependencies: []
- Story 1: API work - dependencies: [0]
- Story 2: Data work - dependencies: [0]
- Story 3: Integration - dependencies: [1]  ← WRONG! Missing [2], leaves Story 2 orphaned!

***REMOVED******REMOVED*** CANONICAL ENTITY IDs (V4 - IMPORTANT)

**You MUST reference entities using their exact IDs from this list.**

{{ENTITY_LIST}}

For each story, specify:
- **providesEntities**: Entity IDs this story CREATES or MODIFIES (use exact IDs like ENT-0, ENT-1)
- **requiresEntities**: Entity IDs this story NEEDS to exist before it can run
- **entityAction**: "create" if making new entities, "update" if modifying existing ones

Example:
- Story 0 creates User schema: providesEntities: ["ENT-0"], entityAction: "create"
- Story 1 adds auth to User: providesEntities: ["ENT-0"], requiresEntities: ["ENT-0"], entityAction: "update"
- Story 2 creates API using User: requiresEntities: ["ENT-0"]

This enables deterministic dependency resolution and prevents missing/broken dependencies.

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
 * V5: Now accepts actions to enable action-anchored theme extraction.
 * When actions are provided, themes must assign all actions via ownedActionIds.
 *
 * @param input - Theme extraction input with PRD details
 * @param complexityScore - Optional complexity score for story count guidance
 * @param actions - Optional V5 action registry for action-anchored extraction
 */
export async function extractThemes(
  input: ThemeExtractionInput,
  complexityScore?: { totalScore: number; targetStories: { min: number; target: number; max: number } },
  actions?: PRDAction[]
): Promise<ThemeExtractionResult> {
  const hasActions = actions && actions.length > 0;

  logger.info("Extracting themes from PRD", {
    jiraKey: input.jiraKey,
    summaryLength: input.summary?.length || 0,
    descriptionLength: input.description?.length || 0,
    complexityScore: complexityScore?.totalScore,
    targetStories: complexityScore?.targetStories,
    v5ActionCount: hasActions ? actions.length : 0,
  });

  // Format codebase context
  const fileTree = input.codebaseContext?.fileTree || "Not available";
  const techStack = input.codebaseContext?.techStack
    ? JSON.stringify(input.codebaseContext.techStack, null, 2).slice(0, 500)
    : "Not detected";

  // Extract target story counts (default to moderate if not provided)
  const targetMin = complexityScore?.targetStories?.min || 6;
  const targetMax = complexityScore?.targetStories?.max || 15;
  const target = complexityScore?.targetStories?.target || 10;

  // V5: Build action list for prompt
  const actionList = hasActions
    ? formatActionListForPrompt(actions)
    : "**No actions provided - using legacy theme extraction mode**";
  const actionCount = hasActions ? actions.length : 0;

  // Calculate actions per story globally for the prompt
  const actionsPerStoryGlobal = actionCount > 0 && target > 0 ? Math.ceil(actionCount / target) : 0;

  // Build prompt with action placeholders
  const prompt = THEME_EXTRACTION_PROMPT.replace("{{JIRA_KEY}}", input.jiraKey)
    .replace("{{SUMMARY}}", input.summary || "No summary")
    .replace("{{DESCRIPTION}}", input.description || "No description")
    .replace("{{LABELS}}", JSON.stringify(input.labels || []))
    .replace("{{FILE_TREE}}", fileTree)
    .replace("{{TECH_STACK}}", techStack)
    .replace("{{ACTION_LIST}}", actionList)
    .replace(/\{\{ACTION_COUNT\}\}/g, String(actionCount))
    .replace(/\{\{ACTIONS_PER_STORY_GLOBAL\}\}/g, String(actionsPerStoryGlobal))
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
  let validatedThemes = validateAndFixThemes(result.themes);

  // V5: Validate and resolve action assignments
  if (hasActions) {
    validatedThemes = validateAndResolveActionAssignments(validatedThemes, actions);
  }

  // Enforce global story count target
  validatedThemes = enforceStoryCountTarget(validatedThemes, target);

  logger.info("Themes extracted", {
    jiraKey: input.jiraKey,
    themeCount: validatedThemes.length,
    categories: validatedThemes.map((t) => t.category),
    totalEstimatedStories: validatedThemes.reduce((sum, t) => sum + t.estimatedStoryCount, 0),
    targetStories: target,
    actionsCovered: hasActions
      ? validatedThemes.reduce((sum, t) => sum + (t.ownedActionIds?.length || 0), 0)
      : "N/A",
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
 * Format action list for the theme extraction prompt.
 * Creates a compact but readable list of actions with their metadata.
 */
function formatActionListForPrompt(actions: PRDAction[]): string {
  const lines: string[] = [];

  // Group by source type for readability
  const bySource: Record<string, PRDAction[]> = {};
  for (const action of actions) {
    const source = action.sourceItemType;
    if (!bySource[source]) bySource[source] = [];
    bySource[source].push(action);
  }

  for (const [source, sourceActions] of Object.entries(bySource)) {
    lines.push(`\n***REMOVED******REMOVED******REMOVED*** ${source.toUpperCase()} Actions`);
    for (const action of sourceActions) {
      const implicit = action.isImplicit ? " [implicit]" : "";
      const subsystem = action.subsystem ? ` (${action.subsystem})` : "";
      lines.push(`- **${action.id}** [${action.type}]: ${action.description}${implicit}${subsystem}`);
    }
  }

  return lines.join("\n");
}

/**
 * Validate that all actions are assigned to exactly one theme,
 * and resolve ownedActionIds to ownedActionIndices.
 */
function validateAndResolveActionAssignments(
  themes: PlanningTheme[],
  actions: PRDAction[]
): PlanningTheme[] {
  // Build action ID to index map
  const actionIdToIndex = new Map<string, number>();
  for (let i = 0; i < actions.length; i++) {
    actionIdToIndex.set(actions[i].id, i);
  }

  // Track assigned actions
  const assignedActionIds = new Set<string>();
  const duplicateAssignments: string[] = [];
  const unknownActionIds: string[] = [];

  // Process each theme
  const resolvedThemes = themes.map((theme) => {
    const ownedIds = theme.ownedActionIds || [];
    const ownedIndices: number[] = [];

    for (const actionId of ownedIds) {
      // Check for duplicates
      if (assignedActionIds.has(actionId)) {
        duplicateAssignments.push(`${actionId} (duplicate in ${theme.id})`);
        continue;
      }

      // Check if action exists
      const index = actionIdToIndex.get(actionId);
      if (index === undefined) {
        unknownActionIds.push(`${actionId} in ${theme.id}`);
        continue;
      }

      assignedActionIds.add(actionId);
      ownedIndices.push(index);
    }

    return {
      ...theme,
      ownedActionIndices: ownedIndices,
    };
  });

  // Find unassigned actions
  const unassignedActions = actions
    .filter((a) => !assignedActionIds.has(a.id))
    .map((a) => a.id);

  // Log validation results
  if (duplicateAssignments.length > 0) {
    logger.warn("V5: Duplicate action assignments detected", { duplicateAssignments });
  }
  if (unknownActionIds.length > 0) {
    logger.warn("V5: Unknown action IDs referenced by themes", { unknownActionIds });
  }
  if (unassignedActions.length > 0) {
    logger.warn("V5: Actions not assigned to any theme", {
      count: unassignedActions.length,
      unassignedActions: unassignedActions.slice(0, 10), // First 10
    });

    // Auto-assign unassigned actions to the most appropriate theme (mutates in-place)
    autoAssignOrphanActions(resolvedThemes, unassignedActions, actions, actionIdToIndex);
  }

  const totalAssigned = resolvedThemes.reduce(
    (sum, t) => sum + (t.ownedActionIndices?.length || 0),
    0
  );

  logger.info("V5: Action assignment validation complete", {
    totalActions: actions.length,
    totalAssigned,
    coveragePercent: Math.round((totalAssigned / actions.length) * 100),
  });

  return resolvedThemes;
}

/**
 * Auto-assign orphan actions to appropriate themes based on action type.
 * Mutates themes in-place, adding orphan actions to the most appropriate theme.
 */
function autoAssignOrphanActions(
  themes: PlanningTheme[],
  orphanIds: string[],
  actions: PRDAction[],
  actionIdToIndex: Map<string, number>
): void {
  // Build a map of orphan actions by ID
  const orphanActions = new Map<string, PRDAction>();
  for (const action of actions) {
    if (orphanIds.includes(action.id)) {
      orphanActions.set(action.id, action);
    }
  }

  // Try to assign orphans to matching themes by category
  const categoryPriority: Record<string, ThemeCategory[]> = {
    DATA_MUTATION: ["foundation", "core"],
    API_CALL: ["core", "integration"],
    UI_INTERACTION: ["core", "polish"],
    SYSTEM_PROCESS: ["core", "testing"],
    INTEGRATION_CALL: ["integration", "core"],
  };

  for (const [actionId, action] of orphanActions) {
    const preferredCategories = categoryPriority[action.type] || ["core"];
    let assigned = false;

    for (const category of preferredCategories) {
      const theme = themes.find((t) => t.category === category);
      if (theme) {
        const index = actionIdToIndex.get(actionId);
        if (index !== undefined) {
          if (!theme.ownedActionIds) theme.ownedActionIds = [];
          if (!theme.ownedActionIndices) theme.ownedActionIndices = [];
          theme.ownedActionIds.push(actionId);
          theme.ownedActionIndices.push(index);
          assigned = true;
          logger.debug("V5: Auto-assigned orphan action", {
            actionId,
            toTheme: theme.id,
            category,
          });
          break;
        }
      }
    }

    // If still not assigned, add to last theme
    if (!assigned) {
      const lastTheme = themes[themes.length - 1];
      const index = actionIdToIndex.get(actionId);
      if (index !== undefined) {
        if (!lastTheme.ownedActionIds) lastTheme.ownedActionIds = [];
        if (!lastTheme.ownedActionIndices) lastTheme.ownedActionIndices = [];
        lastTheme.ownedActionIds.push(actionId);
        lastTheme.ownedActionIndices.push(index);
      }
    }
  }
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

    // Validate personas (system personas checked here, custom personas allowed through)
    const validPersonas = (theme.suggestedPersonas || []).filter((p) =>
      (AVAILABLE_PERSONAS as readonly string[]).includes(p) || p.startsWith("custom_")
    );

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

/**
 * Enforce the global story count target by redistributing estimatedStoryCount.
 *
 * Stories are allocated proportionally based on each theme's action count to
 * prevent "monolith" stories. If a theme has so many actions that 1 story would
 * exceed the danger threshold (2x expected), it gets additional stories.
 *
 * Key principle: It's better to slightly exceed the target than to create monoliths.
 */
function enforceStoryCountTarget(themes: PlanningTheme[], target: number): PlanningTheme[] {
  if (themes.length === 0 || target <= 0) return themes;

  const totalActions = themes.reduce((sum, t) => sum + (t.ownedActionIds?.length || 0), 0);
  const expectedPerStory = target > 0 ? totalActions / target : 45;

  // Danger threshold: 2x expected actions per story (matches validatePlanCoverage)
  const maxActionsPerStory = Math.ceil(expectedPerStory * 2);

  // Calculate minimum stories needed per theme to avoid monoliths
  const minStoriesPerTheme = themes.map(t => {
    const actions = t.ownedActionIds?.length || 0;
    if (actions === 0) return 1;
    if (actions <= maxActionsPerStory) return 1;
    // Theme needs multiple stories to stay under danger threshold
    return Math.ceil(actions / maxActionsPerStory);
  });

  const minTotal = minStoriesPerTheme.reduce((a, b) => a + b, 0);

  // If minimum required exceeds target, use minimum to prevent monoliths
  if (minTotal > target) {
    logger.warn("Exceeding target to prevent monoliths - allocating by action count", {
      target,
      minRequired: minTotal,
      expectedPerStory: Math.round(expectedPerStory),
      maxActionsPerStory,
      themes: themes.map((t, i) => ({
        id: t.id,
        actions: t.ownedActionIds?.length || 0,
        minStories: minStoriesPerTheme[i],
      })),
    });
    return themes.map((t, i) => ({ ...t, estimatedStoryCount: minStoriesPerTheme[i] }));
  }

  // If we have room to spare, distribute proportionally
  if (minTotal < target) {
    const extraStories = target - minTotal;
    const newCounts = [...minStoriesPerTheme];

    // Distribute extra stories to themes with most actions
    const sortedIndices = themes
      .map((t, i) => ({ index: i, actions: t.ownedActionIds?.length || 0 }))
      .sort((a, b) => b.actions - a.actions);

    for (let i = 0; i < extraStories; i++) {
      newCounts[sortedIndices[i % sortedIndices.length].index]++;
    }

    const newSum = newCounts.reduce((a, b) => a + b, 0);
    logger.info("Story count distributed proportionally by action count", {
      target,
      newSum,
      expectedPerStory: Math.round(expectedPerStory),
      distribution: themes.map((t, i) => ({
        id: t.id,
        actions: t.ownedActionIds?.length || 0,
        stories: newCounts[i],
      })),
    });

    return themes.map((t, i) => ({ ...t, estimatedStoryCount: newCounts[i] }));
  }

  // Exactly at target with minimum allocation
  logger.info("Story count matches target with minimum allocation", {
    target,
    distribution: themes.map((t, i) => ({
      id: t.id,
      actions: t.ownedActionIds?.length || 0,
      stories: minStoriesPerTheme[i],
    })),
  });

  return themes.map((t, i) => ({ ...t, estimatedStoryCount: minStoriesPerTheme[i] }));
}

// ============================================================================
// STORY DECOMPOSITION
// ============================================================================

/**
 * Decompose a single theme into stories
 *
 * V5: When themeActions is provided, decomposition becomes action clustering.
 * Each story must specify coveredActionIds to ensure complete coverage.
 */
export async function decomposeTheme(
  input: StoryDecompositionInput
): Promise<StoryDecompositionResult> {
  const { theme, prdContext, codebaseContext, priorContext, inventory, themeActions } = input;

  const hasActions = themeActions && themeActions.length > 0;

  logger.info("Decomposing theme into stories", {
    themeId: theme.id,
    themeName: theme.name,
    category: theme.category,
    estimatedStories: theme.estimatedStoryCount,
    hasInventory: !!inventory,
    entityCount: inventory?.entities?.length || 0,
    v5ActionCount: hasActions ? themeActions.length : 0,
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

  // Format entity list for V4 canonical ID pattern
  let entityListStr = "No entities defined in inventory (skip entity fields)";
  if (inventory?.entities && inventory.entities.length > 0) {
    entityListStr = inventory.entities
      .map((entity, idx) => {
        const id = entity.id || `ENT-${idx}`;
        return `[${id}] ${entity.name}`;
      })
      .join("\n");
  }

  // V5: Format action list for theme
  const actionListStr = hasActions
    ? formatThemeActionsForPrompt(themeActions)
    : "**No actions provided - using legacy decomposition mode**";
  const actionCount = hasActions ? themeActions.length : 0;

  // Calculate actions per story for the prompt
  const targetStories = Math.max(1, theme.estimatedStoryCount);
  const actionsPerStory = actionCount > 0 ? Math.ceil(actionCount / targetStories) : 0;

  // Build prompt
  const prompt = STORY_DECOMPOSITION_PROMPT.replace(/\{\{THEME_ID\}\}/g, theme.id)
    .replace("{{THEME_NAME}}", theme.name)
    .replace("{{THEME_CATEGORY}}", theme.category)
    .replace("{{THEME_DESCRIPTION}}", theme.description)
    .replace(/\{\{SUGGESTED_PERSONAS\}\}/g, theme.suggestedPersonas.join(", "))
    .replace(/\{\{ESTIMATED_STORY_COUNT\}\}/g, String(targetStories))
    .replace(
      "{{COVERED_REQUIREMENTS}}",
      (theme.coveredRequirements || []).join("\n- ") || "See PRD description"
    )
    .replace("{{THEME_ACTION_LIST}}", actionListStr)
    .replace(/\{\{THEME_ACTION_COUNT\}\}/g, String(actionCount))
    .replace(/\{\{ACTIONS_PER_STORY\}\}/g, String(actionsPerStory))
    .replace("{{FILE_TREE}}", fileTree)
    .replace("{{TECH_STACK}}", techStack)
    .replace("{{JIRA_KEY}}", prdContext.jiraKey)
    .replace("{{SUMMARY}}", prdContext.summary || "No summary")
    .replace("{{DESCRIPTION}}", prdContext.description || "No description")
    .replace("{{PRIOR_CONTEXT}}", priorContextStr)
    .replace("{{ENTITY_LIST}}", entityListStr);

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
  let validatedStories = validateAndFixStories(result.stories, theme);

  // V5: Validate action coverage and auto-assign orphans
  if (hasActions) {
    validatedStories = validateAndResolveStoryCoverage(validatedStories, themeActions, theme.id);
  }

  logger.info("Theme decomposed into stories", {
    themeId: theme.id,
    storyCount: validatedStories.length,
    personas: [...new Set(validatedStories.map((s) => s.persona))],
    actionsCovered: hasActions
      ? validatedStories.reduce((sum, s) => sum + (s.coveredActionIds?.length || 0), 0)
      : "N/A",
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
 * Format theme actions for the story decomposition prompt.
 */
function formatThemeActionsForPrompt(
  actions: Array<{ id: string; description: string; type: string; subsystem?: string }>
): string {
  return actions
    .map((action) => {
      const subsystem = action.subsystem ? ` (${action.subsystem})` : "";
      return `- **${action.id}** [${action.type}]: ${action.description}${subsystem}`;
    })
    .join("\n");
}

/**
 * Validate that all theme actions are covered by stories,
 * and auto-assign orphan actions to the most appropriate story.
 */
function validateAndResolveStoryCoverage(
  stories: Omit<PlannedStoryV2, "canonicalOrder">[],
  themeActions: Array<{ id: string; description: string; type: string; subsystem?: string }>,
  themeId: string
): Omit<PlannedStoryV2, "canonicalOrder">[] {
  // Build action ID set
  const allActionIds = new Set(themeActions.map((a) => a.id));

  // Track covered actions
  const coveredActionIds = new Set<string>();
  const duplicateCoverage: string[] = [];
  const unknownActionIds: string[] = [];

  // Process each story
  for (const story of stories) {
    const covered = story.coveredActionIds || [];
    for (const actionId of covered) {
      if (!allActionIds.has(actionId)) {
        unknownActionIds.push(`${actionId} in story "${story.title}"`);
        continue;
      }
      if (coveredActionIds.has(actionId)) {
        duplicateCoverage.push(`${actionId} (duplicate in "${story.title}")`);
        continue;
      }
      coveredActionIds.add(actionId);
    }
  }

  // Find uncovered actions
  const uncoveredActions = themeActions.filter((a) => !coveredActionIds.has(a.id));

  // Log validation results
  if (duplicateCoverage.length > 0) {
    logger.warn("V5: Duplicate action coverage detected", { themeId, duplicateCoverage });
  }
  if (unknownActionIds.length > 0) {
    logger.warn("V5: Unknown action IDs in stories", { themeId, unknownActionIds });
  }
  if (uncoveredActions.length > 0) {
    logger.warn("V5: Actions not covered by any story", {
      themeId,
      count: uncoveredActions.length,
      uncoveredActions: uncoveredActions.slice(0, 5).map((a) => a.id),
    });

    // Auto-assign uncovered actions to the last story (catch-all)
    const lastStory = stories[stories.length - 1];
    if (!lastStory.coveredActionIds) {
      lastStory.coveredActionIds = [];
    }
    for (const action of uncoveredActions) {
      lastStory.coveredActionIds.push(action.id);
      logger.debug("V5: Auto-assigned uncovered action to last story", {
        actionId: action.id,
        storyTitle: lastStory.title,
      });
    }
  }

  const totalCovered = stories.reduce((sum, s) => sum + (s.coveredActionIds?.length || 0), 0);

  logger.info("V5: Story action coverage validation complete", {
    themeId,
    totalActions: themeActions.length,
    totalCovered,
    coveragePercent: Math.round((totalCovered / themeActions.length) * 100),
  });

  return stories;
}

/**
 * Validate and fix decomposed stories
 */
function validateAndFixStories(
  stories: Omit<PlannedStoryV2, "index" | "canonicalOrder" | "themeId" | "phase">[],
  theme: PlanningTheme
): Omit<PlannedStoryV2, "canonicalOrder">[] {
  return stories.map((story, index) => {
    // Validate persona (allow custom personas through, fall back for unknown ones)
    let persona: WorkerPersona = story.persona;
    if (!(AVAILABLE_PERSONAS as readonly string[]).includes(persona) && !persona) {
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
      // V4 canonical entity fields (preserved from LLM output)
      providesEntities: story.providesEntities,
      requiresEntities: story.requiresEntities,
      entityAction: story.entityAction,
    } as Omit<PlannedStoryV2, "canonicalOrder">;
  });
}

// ============================================================================
// PLAN ASSEMBLY
// ============================================================================

/**
 * Calculate the "level" of a story in the dependency graph
 * Level 0 = no dependencies, Level N = max(dependency levels) + 1
 */
function getStoryLevel(storyIndex: number, allStories: PlannedStoryV2[]): number {
  const story = allStories.find((s) => s.index === storyIndex);
  if (!story || story.dependencies.length === 0) {
    return 0;
  }
  const maxDepLevel = Math.max(
    ...story.dependencies.map((depIdx) => getStoryLevel(depIdx, allStories))
  );
  return maxDepLevel + 1;
}

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

  // Fix orphaned stories (stories that no other story depends on, except for terminal stories)
  // This implements the "fan-in" fix: if parallel stories exist, the next story should depend on ALL of them
  const dependedOn = new Set<number>();
  for (const story of allStories) {
    for (const depIdx of story.dependencies) {
      dependedOn.add(depIdx);
    }
  }

  // Find orphans: stories not depended on by anyone AND not the last story
  const lastIndex = allStories.length - 1;
  const orphans = allStories.filter(
    (s) => !dependedOn.has(s.index) && s.index !== lastIndex
  );

  if (orphans.length > 0) {
    logger.warn("Found orphaned stories, attempting to fix fan-in dependencies", {
      orphanIndices: orphans.map((o) => o.index),
    });

    // For each orphan, find the next story in order that could depend on it
    for (const orphan of orphans) {
      // Find stories that come after this orphan and have dependencies
      const candidates = allStories.filter(
        (s) => s.index > orphan.index && s.dependencies.length > 0
      );

      if (candidates.length > 0) {
        // Find the earliest candidate that's at the same level or later
        // (has a dependency that's at or after the orphan's level)
        const orphanLevel = getStoryLevel(orphan.index, allStories);

        for (const candidate of candidates) {
          const candidateLevel = getStoryLevel(candidate.index, allStories);
          // Add orphan as dependency if candidate is at a later level
          if (candidateLevel > orphanLevel && !candidate.dependencies.includes(orphan.index)) {
            candidate.dependencies.push(orphan.index);
            logger.info("Fixed orphan by adding to fan-in dependency", {
              orphanIndex: orphan.index,
              orphanTitle: orphan.title,
              addedToIndex: candidate.index,
              addedToTitle: candidate.title,
            });
            break;
          }
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
    title: "Set up database schema and data models",
    persona: "backend_developer",
    scope: "Create database migrations and TypeORM entities for the core data models",
    acceptanceCriteria: [
      "Database migration created with proper schema definitions",
      "TypeORM entities created with appropriate relationships",
      "Migration runs successfully without errors",
    ],
    dependencies: [],
    estimatedComplexity: "small",
    storyPoints: 1,
    targetFiles: ["src/db/migrations/", "src/models/"],
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
    name: "Database & Data Models",
    category: "foundation",
    description: "Set up database schema, migrations, and core data models",
    suggestedPersonas: ["backend_developer"],
    estimatedStoryCount: 1,
    dependencies: [],
  };
}
