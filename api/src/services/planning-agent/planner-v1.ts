/**
 * Planning Agent V1
 *
 * Original planning agent implementation with validation and Jira posting.
 */

import { generateText } from "ai";
import { Organization } from "../../models/Organization.js";
import { WorkerTask } from "../../models/WorkerTask.js";
import { AppDataSource } from "../../db/connection.js";
import { logger } from "../../utils/logger.js";
import { transitionJiraIssue } from "../../utils/jira.js";
import { postTicketComment } from "../../utils/ticket-comments.js";
import { enforceFileDependencies } from "../orchestrator-utils.js";
import { getValidPersonasForOrg, SYSTEM_PERSONAS } from "../persona-inference.js";
import { getProviderCredentials } from "../../config/index.js";
import type { ExecutionPlan, ComplexityScore, PlannedStory } from "./types.js";
import { DEFAULT_PLANNING_CONFIG } from "./types.js";
import { getPlanningConfig, createModel } from "./config.js";
import { calculateComplexity, formatComplexityConstraint, formatComplexityBreakdown } from "./complexity.js";
import { estimatePlanCost, addPerStoryCostEstimates } from "./cost-estimation.js";
import { fetchCodebaseContextForTask, addPlanningLog, parseExecutionPlanJson } from "./helpers.js";

const PLANNING_PROMPT = `You are a technical planning agent for WorkerMill. Analyze this PRD and create an execution plan.

## CRITICAL: COMPLEXITY CONSTRAINT

{{COMPLEXITY_CONSTRAINT}}

**YOU MUST FOLLOW THIS CONSTRAINT.** Your plan MUST align with the recommendation.

## Repository Structure and Context

This is the ACTUAL codebase you are working with. Use ONLY files that exist here.

### File Tree (2 levels)
\`\`\`
{{FILE_TREE}}
\`\`\`

### Tech Stack Detection
{{TECH_STACK}}

### Project Overview (README)
\`\`\`
{{README_SUMMARY}}
\`\`\`

**CRITICAL: targetFiles MUST be real paths from the File Tree above. Do NOT invent files.**

## Available Personas

| Persona | Specialization |
|---------|---------------|
| architect | System decomposition, task planning, architecture design |
| backend_developer | REST APIs, database, server-side logic, GraphQL, OpenAPI, query optimization |
| frontend_developer | React, TypeScript, Tailwind, UI components, accessibility |
| mobile_developer | iOS (Swift, SwiftUI), Android (Kotlin, Jetpack Compose), React Native |
| devops_engineer | Terraform, Docker, CI/CD, AWS, infrastructure |
| security_engineer | OWASP, vulnerability assessment, security auditing |
| qa_engineer | Test automation, Playwright, Jest, quality assurance |
| data_ml_engineer | ETL/ELT, data pipelines, ML model training, MLOps |
| tech_writer | Documentation, API docs, technical guides |
| tech_lead | Code review, architecture review, quality gate |
| project_manager | Task breakdown, planning, coordination |

## Planning Rules Based on Complexity

**For SINGLE-story tasks (score ≤6):**
- Use ONE persona that best fits the majority of the work
- Do NOT split into multiple stories
- If work touches multiple areas, pick the primary one

**For MULTI-story tasks (score 7+):**
- Analyze the PRD and create as many stories as needed to fully implement it
- **CRITICAL: Each story MUST be ≤3 story points** (Haiku-optimized)
- Each story should ideally modify ≤5 files (soft guideline — more is acceptable when logically cohesive, e.g. test suites or route handlers)
- Order by dependencies (backend before frontend, etc.)
- **Deployment/operational stories** (terraform apply, migrations, deploy scripts) MUST use devops_engineer persona and include exact commands to run in acceptance criteria. Writing code and deploying it should be separate stories.

## Dependency Rules - CREATE NATURAL FLOW

**CRITICAL: The dependency graph must flow naturally. Tasks should chain together logically.**

### How Dependencies Work
- Each story runs on its own branch
- Dependencies control MERGE ORDER - Story B waits for Story A to merge first
- The orchestrator merges PRs in dependency order

### CREATE NATURAL DEPENDENCY CHAINS

**The dependency graph should look like a connected flow, not isolated islands.**

Good patterns:
- **Foundation → Features**: Story 0 (models) → Story 1-3 (features using models)
- **Backend → Frontend**: Story 1 (API) → Story 2 (UI that calls API)
- **Feature → Integration**: Story 2 (gallery) → Story 3 (lightbox for gallery)

Example of GOOD dependency flow:
- Story 0: Create data models - dependencies = [] (starting point)
- Story 1: Add API endpoints - dependencies = [0] (needs models)
- Story 2: Build list page - dependencies = [1] (needs API)
- Story 3: Add detail modal - dependencies = [2] (builds on list page)

### AVOID ORPHAN STORIES

**Every story (except the very first) should have at least one dependency.**

If a story has dependencies: [], ask yourself:
- Does it really have no connection to other work?
- Should it depend on a foundation/model story?
- Is it actually part of another story?

### PARALLEL WHERE APPROPRIATE

Multiple stories CAN depend on the same story (fan-out pattern):
- Story 0: Models - dependencies = []
- Story 1: Gallery feature - dependencies = [0]
- Story 2: Search feature - dependencies = [0]
- Story 3: User settings - dependencies = [0]

This creates parallel execution while maintaining natural flow.

## Interface Contracts (CRITICAL for cross-story boundaries)

**When one story produces something another story consumes (API endpoint, data model, shared type), you MUST specify the exact interface contract in BOTH stories.**

This prevents the #1 cause of integration failures: mismatched interfaces between stories.

### How to Write Contracts

For each dependency between stories, ask: "What exact data shape crosses this boundary?"

**API contracts — specify request and response shapes:**
- Producer story scope: "Your POST /api/auth/login MUST return exactly: { token: string, expiresIn: number, refreshToken: string }"
- Consumer story scope: "POST /api/auth/login returns: { token: string, expiresIn: number, refreshToken: string } — build your client against this exact shape"

**Database model contracts — specify exact field names and types:**
- Model story scope: "User model MUST have: id (UUID PK), email (string, unique), passwordHash (string), createdAt (Date)"
- Consumer story scope: "User model has: id (UUID PK), email (string, unique), passwordHash (string), createdAt (Date)"

**Shared type contracts — specify exact TypeScript/Python types:**
- Producer story scope: "Export type UserResponse = { id: string, email: string, role: 'admin' | 'user' }"
- Consumer story scope: "Import UserResponse from story 0 — shape: { id: string, email: string, role: 'admin' | 'user' }"

### Rules
- Include the contract text in BOTH stories' scope field
- Use the interfaceContracts array to declare which stories share each contract
- If a contract changes during implementation, the expert MUST post a decision to the coordination feed

## Acceptance Criteria Guidelines (CRITICAL)

Each acceptance criterion MUST be:
- **SPECIFIC**: Include exact endpoints, field names, status codes, parameter values
- **TESTABLE**: Can be verified with a concrete test (unit test, curl request, browser test)
- **MEASURABLE**: Include quantities where applicable (e.g., "rate limited to 5 attempts per minute")

### Guidelines by Type

**API Endpoints:**
- BAD: "Login endpoint works"
- GOOD: "POST /api/auth/login accepts { email: string, password: string } and returns 200 with { token: string, expiresIn: number, refreshToken: string }"
- BAD: "Handle errors"
- GOOD: "Return 401 with { error: 'Invalid credentials', code: 'AUTH_FAILED' } when password is incorrect"
- BAD: "Rate limiting works"
- GOOD: "Return 429 after 5 failed login attempts per IP within 5 minutes; reset counter after successful login or after 1 hour"

**Frontend Components:**
- BAD: "Form looks good"
- GOOD: "Form renders with: email input (type=email), password input (type=password, character limit 128), 'Log In' button, 'Forgot Password?' link, validation error messages below each field"
- BAD: "Handles submit"
- GOOD: "On form submit: disable button, show loading spinner, POST to /api/auth/login, on success redirect to /dashboard, on error display message in red below form"
- BAD: "Works on mobile"
- GOOD: "Form is responsive: ≤480px viewport shows single-column layout, inputs are minimum 44px height (touch target), no horizontal scroll"

**Database/Data:**
- BAD: "Save user data"
- GOOD: "Create users table with: id (PK, UUID), email (unique, not null), passwordHash (bcrypt, not null), createdAt (timestamp), updatedAt (timestamp)"
- BAD: "Password is secure"
- GOOD: "Hash passwords with bcrypt (rounds=12), store only hash in database, never log password"

**Testing:**
- BAD: "Tests pass"
- GOOD: "Unit tests cover: valid email+password returns token, invalid email returns 401, missing fields returns 400, SQL injection attempt returns 400, rate limiting blocks after N attempts"
- BAD: "Integration test"
- GOOD: "E2E test: create user in DB → POST /api/auth/login with credentials → verify JWT token is valid and claims include userId"

**Infrastructure/Deployment:**
- BAD: "Infrastructure is set up"
- GOOD: "Run \`terraform apply\` in infrastructure/ directory, verify VPC created with \`aws ec2 describe-vpcs --filters Name=tag:Name,Values=my-app-prod-vpc\`, verify exit code 0"
- BAD: "Database migrated"
- GOOD: "Run \`npm run migrate\` against production database, verify all migrations applied with \`npm run migrate:status\`, zero pending migrations"

### Examples of BAD vs GOOD Criteria

**Story: Add user authentication**

❌ BAD acceptance criteria:
- "Login endpoint works"
- "Password is encrypted"
- "Tokens are created"
- "Tests pass"

✅ GOOD acceptance criteria:
- "POST /api/auth/login accepts application/json with { email, password }, validates both fields present"
- "Return 200 with { token, expiresIn: 3600, tokenType: 'Bearer' } for valid credentials"
- "Return 401 with { error: 'Invalid credentials' } for wrong password, don't leak if email exists"
- "Return 400 with { error: 'Email required' } if email missing, { error: 'Password required' } if password missing"
- "Hash passwords with bcrypt (rounds=12), never store plaintext"
- "JWT tokens expire after 1 hour (expiresIn: 3600); after expiry, POST /api/auth/refresh returns new token"
- "Unit tests: valid login, invalid password, missing email, missing password"
- "E2E test: create user → POST /api/auth/login → verify token decodes to correct userId"

## Story Sizing (CRITICAL - COST OPTIMIZATION)

**CONSTRAINT: Maximum 3 story points per story.**

All stories will execute on Haiku (cheapest model). To ensure high accuracy:
- Each story MUST be ≤3 points
- Each story should ideally modify ≤5 files (soft guideline — more is acceptable when logically cohesive, e.g. test suites or route handlers)
- Each story should have clear, unambiguous acceptance criteria (see Acceptance Criteria Guidelines above)

### Point Scale (Haiku-Optimized)

| Points | Scope | Files | Example |
|--------|-------|-------|---------|
| 1 | Single file, trivial change | 1 | Fix typo, add field |
| 2 | Single file, clear logic | 1-3 | Add validation, simple endpoint |
| 3 | Multi-file, clear pattern | 3-5 | Feature with model + route |

### Decomposition Examples

❌ BAD: "Add user authentication" (8+ points, single story)
✅ GOOD: Split with natural flow:
  - Story 0: Add User model and migration (2 pts) - dependencies: []
  - Story 1: Add login endpoint (2 pts) - dependencies: [0]
  - Story 2: Add logout endpoint (1 pt) - dependencies: [0]
  - Story 3: Add JWT middleware (2 pts) - dependencies: [1]

❌ BAD: Orphan stories with no connections:
  - Story 0: dependencies: []
  - Story 1: dependencies: []  ← WRONG: orphan, no flow
  - Story 2: dependencies: []  ← WRONG: orphan, no flow
✅ GOOD: Natural dependency flow (fan-out pattern):
  - Story 0: Build data models - dependencies: []
  - Story 1: Add API endpoints - dependencies: [0]
  - Story 2: Build list page UI - dependencies: [0]
  - Story 3: Add detail modal - dependencies: [1, 2]

## Tech Stack Decisions (MANDATORY)

**You MUST specify the techStack in your plan.** This is critical for multi-worker coordination.

### Rules for Tech Stack Selection

1. **PRD constraints take precedence.** If the PRD says "pure HTML/CSS/JS" or "no frameworks", you MUST honor that exactly.

2. **Match existing codebase.** If the repo already uses TypeScript + React, continue with that unless PRD explicitly says otherwise.

3. **Prefer existing over new.** Don't introduce new technologies unless necessary.

4. **Extract PRD constraints verbatim.** Any explicit tech requirements in the PRD (e.g., "Must use Python 3.11+", "No external dependencies") should be copied to prdConstraints array.

### Tech Stack Fields

| Field | Description | Examples |
|-------|-------------|----------|
| language | Primary language | typescript, javascript, python, rust, go |
| framework | Framework or "none" | react, express, fastapi, none, vanilla |
| styling | CSS approach (or "n/a") | tailwind, vanilla-css, css-modules, n/a |
| database | Database (or "none") | postgresql, mongodb, sqlite, none |
| testing | Test framework | jest, pytest, vitest |
| buildTool | Build tool | vite, webpack, cargo, go |
| rationale | Why these choices | "PRD specifies no frameworks", "Existing codebase uses X" |
| prdConstraints | Verbatim PRD constraints | ["No React", "Pure HTML/CSS/JS only"] |

### Examples

**PRD says "Pure HTML/CSS/JS, no frameworks":**
\`\`\`json
"techStack": {
  "language": "javascript",
  "framework": "none",
  "styling": "vanilla-css",
  "rationale": "PRD explicitly requires pure HTML/CSS/JS with no frameworks",
  "prdConstraints": ["Pure HTML/CSS/JS", "No frameworks"]
}
\`\`\`

**Existing React + TypeScript codebase:**
\`\`\`json
"techStack": {
  "language": "typescript",
  "framework": "react",
  "styling": "tailwind",
  "testing": "vitest",
  "buildTool": "vite",
  "rationale": "Continuing existing codebase patterns"
}
\`\`\`

## PRD to Analyze

**Jira Key:** {{JIRA_KEY}}
**Summary:** {{SUMMARY}}
**Description:**
{{DESCRIPTION}}

**Labels:** {{LABELS}}
**Repository:** {{REPO}}

## Complexity Analysis (Pre-Calculated)

{{COMPLEXITY_BREAKDOWN}}

## Output Instructions

**You MUST respond with ONLY a valid JSON object (no markdown code blocks, no explanation before or after).**

**CRITICAL REQUIREMENTS:**
- **techStack is MANDATORY.** You MUST include techStack with at least: language, framework, rationale.
- For PRD/Epic tickets: You MUST use strategy "multi" with a "stories" array
- The "stories" array is REQUIRED for multi-strategy - never omit it
- Each story MUST include: index, title, persona, scope, acceptanceCriteria, dependencies, storyPoints (1-3), targetFiles

Guidelines:
- **techStack decisions become BINDING CONSTRAINTS** for all workers. They CANNOT deviate from your tech choices.
- For single-persona strategy: set "strategy" to "single", include "primaryPersona", omit "stories"
- For multi-persona strategy: set "strategy" to "multi", MUST include "stories" array with at least 1 story
- **⚠️ targetFiles determines execution order.** Stories targeting the SAME FILE run sequentially. Stories targeting DIFFERENT files run in parallel.
- Always include "qualityGates" array with verification criteria

**JSON Schema:**
{
  "strategy": "single" | "multi",
  "reasoning": "string - why this strategy was chosen",
  "primaryPersona": "string - main persona",
  "qualityGates": ["gate1", "gate2"],
  "techStack": {
    "language": "typescript|python|javascript",
    "framework": "react|express|none",
    "styling": "tailwind|css-modules|vanilla-css",
    "database": "postgresql|mongodb|none",
    "testing": "vitest|jest|pytest",
    "buildTool": "vite|webpack|cargo",
    "rationale": "string"
  },
  "stories": [
    {
      "index": 0,
      "title": "string",
      "description": "string",
      "persona": "{{AVAILABLE_PERSONAS}}",
      "scope": "string",
      "acceptanceCriteria": ["criterion1", "criterion2"],
      "dependencies": [],
      "storyPoints": 1-3,
      "targetFiles": ["file1.ts"],
      "referenceFiles": ["ref1.ts"],
      "estimatedComplexity": "small|medium|large",
      "interfaceContracts": [
        { "targetStoryIndex": 2, "description": "POST /api/auth/login returns { token: string }" }
      ]
    }
  ]
}

Now analyze the PRD and output your execution plan as JSON.`;

/**
 * Run the Planning Agent on a task
 *
 * Analyzes the PRD and creates an execution plan, then stores it
 * in the task's planJson field and sets status to pending_plan_approval.
 */
export async function runPlanningAgent(task: WorkerTask): Promise<ExecutionPlan> {
  const startTime = Date.now();

  logger.info("Planning agent starting analysis", {
    taskId: task.id,
    jiraKey: task.jiraIssueKey,
  });

  // Log start - visible in dashboard
  await addPlanningLog(task.id, `🔍 Planning Agent analyzing PRD: ${task.jiraIssueKey}`);
  await addPlanningLog(task.id, `📋 Summary: ${task.summary || "No summary"}`);

  // Check for dry-run mode
  const labels = (task.jiraFields as Record<string, unknown>)?.labels;
  const isDryRun = Array.isArray(labels) && labels.includes("dry-run");

  // Transition Jira ticket to "In Progress" when planning starts
  if (task.jiraIssueKey && !isDryRun) {
    const transitioned = await transitionJiraIssue(task.orgId, task.jiraIssueKey, "In Progress");
    if (transitioned) {
      await addPlanningLog(task.id, `📌 Jira ticket transitioned to In Progress`);
    }
  } else if (task.jiraIssueKey && isDryRun) {
    await addPlanningLog(task.id, `[DRY RUN] Would transition Jira ticket to In Progress`);
  }

  // -------------------------------------------------------------------------
  // STEP 1: Calculate complexity score (LLM-based with tool_use)
  // -------------------------------------------------------------------------
  const complexity = await calculateComplexity(
    task.summary || "",
    task.description || "",
    (task.jiraFields?.labels as string[] | undefined) || [],
    task.orgId
  );

  // Accumulate complexity scoring tokens for cost tracking
  if (complexity.tokenUsage) {
    task.planningInputTokens = (task.planningInputTokens || 0) + complexity.tokenUsage.inputTokens;
    task.planningOutputTokens = (task.planningOutputTokens || 0) + complexity.tokenUsage.outputTokens;
  }

  await addPlanningLog(task.id, `📊 Complexity Analysis:`);
  if (complexity.totalScore === 0) {
    // PRD ticket - scoring was skipped
    await addPlanningLog(task.id, `   Type: PRD/Epic (scoring skipped)`);
    await addPlanningLog(task.id, `   Strategy: MULTI (unlimited stories)`);
  } else {
    await addPlanningLog(task.id, `   Score: ${complexity.totalScore}/12`);
    const storyCountDesc = complexity.maxStories === 0 ? "unlimited" : `max ${complexity.maxStories}`;
    await addPlanningLog(task.id, `   Recommendation: ${complexity.recommendation.toUpperCase()} (${storyCountDesc} stories)`);
    await addPlanningLog(task.id, `   Dimensions: F=${complexity.dimensions.features} L=${complexity.dimensions.layers} Fi=${complexity.dimensions.files} C=${complexity.dimensions.clarity}`);
  }

  logger.info("Complexity score calculated", {
    taskId: task.id,
    jiraKey: task.jiraIssueKey,
    complexity,
  });

  // -------------------------------------------------------------------------
  // STEP 2: Fetch codebase context (file tree, README, tech stack)
  // -------------------------------------------------------------------------
  let codebaseContext = {
    fileTree: "Unable to fetch (no repository context)",
    readme: null as string | null,
    techStack: null as Record<string, unknown> | null,
  };

  if (task.githubRepo) {
    await addPlanningLog(task.id, `📚 Fetching codebase context from ${task.githubRepo}...`);
    try {
      codebaseContext = await fetchCodebaseContextForTask(task.githubRepo, task.orgId);
      await addPlanningLog(task.id, `✅ Retrieved repository structure and metadata`);
    } catch (error) {
      logger.warn("Failed to fetch codebase context", {
        taskId: task.id,
        repo: task.githubRepo,
        error,
      });
      await addPlanningLog(task.id, `⚠️ Could not fetch codebase context (planning will proceed with basic info)`);
    }
  } else {
    await addPlanningLog(task.id, `⚠️ No repository specified - planning without codebase context`);
  }

  // Format tech stack info for prompt
  let techStackStr = "No tech stack detected";
  if (codebaseContext.techStack) {
    if (codebaseContext.techStack.type === "Node.js/JavaScript") {
      const deps = codebaseContext.techStack.dependencies as Record<string, unknown> | undefined;
      const devDeps = codebaseContext.techStack.devDependencies as Record<string, unknown> | undefined;
      const depKeys = deps ? Object.keys(deps).slice(0, 10).join(", ") : "";
      techStackStr = `Node.js/JavaScript project\nKey dependencies: ${depKeys}${devDeps ? " (+ dev deps)" : ""}`;
    } else if (codebaseContext.techStack.type === "Python") {
      techStackStr = `Python project (${codebaseContext.techStack.configFile as string})\nPreview: ${(codebaseContext.techStack.preview as string || "").slice(0, 200)}`;
    } else {
      techStackStr = JSON.stringify(codebaseContext.techStack, null, 2).slice(0, 500);
    }
  }

  const readmeSummary = codebaseContext.readme
    ? codebaseContext.readme.slice(0, 1500)
    : "No README found";

  // -------------------------------------------------------------------------
  // STEP 3: Build the prompt with complexity constraints and codebase context
  // -------------------------------------------------------------------------

  // Fetch available personas for this org (includes system + custom personas)
  const availablePersonas = task.orgId
    ? await getValidPersonasForOrg(task.orgId)
    : SYSTEM_PERSONAS.map((slug) => ({ slug, name: slug, isSystem: true }));
  const personaList = availablePersonas.map((p) => p.slug).join("|");

  const prompt = PLANNING_PROMPT
    .replace("{{JIRA_KEY}}", task.jiraIssueKey || "Unknown")
    .replace("{{SUMMARY}}", task.summary || "No summary")
    .replace("{{DESCRIPTION}}", task.description || "No description")
    .replace("{{LABELS}}", JSON.stringify(task.jiraFields?.labels || []))
    .replace("{{REPO}}", task.githubRepo || "Not specified")
    .replace("{{COMPLEXITY_CONSTRAINT}}", formatComplexityConstraint(complexity))
    .replace("{{COMPLEXITY_BREAKDOWN}}", formatComplexityBreakdown(complexity))
    .replace("{{FILE_TREE}}", codebaseContext.fileTree)
    .replace("{{TECH_STACK}}", techStackStr)
    .replace("{{README_SUMMARY}}", readmeSummary)
    .replace(/\{\{MAX_STORIES\}\}/g, String(complexity.maxStories))
    .replace("{{AVAILABLE_PERSONAS}}", personaList);

  // -------------------------------------------------------------------------
  // STEP 4: Get org planning config and call the AI
  // -------------------------------------------------------------------------
  const orgRepo = AppDataSource.getRepository(Organization);
  const org = await orgRepo.findOne({ where: { id: task.orgId } });
  const planningConfig = org ? getPlanningConfig(org) : DEFAULT_PLANNING_CONFIG;

  await addPlanningLog(task.id, `🤖 Calling ${planningConfig.provider}/${planningConfig.model} for PRD analysis...`);

  // Get org-specific API credentials (skip for ollama which doesn't need keys)
  const apiKey = planningConfig.provider === "ollama"
    ? ""
    : await getProviderCredentials(task.orgId, planningConfig.provider as "anthropic" | "openai" | "google");

  const model = createModel(planningConfig.provider, planningConfig.model, apiKey, planningConfig.ollamaBaseUrl);
  const response = await generateText({
    model,
    prompt,
    maxOutputTokens: 16384,
    temperature: 0,
  });

  // Post the raw LLM analysis text to dashboard logs so users can see the
  // planning agent's reasoning (codebase analysis, risk assessment, etc.).
  // Chunk by lines; cap at 10KB to avoid overwhelming the log table.
  const rawText = response.text;
  logger.info("Planning agent raw response", {
    taskId: task.id,
    responseLength: rawText.length,
    hasThinkTags: rawText.includes("<think>"),
    first500: rawText.slice(0, 500),
    last500: rawText.slice(-500),
  });
  const LOG_PREFIX = "[💡 planning_agent 🤖]";
  const MAX_LOG_BYTES = 10_000;
  let loggedBytes = 0;
  for (const line of rawText.split("\n")) {
    if (!line.trim()) continue;
    if (loggedBytes + line.length > MAX_LOG_BYTES) {
      await addPlanningLog(task.id, `${LOG_PREFIX} ... (output truncated at ${MAX_LOG_BYTES} chars)`);
      break;
    }
    await addPlanningLog(task.id, `${LOG_PREFIX} ${line}`);
    loggedBytes += line.length;
  }

  // -------------------------------------------------------------------------
  // STEP 5: Parse JSON response and validate the plan
  // -------------------------------------------------------------------------
  const plan = parseExecutionPlanJson(response.text);

  // Basic validation
  validatePlan(plan);

  // Validate against complexity constraints
  validatePlanMatchesComplexity(plan, complexity, task.id);

  // Log the plan details
  await addPlanningLog(task.id, `✅ Plan created: ${plan.strategy.toUpperCase()} strategy`);
  await addPlanningLog(task.id, `📝 Reasoning: ${plan.reasoning}`);

  if (plan.strategy === "single") {
    await addPlanningLog(task.id, `👤 Primary Persona: ${plan.primaryPersona}`);
  } else if (plan.stories && plan.stories.length > 0) {
    const maxDesc = complexity.maxStories === 0 ? "unlimited" : `${complexity.maxStories} max`;
    await addPlanningLog(task.id, `📚 Stories planned: ${plan.stories.length} (${maxDesc})`);
    for (const story of plan.stories) {
      await addPlanningLog(task.id, `  ${story.index + 1}. [${story.persona}] ${story.title}`);
    }
  }

  await addPlanningLog(task.id, `🚦 Quality Gates: ${plan.qualityGates.join(", ")}`);
  await addPlanningLog(task.id, `⏳ Awaiting plan approval...`);

  const durationMs = Date.now() - startTime;

  logger.info("Planning agent completed analysis", {
    taskId: task.id,
    jiraKey: task.jiraIssueKey,
    strategy: plan.strategy,
    primaryPersona: plan.primaryPersona,
    storyCount: plan.stories?.length || 0,
    complexityScore: complexity.totalScore,
    complexityDimensions: complexity.dimensions,
    complexityRecommendation: complexity.recommendation,
    durationMs,
    inputTokens: response.usage?.inputTokens,
    outputTokens: response.usage?.outputTokens,
  });

  // Calculate cost estimate based on the plan
  const workerModel = task.workerModel || "";
  let costEstimate = null;
  if (plan.strategy === "single") {
    // Single story with implied 2 points
    costEstimate = estimatePlanCost([{ storyPoints: 2 }], workerModel);
  } else if (plan.stories && plan.stories.length > 0) {
    costEstimate = estimatePlanCost(plan.stories, workerModel);
    // Add per-story cost estimates
    addPerStoryCostEstimates(plan.stories, workerModel);
  }

  // Log cost estimate
  if (costEstimate) {
    await addPlanningLog(
      task.id,
      `💰 Cost Estimate: ${costEstimate.totalPoints} points × $${costEstimate.costPerPoint}/pt = $${costEstimate.estimatedCost} (${costEstimate.model})`
    );
  }

  // Enforce file-based dependencies BEFORE storing the plan
  // This ensures the UI shows accurate execution order for user approval
  const validatedPlan = enforceFileDependencies(plan);

  // Log if dependencies were added
  const originalDepCount = plan.stories?.reduce((sum, s) => sum + (s.dependencies?.length || 0), 0) || 0;
  const validatedDepCount = validatedPlan.stories?.reduce((sum, s) => sum + (s.dependencies?.length || 0), 0) || 0;
  if (validatedDepCount > originalDepCount) {
    await addPlanningLog(
      task.id,
      `📋 Added ${validatedDepCount - originalDepCount} file-based dependencies to prevent conflicts`
    );
  }

  // Store the validated plan in the task (include complexity score and cost estimate)
  const taskRepo = AppDataSource.getRepository(WorkerTask);
  task.planJson = {
    ...validatedPlan,
    _complexity: complexity, // Store for audit/debugging
    _costEstimate: costEstimate, // Store cost projection
  } as unknown as Record<string, unknown>;
  task.planStatus = "pending_approval";
  task.status = "pending_plan_approval";

  // Track planning phase tokens with atomic increment + plan approval status
  const planInputTokens = response.usage?.inputTokens || 0;
  const planOutputTokens = response.usage?.outputTokens || 0;
  await AppDataSource.query(
    `UPDATE "worker_tasks"
     SET "planningInputTokens" = COALESCE("planningInputTokens", 0) + $1,
         "planningOutputTokens" = COALESCE("planningOutputTokens", 0) + $2,
         "plan_json" = $3::jsonb,
         "plan_status" = 'pending_approval',
         "status" = 'pending_plan_approval'
     WHERE "id" = $4`,
    [planInputTokens, planOutputTokens, JSON.stringify(task.planJson), task.id],
  );
  task.planningInputTokens = (task.planningInputTokens || 0) + planInputTokens;
  task.planningOutputTokens = (task.planningOutputTokens || 0) + planOutputTokens;

  // Post the validated plan to Jira (skip in dry-run mode)
  if (!isDryRun) {
    await postPlanToJira(task, validatedPlan, complexity);
  } else {
    await addPlanningLog(task.id, `[DRY RUN] Would post plan to Jira comment`);
    logger.info("[DRY RUN] Skipped posting plan to Jira", { taskId: task.id });
  }

  return plan;
}

/**
 * Format and post the execution plan to Jira
 */
async function postPlanToJira(
  task: WorkerTask,
  plan: ExecutionPlan,
  complexity: ComplexityScore
): Promise<void> {
  // Calculate cost estimate for Jira comment
  let costEstimate = null;
  if (plan.strategy === "single") {
    costEstimate = estimatePlanCost([{ storyPoints: 2 }], task.workerModel || "");
  } else if (plan.stories && plan.stories.length > 0) {
    costEstimate = estimatePlanCost(plan.stories, task.workerModel || "");
  }

  const lines: string[] = [
    "[Project Manager - Execution Plan]",
    "",
    `Complexity Score: ${complexity.totalScore}/12 (F:${complexity.dimensions.features} L:${complexity.dimensions.layers} Fi:${complexity.dimensions.files} C:${complexity.dimensions.clarity})`,
    "",
    `Strategy: ${plan.strategy.toUpperCase()} persona execution`,
    "",
    plan.reasoning,
    "",
  ];

  // Add cost estimate to Jira comment if available
  if (costEstimate) {
    lines.push(
      `💰 Estimated Cost: ${costEstimate.totalPoints} story points × $${costEstimate.costPerPoint}/pt = $${costEstimate.estimatedCost}`
    );
    lines.push("");
  }

  if (plan.strategy === "single") {
    lines.push(`Primary Persona: ${plan.primaryPersona}`);
  } else if (plan.stories && plan.stories.length > 0) {
    lines.push("Planned Stories:");
    for (const story of plan.stories) {
      const deps = story.dependencies.length > 0
        ? ` (depends on: ${story.dependencies.map(d => `Story ${d + 1}`).join(", ")})`
        : "";
      lines.push(`${story.index + 1}. [${story.persona}] ${story.title}${deps}`);
      lines.push(`   Scope: ${story.scope}`);
      lines.push(`   Complexity: ${story.estimatedComplexity}`);
    }
  }

  lines.push("");
  lines.push("Quality Gates:");
  for (const gate of plan.qualityGates) {
    lines.push(`- ${gate}`);
  }

  lines.push("");
  lines.push("⏳ Awaiting plan approval in WorkerMill dashboard...");

  const comment = lines.join("\n");

  if (task.jiraIssueKey) {
    try {
      const success = await postTicketComment(task.orgId, task.jiraIssueKey, comment);
      if (success) {
        await addPlanningLog(task.id, "📝 Posted execution plan to Jira");
      } else {
        await addPlanningLog(task.id, "⚠️ Could not post plan to Jira (non-critical)");
      }
    } catch (error) {
      logger.warn("Failed to post plan to Jira", { error, jiraKey: task.jiraIssueKey });
      await addPlanningLog(task.id, "⚠️ Could not post plan to Jira (non-critical)");
    }
  }
}

/**
 * Validate that the plan matches the complexity constraints
 *
 * If the AI ignored the constraints, we adjust the plan or warn.
 * Note: When maxStories is 0, it means unlimited (LLM determines count dynamically).
 */
async function validatePlanMatchesComplexity(
  plan: ExecutionPlan,
  complexity: ComplexityScore,
  taskId: string
): Promise<void> {
  // Check if AI followed the recommendation
  if (complexity.recommendation === "single" && plan.strategy === "multi") {
    // AI created multi-story for a simple task - just log info
    if (plan.stories) {
      logger.info("Plan chose multi-story for single recommendation", {
        taskId,
        recommendation: complexity.recommendation,
        planStrategy: plan.strategy,
        storyCount: plan.stories.length,
      });
      await addPlanningLog(taskId, `ℹ️ Note: AI chose multi-story (${plan.stories.length}) for low-complexity task`);
    }
  }

  if (complexity.recommendation === "multi" && plan.strategy === "single") {
    // AI chose single for a complex task - that's fine, it might be right
    logger.info("Plan chose single strategy for multi recommendation - accepted", {
      taskId,
      complexityScore: complexity.totalScore,
    });
  }

  // Enforce soft limit on story count (maxStories > 0 means limit is active)
  if (plan.strategy === "multi" && plan.stories && complexity.maxStories > 0) {
    if (plan.stories.length > complexity.maxStories) {
      const originalCount = plan.stories.length;
      // Truncate to the limit
      plan.stories = plan.stories.slice(0, complexity.maxStories);
      // Re-index stories after truncation
      plan.stories.forEach((story, idx) => {
        story.index = idx;
        // Remove any dependencies that now point to non-existent stories
        story.dependencies = story.dependencies.filter(dep => dep < complexity.maxStories);
      });
      logger.warn("Plan exceeded story limit, truncated", {
        taskId,
        originalCount,
        maxStories: complexity.maxStories,
        truncatedTo: plan.stories.length,
      });
      await addPlanningLog(
        taskId,
        `⚠️ Plan had ${originalCount} stories, truncated to ${complexity.maxStories} (soft limit). Add 'nolimit' label for unlimited stories.`
      );
    }
  }

  // Log story count for multi-story plans
  if (plan.strategy === "multi" && plan.stories) {
    logger.info("Multi-story plan created", {
      taskId,
      storyCount: plan.stories.length,
      maxStories: complexity.maxStories,
      complexityScore: complexity.totalScore,
    });
  }
}

// Note: parseExecutionPlan was removed - we now use tool_use which guarantees valid JSON

/**
 * Validate the execution plan
 */
export function validatePlan(plan: ExecutionPlan): void {
  // Check required fields
  if (!plan.strategy || !["single", "multi"].includes(plan.strategy)) {
    throw new Error('Plan must have strategy "single" or "multi"');
  }

  if (!plan.reasoning) {
    throw new Error("Plan must have reasoning");
  }

  if (!plan.qualityGates || !Array.isArray(plan.qualityGates)) {
    throw new Error("Plan must have qualityGates array");
  }

  // Validate based on strategy
  if (plan.strategy === "single") {
    if (!plan.primaryPersona) {
      throw new Error("Single-persona plan must have primaryPersona");
    }
    // Note: Persona validation is done later with org-specific personas
    // This is just a basic sanity check using system personas
    if (!SYSTEM_PERSONAS.includes(plan.primaryPersona as never)) {
      // Could be a custom persona - log info but don't fail
      logger.info("Persona not in system list (may be custom)", { persona: plan.primaryPersona });
    }
  } else if (plan.strategy === "multi") {
    if (!plan.stories || !Array.isArray(plan.stories) || plan.stories.length === 0) {
      throw new Error("Multi-persona plan must have stories array");
    }

    // Track all filtered dependencies for prominent logging
    const filteredDependencies: Array<{ storyIndex: number; storyTitle: string; original: number[]; filtered: number[]; removed: number[] }> = [];

    // Validate each story
    for (const story of plan.stories) {
      if (typeof story.index !== "number") {
        throw new Error("Story must have numeric index");
      }
      if (!story.title) {
        throw new Error("Story must have title");
      }
      if (!story.persona) {
        throw new Error("Story must have persona");
      }
      if (!story.acceptanceCriteria || !Array.isArray(story.acceptanceCriteria)) {
        throw new Error("Story must have acceptanceCriteria array");
      }
      if (!Array.isArray(story.dependencies)) {
        // Initialize empty dependencies if missing
        story.dependencies = [];
      }

      // Filter and validate dependencies - be lenient with AI output
      // Remove any non-numeric or invalid dependencies instead of failing
      const originalDeps = [...story.dependencies];
      const validDeps: number[] = [];
      const removedDeps: number[] = [];
      for (const dep of story.dependencies) {
        if (typeof dep === "number" && dep >= 0 && dep < plan.stories.length && dep < story.index) {
          validDeps.push(dep);
        } else {
          removedDeps.push(dep);
        }
      }

      // Track if any dependencies were filtered
      if (removedDeps.length > 0) {
        filteredDependencies.push({
          storyIndex: story.index,
          storyTitle: story.title,
          original: originalDeps,
          filtered: validDeps,
          removed: removedDeps,
        });
      }
      story.dependencies = validDeps;

      // COST-FIRST: Validate and enforce storyPoints (max 3 for Haiku)
      if (typeof story.storyPoints !== "number" || story.storyPoints < 1) {
        // Default to 2 if missing
        story.storyPoints = 2;
        logger.warn("Story missing storyPoints, defaulted to 2", {
          storyIndex: story.index,
          title: story.title,
        });
      } else if (story.storyPoints > 3) {
        // Cap at 3 and warn
        logger.warn("Story exceeds max 3 points, capping", {
          storyIndex: story.index,
          originalPoints: story.storyPoints,
          title: story.title,
        });
        story.storyPoints = 3;
      }

      // COST-FIRST: Validate targetFiles
      if (!story.targetFiles || !Array.isArray(story.targetFiles)) {
        story.targetFiles = [];
        logger.warn("Story missing targetFiles, initialized to empty", {
          storyIndex: story.index,
          title: story.title,
        });
      }

      // Initialize referenceFiles if missing
      if (!story.referenceFiles) {
        story.referenceFiles = [];
      }
    }

    // Prominent logging for any filtered dependencies
    if (filteredDependencies.length > 0) {
      logger.warn("⚠️ DEPENDENCIES FILTERED FROM PLAN - User should review", {
        totalStoriesAffected: filteredDependencies.length,
        details: filteredDependencies.map(d => ({
          story: `Story ${d.storyIndex}: ${d.storyTitle}`,
          originalDeps: d.original,
          validDeps: d.filtered,
          removedDeps: d.removed,
          reason: d.removed.map(dep => {
            if (typeof dep !== "number") return `${dep} is not a number`;
            if (dep < 0) return `${dep} is negative`;
            if (dep >= plan.stories!.length) return `${dep} >= story count (${plan.stories!.length})`;
            if (dep >= (filteredDependencies.find(f => f.storyIndex === d.storyIndex)?.storyIndex || 0)) return `${dep} >= this story's index (circular/forward ref)`;
            return `${dep} is invalid`;
          }),
        })),
      });
    }
  }
}
