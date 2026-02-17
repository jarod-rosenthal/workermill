/**
 * Build Planner Service
 *
 * Uses the SAME planning logic as real workloads with Opus 4.6.
 * Runs asynchronously: creates a task, streams logs via DB → SSE,
 * stores the plan when done. Same experience users will have throughout.
 */

import { spawn } from "child_process";
import type { StackTemplate } from "../config/stack-templates.js";
import { logger } from "../utils/logger.js";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask } from "../models/WorkerTask.js";
import { WorkerTaskLog } from "../models/WorkerTaskLog.js";
import { Organization } from "../models/Organization.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PlannedStoryPreview {
  index: number;
  title: string;
  description: string;
  persona: string;
  scope: string;
  acceptanceCriteria: string[];
  dependencies: number[];
  storyPoints: number;
  targetFiles: string[];
  estimatedComplexity: "small" | "medium" | "large";
}

export interface TechStackPreview {
  language: string;
  framework: string;
  styling?: string;
  database?: string;
  testing?: string;
  buildTool?: string;
  rationale: string;
}

export interface FullPlanPreview {
  strategy: "single" | "multi";
  reasoning: string;
  stories: PlannedStoryPreview[];
  techStack: TechStackPreview;
  qualityGates: string[];
}

export interface PreviewResult {
  plan: FullPlanPreview;
  summary: {
    storyCount: number;
    personas: string[];
    techStackList: string[];
    reasoning: string;
  };
  complexity: {
    score: number;
    dimensions: {
      features: number;
      layers: number;
      files: number;
      clarity: number;
    };
  };
  estimatedCost: {
    local: number;
    byok: number;
    cloud: number;
  };
  estimatedDuration: number;
}

// ─── Planning Prompt (same structure as production planning-agent.ts) ────────

const GREENFIELD_PLANNING_PROMPT = `You are a technical planning agent for WorkerMill. Analyze this project description and create a full execution plan.

***REMOVED******REMOVED*** CRITICAL: This is a GREENFIELD project (no existing codebase)

You are planning a brand-new project from scratch. There is no existing repository.
Design the architecture, choose the tech stack, and break the work into executable stories.

***REMOVED******REMOVED*** Available Personas

| Persona | Expertise | Use When |
|---------|-----------|----------|
| backend_developer | APIs, databases, server logic, auth | Creating/modifying backend services |
| frontend_developer | UI, components, styling, client JS | Building web user interfaces |
| mobile_developer_android | Android, Kotlin, React Native | Android or React Native mobile apps |
| mobile_developer_ios | iOS, Swift, SwiftUI, React Native | iOS or React Native mobile apps |
| devops_engineer | Infrastructure, CI/CD, deployment | Infrastructure changes |
| qa_engineer | Testing, E2E, test automation | Dedicated testing phase needed |
| security_engineer | Auth, encryption, vulnerability fixes | Security-critical features |
| api_developer | REST, GraphQL, OpenAPI, SDKs | API design and implementation |
| database_administrator | PostgreSQL, MySQL, migrations, indexing | Database schema, optimization |
| data_engineer | ETL, pipelines, Kafka, dbt, Airflow | Data pipelines and transformations |
| ml_engineer | ML/AI, TensorFlow, PyTorch, LLMs | Machine learning features |
| tech_writer | Documentation, READMEs, API docs | Documentation deliverables |

***REMOVED******REMOVED*** Planning Rules

- Analyze the project and create as many stories as needed to fully implement it
- **CRITICAL: Each story MUST be ≤3 story points** (optimized for parallel execution)
- Each story should modify ≤3 files
- Order by dependencies (foundation → backend → frontend, etc.)

***REMOVED******REMOVED*** Dependency Rules - CREATE NATURAL FLOW

**CRITICAL: The dependency graph must flow naturally. Tasks should chain together logically.**

Good patterns:
- **Foundation → Features**: Story 0 (project setup + models) → Story 1-3 (features using models)
- **Backend → Frontend**: Story 1 (API) → Story 2 (UI that calls API)

**Every story (except the very first) should have at least one dependency.**
Multiple stories CAN depend on the same story (fan-out for parallel execution).

***REMOVED******REMOVED*** Acceptance Criteria Guidelines (CRITICAL)

Each acceptance criterion MUST be:
- **SPECIFIC**: Include exact endpoints, field names, status codes
- **TESTABLE**: Can be verified with a concrete test
- **MEASURABLE**: Include quantities where applicable

***REMOVED******REMOVED*** Story Sizing

| Points | Scope | Files | Example |
|--------|-------|-------|---------|
| 1 | Single file, trivial change | 1 | Fix typo, add field |
| 2 | Single file, clear logic | 1-2 | Add validation, simple endpoint |
| 3 | Multi-file, clear pattern | 2-3 | Feature with model + route |

***REMOVED******REMOVED*** Tech Stack Decisions (MANDATORY)

You MUST specify techStack with at least: language, framework, rationale.

***REMOVED******REMOVED*** Project to Plan

**Title:** {{TITLE}}

**Description:**
{{DESCRIPTION}}

{{STACK_CONSTRAINT}}

***REMOVED******REMOVED*** Output Instructions

**Respond with ONLY valid JSON (no markdown code blocks, no explanation).**

{
  "strategy": "multi",
  "reasoning": "string - architectural approach and key decisions",
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
      "persona": "backend_developer|frontend_developer|...",
      "scope": "string - detailed description of what to implement",
      "acceptanceCriteria": ["criterion1", "criterion2"],
      "dependencies": [],
      "storyPoints": 1-3,
      "targetFiles": ["file1.ts"],
      "estimatedComplexity": "small|medium|large"
    }
  ]
}

Now analyze the project and output your execution plan as JSON.`;

// ─── Helper: Post a log to the DB ──────────────────────────────────────────

async function postLog(taskId: string, message: string, type: "info" | "system" | "claude_output" = "info") {
  try {
    const logRepo = AppDataSource.getRepository(WorkerTaskLog);
    await logRepo.save(
      logRepo.create({
        taskId,
        type,
        message,
        severity: "info",
      }),
    );
  } catch (err) {
    logger.error("Failed to post preview log", { taskId, error: String(err) });
  }
}

// ─── Create Preview Task ────────────────────────────────────────────────────

/**
 * Create a preview task in the DB and kick off Opus 4.6 planning async.
 * Returns the task ID immediately — frontend subscribes to SSE for progress.
 */
export async function createPreviewTask(
  description: string,
  title: string,
  stackTemplate?: StackTemplate,
): Promise<{ previewId: string }> {
  const taskRepo = AppDataSource.getRepository(WorkerTask);

  const task = taskRepo.create({
    orgId: Organization.PLATFORM_ORG_ID,
    summary: title,
    description,
    status: "planning",
    workerPersona: "project_manager",
    workerModel: "claude-opus-4-6",
    scmProvider: "github",
    executionMode: "parallel",
    pipelineVersion: "v2",
    retryCount: 0,
    maxRetries: 0,
    isPlatformTask: true,
    jiraFields: {
      buildPagePreview: true,
      stackTemplate: stackTemplate?.id ?? null,
    },
  });

  await taskRepo.save(task);

  logger.info("Build preview task created", { taskId: task.id });

  // Kick off planning async — don't await
  runPlanningAsync(task.id, title, description, stackTemplate).catch((err) => {
    logger.error("Build preview planning failed", {
      taskId: task.id,
      error: String(err),
    });
  });

  return { previewId: task.id };
}

// ─── Async Planning ─────────────────────────────────────────────────────────

async function runPlanningAsync(
  taskId: string,
  title: string,
  description: string,
  stackTemplate?: StackTemplate,
) {
  const taskRepo = AppDataSource.getRepository(WorkerTask);

  await postLog(taskId, "🚀 Planning agent starting...", "system");
  await postLog(taskId, `📋 Project: ${title}`, "info");
  await postLog(taskId, `🤖 Model: claude-opus-4-6`, "info");

  const stackConstraint = stackTemplate
    ? `***REMOVED******REMOVED*** Stack Template Constraint\nYou MUST use the **${stackTemplate.name}** technology stack (${stackTemplate.description}). Design all stories around this stack.`
    : "";

  const prompt = GREENFIELD_PLANNING_PROMPT
    .replace("{{TITLE}}", title)
    .replace("{{DESCRIPTION}}", description)
    .replace("{{STACK_CONSTRAINT}}", stackConstraint);

  await postLog(taskId, "📐 Analyzing project requirements...", "info");

  try {
    const text = await runClaudeCliWithLogs(taskId, prompt, "claude-opus-4-6");

    await postLog(taskId, "✅ Plan generation complete, validating...", "info");

    // Parse the plan
    const parsed = extractJsonFromText(text);

    if (!parsed || !parsed.stories || !Array.isArray(parsed.stories)) {
      await postLog(taskId, "❌ Failed to parse plan output", "info");
      await taskRepo.update(taskId, { status: "failed" });
      return;
    }

    // Validate and normalize
    const plan = validatePlan(parsed);

    // Build summary
    const personas = [...new Set(plan.stories.map((s) => s.persona))];
    const techStackList: string[] = [
      plan.techStack.language,
      plan.techStack.framework,
      plan.techStack.styling,
      plan.techStack.database,
      plan.techStack.testing,
      plan.techStack.buildTool,
    ].filter((t): t is string => !!t && t !== "none" && t !== "n/a" && t !== "unknown");

    const storyCount = plan.stories.length;
    const totalStoryPoints = plan.stories.reduce((sum, s) => sum + s.storyPoints, 0);
    const layerCount = personas.length >= 3 ? 3 : personas.length >= 2 ? 2 : 1;
    const totalFiles = plan.stories.reduce((sum, s) => sum + s.targetFiles.length, 0);
    const fileDim = totalFiles > 10 ? 3 : totalFiles > 4 ? 2 : 1;
    const featureDim = storyCount > 12 ? 3 : storyCount > 6 ? 2 : 1;
    const totalScore = featureDim + layerCount + fileDim + 1;

    const baseCostPerPoint = 0.40;
    const byokCost = totalStoryPoints * baseCostPerPoint;

    const result: PreviewResult = {
      plan: {
        strategy: plan.strategy,
        reasoning: plan.reasoning,
        stories: plan.stories,
        techStack: plan.techStack,
        qualityGates: plan.qualityGates,
      },
      summary: {
        storyCount,
        personas,
        techStackList,
        reasoning: plan.reasoning,
      },
      complexity: {
        score: totalScore,
        dimensions: { features: featureDim, layers: layerCount, files: fileDim, clarity: 1 },
      },
      estimatedCost: {
        local: 0,
        byok: Math.round(byokCost * 100) / 100,
        cloud: Math.round(byokCost * 1.5 * 100) / 100,
      },
      estimatedDuration: Math.max(10, storyCount * 5),
    };

    // Store result and transition to completed
    await taskRepo.update(taskId, {
      status: "completed",
      planJson: result as never,
    });

    await postLog(
      taskId,
      `✅ Plan ready: ${storyCount} stories, ${personas.length} experts, ${techStackList.join(", ")}`,
      "system",
    );

    logger.info("Build preview completed", { taskId, storyCount, personas });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await postLog(taskId, `❌ Planning failed: ${msg}`, "info");
    await taskRepo.update(taskId, { status: "failed" });
    logger.error("Build preview planning error", { taskId, error: msg });
  }
}

// ─── Claude CLI with progress logs ──────────────────────────────────────────

function runClaudeCliWithLogs(
  taskId: string,
  prompt: string,
  model: string,
): Promise<string> {
  const claudePath =
    process.env.CLAUDE_CLI_PATH || "/home/user/.local/bin/claude";

  return new Promise((resolve, reject) => {
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDE_CODE_OAUTH_TOKEN;
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;

    const child = spawn(
      claudePath,
      ["--print", "--model", model, "-p", prompt],
      { env: cleanEnv, stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    let lastLogTime = 0;
    const phases = [
      { chars: 500, msg: "📝 Analyzing architecture and tech stack..." },
      { chars: 2000, msg: "🏗️ Decomposing into stories..." },
      { chars: 5000, msg: "📋 Writing acceptance criteria..." },
      { chars: 10000, msg: "🔗 Building dependency graph..." },
      { chars: 15000, msg: "✨ Finalizing plan..." },
    ];
    let nextPhase = 0;

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();

      // Post progress logs based on output size
      const now = Date.now();
      if (now - lastLogTime > 3000 && nextPhase < phases.length && stdout.length >= phases[nextPhase].chars) {
        lastLogTime = now;
        postLog(taskId, phases[nextPhase].msg, "info");
        nextPhase++;
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Claude CLI timed out after 300s"));
    }, 300_000);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        logger.error("Claude CLI failed", { code, stderr, stdoutLen: stdout.length });
        reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
        return;
      }
      resolve(stdout);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Claude CLI spawn failed: ${err.message}`));
    });
  });
}

// ─── Get preview result ─────────────────────────────────────────────────────

/**
 * Get the preview result for a given preview task ID.
 * Returns null if not ready yet.
 */
export async function getPreviewResult(
  previewId: string,
): Promise<{ status: string; result?: PreviewResult } | null> {
  const taskRepo = AppDataSource.getRepository(WorkerTask);
  const task = await taskRepo.findOne({ where: { id: previewId } });

  if (!task) return null;

  // Check this is actually a build preview task
  const jf = task.jiraFields as Record<string, unknown> | null;
  if (!jf?.buildPagePreview) return null;

  if (task.status === "completed" && task.planJson) {
    return {
      status: "completed",
      result: task.planJson as unknown as PreviewResult,
    };
  }

  return { status: task.status };
}

// ─── Plan validation ────────────────────────────────────────────────────────

function validatePlan(parsed: Record<string, unknown>): {
  strategy: "single" | "multi";
  reasoning: string;
  stories: PlannedStoryPreview[];
  techStack: TechStackPreview;
  qualityGates: string[];
} {
  const stories: PlannedStoryPreview[] = (
    parsed.stories as Record<string, unknown>[]
  ).map((s, i) => ({
    index: typeof s.index === "number" ? s.index : i,
    title: String(s.title || `Story ${i}`),
    description: String(s.description || ""),
    persona: String(s.persona || "backend_developer"),
    scope: String(s.scope || s.description || ""),
    acceptanceCriteria: Array.isArray(s.acceptanceCriteria)
      ? s.acceptanceCriteria.map(String)
      : [],
    dependencies: Array.isArray(s.dependencies)
      ? s.dependencies.filter((d): d is number => typeof d === "number")
      : [],
    storyPoints: Math.min(3, Math.max(1, Number(s.storyPoints) || 2)),
    targetFiles: Array.isArray(s.targetFiles)
      ? s.targetFiles.map(String)
      : [],
    estimatedComplexity: (
      ["small", "medium", "large"].includes(String(s.estimatedComplexity))
        ? s.estimatedComplexity
        : "medium"
    ) as "small" | "medium" | "large",
  }));

  // Fix forward dependencies
  const fixedStories = stories.map((story) => ({
    ...story,
    dependencies: story.dependencies.filter((dep) => dep < story.index),
  }));

  const rawTs = parsed.techStack as Record<string, unknown> | undefined;
  const techStack: TechStackPreview = rawTs
    ? {
        language: String(rawTs.language || "typescript"),
        framework: String(rawTs.framework || "unknown"),
        styling: rawTs.styling ? String(rawTs.styling) : undefined,
        database: rawTs.database ? String(rawTs.database) : undefined,
        testing: rawTs.testing ? String(rawTs.testing) : undefined,
        buildTool: rawTs.buildTool ? String(rawTs.buildTool) : undefined,
        rationale: String(rawTs.rationale || ""),
      }
    : {
        language: "typescript",
        framework: "unknown",
        rationale: "No tech stack specified",
      };

  const qualityGates = Array.isArray(parsed.qualityGates)
    ? parsed.qualityGates.map(String)
    : ["Type check passes", "Tests pass", "No lint errors"];

  return {
    strategy: (String(parsed.strategy) as "single" | "multi") || "multi",
    reasoning: String(parsed.reasoning || ""),
    stories: fixedStories,
    techStack,
    qualityGates,
  };
}

// ─── JSON extraction ────────────────────────────────────────────────────────

/**
 * Extract a balanced JSON object from a string starting at the given position.
 */
function extractBalancedJson(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { if (inString) escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.substring(start, i + 1);
    }
  }
  return null;
}

function extractJsonFromText(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text.trim());
  } catch {
    // Continue
  }

  // Find ```json fence and extract balanced JSON
  const jsonFenceStart = text.indexOf("```json");
  if (jsonFenceStart !== -1) {
    const braceStart = text.indexOf("{", jsonFenceStart + 7);
    if (braceStart !== -1) {
      const extracted = extractBalancedJson(text, braceStart);
      if (extracted) {
        try { return JSON.parse(extracted); } catch { /* Continue */ }
      }
    }
  }

  // Find raw JSON from first {
  const braceStart = text.indexOf("{");
  if (braceStart !== -1) {
    const extracted = extractBalancedJson(text, braceStart);
    if (extracted) {
      try { return JSON.parse(extracted); } catch { /* Continue */ }
    }
  }

  return null;
}
