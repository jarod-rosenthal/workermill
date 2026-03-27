import { streamText, generateObject, generateText, stepCountIs, type ToolSet } from "ai";
import { z } from "zod";
import { createModel, buildOllamaOptions, ensureOllamaContext } from "../../packages/engine/src/model-factory.js";
import { createToolDefinitions } from "../../packages/engine/src/tools/index.js";
import type { AIProvider } from "../../packages/engine/src/types.js";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { loadPersona } from "./personas.js";
import { formatProjectInstructions } from "./instructions.js";
import * as logger from "./logger.js";
import { CostTracker } from "./cost-tracker.js";
import type { CliConfig, HooksConfig } from "./config.js";
import { getProviderForPersona } from "./config.js";
import { runHooks } from "./hooks.js";
import {
  isGitRepo, getCurrentBranch, createFeatureBranch,
  commitStoryChanges, commitRevisionChanges,
  captureStoryPriorWork, getDiffForReview, getDiffSinceCommit,
  getHeadHash, returnToOriginalBranch,
} from "./git-ops.js";
import { loadMemories, addMemory, extractMemoryMarkers, formatMemoriesForPrompt } from "./memory.js";
import { isDangerous, READ_TOOLS } from "./safety.js";

/**
 * If the task string looks like a file path (e.g. "spec.md", "docs/prd.yaml"),
 * read the file and return its contents as the task. Otherwise return as-is.
 * This lets users do `/build spec.md` and have the planner see the full spec.
 */
function resolveTaskInput(task: string, workingDir: string): string {
  const trimmed = task.trim();
  // Check if the entire task is a single file reference (no spaces, has extension)
  if (!trimmed.includes(" ") && /\.\w{1,10}$/.test(trimmed)) {
    const fullPath = path.resolve(workingDir, trimmed);
    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      return `Implement the following specification from ${trimmed}:\n\n${content}`;
    } catch {
      // Not a readable file — pass through as-is
    }
  }
  return task;
}

export interface OrchestrationOutput {
  /** Log a message from a persona */
  log: (persona: string, message: string) => void;
  /** Log a coordinator message */
  coordinatorLog: (message: string) => void;
  /** Log an error */
  error: (message: string) => void;
  /** Show a status/spinner message (replaces ora) */
  status: (message: string) => void;
  /** Stop the spinner/status */
  statusDone: (message?: string) => void;
  /** Ask the user a yes/no question. Returns true for yes. */
  confirm: (prompt: string) => Promise<boolean | { allowed: boolean; mode?: "always" | "trust" }>;
  /** Log a tool call */
  toolCall: (persona: string, toolName: string, toolInput: Record<string, unknown>) => void;
  /** Update running cost in the UI (optional — noop if not provided) */
  updateCost?: (cost: number) => void;
}

/**
 * Memory instructions — teaches models to emit memory markers.
 */
const MEMORY_INSTRUCTIONS = `

## Memory

When you discover something specific and actionable, emit a marker to save it:

\`\`\`
::learning::The test suite requires DATABASE_URL env var or tests silently pass without running
::remember::This project uses Prisma with PostgreSQL, migrations are in prisma/migrations/
\`\`\`

**Save when you discover:**
- A non-obvious requirement (specific env vars, config files, build steps)
- A codebase convention (naming patterns, file organization, frameworks used)
- A gotcha you had to work around (unexpected failures, ordering dependencies)
- Files that must be modified together (route + model + migration + test)

**Do NOT save** generic advice like "write tests" or "handle errors properly."
Include file paths, commands, and exact details.
`;

/**
 * Docker/real services instructions — from worker/epic/executor.ts lines 420-471.
 */
const DOCKER_INSTRUCTIONS = `

## Development Environment

If this task requires databases, caches, or other services, use Docker to run real instances instead of mocking them. Do NOT mock or stub external services.

### Common Services
- PostgreSQL: \`docker run -d --rm -p 5432:5432 -e POSTGRES_PASSWORD=test --name postgres-test postgres:16-alpine\`
- Redis: \`docker run -d --rm -p 6379:6379 --name redis-test redis:7-alpine\`
- MongoDB: \`docker run -d --rm -p 27017:27017 --name mongo-test mongo:7\`
- MySQL: \`docker run -d --rm -p 3306:3306 -e MYSQL_ROOT_PASSWORD=test --name mysql-test mysql:8\`
- If the project has a \`docker-compose.yml\`, use \`docker compose up -d\`

Tests that pass against mocks but fail against real services are worthless.

### CI/CD — Always add service containers
When creating GitHub Actions CI workflows that run tests requiring databases, add \`services:\` blocks so CI has real instances. Match your local Docker setup with CI service containers.
`;

/**
 * Technology version trust — from worker/epic/executor.ts lines 473-478.
 */
const VERSION_TRUST = `

## Technology Versions — Trust the Spec

If the ticket, PRD, or task description specifies a dependency version, USE THAT VERSION. Do NOT downgrade or "fix" versions you don't recognize — your training data has a cutoff and newer releases exist. Trust the spec over your knowledge.
`;

/**
 * Ignore the internal .workermill directory — it stores sessions, logs, and
 * config. It is not part of the user's project.
 */
const IGNORE_WORKERMILL = `

## Ignored Directories

NEVER explore, read, or modify files in \`.workermill/\` — it is an internal WorkerMill system directory.

## Sandbox — Stay in the Working Directory

ALL files you create, read, or modify MUST be within the current working directory. Do NOT use /tmp, /var, /home, or any path outside the project root. Temporary files, test fixtures, build output — everything goes inside the project directory. This is non-negotiable.
`;

/**
 * Build provider-specific reasoning options — from worker/ai-clients/model-factory.ts lines 127-175.
 */
function buildReasoningOptions(provider: string, modelName: string): Record<string, unknown> {
  switch (provider) {
    case "openai":
      return { providerOptions: { openai: { reasoningSummary: "detailed" } } };
    case "google":
    case "gemini":
      if (modelName && modelName.includes("gemini-3")) {
        return { providerOptions: { google: { thinkingConfig: { thinkingLevel: "high", includeThoughts: true } } } };
      }
      return { providerOptions: { google: { thinkingConfig: { thinkingBudget: 8192, includeThoughts: true } } } };
    default:
      return {};
  }
}

/**
 * Check if an error is transient/retryable — from worker/epic/coordinator-utils.ts lines 45-66.
 */
function isTransientError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const msg = error instanceof Error ? error.message : String(error);
  if (/status code (502|503|504)|socket hang up|ECONNRESET|ETIMEDOUT|network error|ECONNREFUSED/i.test(msg)) {
    return true;
  }
  return false;
}

/**
 * Classify an error to determine if it's auto-fixable and provide fix context.
 * Pattern from worker/epic/types.ts ErrorCategory + worker-decision-engine.ts.
 */
function classifyError(errMsg: string): { category: string; fixable: boolean; fixHint: string } {
  if (/type\s?error|cannot find name|is not assignable|has no exported member|property .+ does not exist/i.test(errMsg)) {
    return { category: "typescript", fixable: true, fixHint: "Fix the TypeScript type errors shown above. Run `npx tsc --noEmit` to verify." };
  }
  if (/eslint|lint|prettier|formatting/i.test(errMsg)) {
    return { category: "lint", fixable: true, fixHint: "Fix the linting/formatting errors shown above. Run `npm run lint` to verify." };
  }
  if (/test.*fail|assertion.*error|expect\(.*\)\.to|FAIL\s+src\//i.test(errMsg)) {
    return { category: "test", fixable: true, fixHint: "Fix the failing tests shown above. Run the test command to verify." };
  }
  if (/build.*fail|compilation.*error|syntax\s?error|unexpected token|cannot find module/i.test(errMsg)) {
    return { category: "build", fixable: true, fixHint: "Fix the build/compilation errors shown above." };
  }
  if (/status code (502|503|504)|socket hang up|ECONNRESET|ETIMEDOUT|ECONNREFUSED/i.test(errMsg)) {
    return { category: "transient", fixable: false, fixHint: "" };
  }
  if (/auth|unauthorized|forbidden|401|403|api.?key/i.test(errMsg)) {
    return { category: "auth", fixable: false, fixHint: "" };
  }
  if (/rate.?limit|too many requests|429/i.test(errMsg)) {
    return { category: "rate_limit", fixable: false, fixHint: "" };
  }
  return { category: "unknown", fixable: false, fixHint: "" };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyToolDef = any;


export interface Story {
  id: string;       // Short kebab-case slug
  title: string;
  persona: string;
  description: string;
  dependsOn?: string[];  // References to other story IDs
  // Enriched fields from planner's codebase analysis
  targetFiles?: string[];      // Files to create or modify
  referenceFiles?: string[];   // Existing files to read for patterns
  implementationNotes?: string; // Planner's architectural guidance
}

interface SharedContext {
  filesCreated: string[];
  filesModified: string[];
  decisions: string[];
  learnings: string[];
}

// DANGEROUS_PATTERNS, READ_TOOLS, AUTO_EDIT_TOOLS imported from ./safety.js

/**
 * Check tool permission using output.confirm() instead of readline.
 * Mirrors the logic from PermissionManager but uses the callback-based output interface.
 */
async function checkToolPermission(
  toolName: string,
  toolInput: Record<string, unknown>,
  trustAll: boolean,
  sessionAllow: Set<string>,
  output: OrchestrationOutput,
): Promise<boolean> {
  // Dangerous command check
  if (toolName === "bash") {
    const cmd = String(toolInput.command || "");
    const danger = isDangerous(cmd);
    if (danger) {
      // Always prompt for dangerous commands — even in trust mode
      output.error(`DANGEROUS: ${danger}`);
      output.error(`Command: ${cmd}`);
      const result = await output.confirm("This is a dangerous operation. Are you sure?");
      return typeof result === "object" ? result.allowed : result;
    }
  }

  if (trustAll) return true;
  if (READ_TOOLS.has(toolName)) return true;
  if (sessionAllow.has(toolName)) return true;

  // Prompt user — supports y/a/t/n like the single-agent permission prompt
  const display = formatToolCallDisplay(toolName, toolInput);
  output.log("system", `Tool: ${toolName} -- ${display}`);
  const result = await output.confirm(`Allow ${toolName}?`);

  if (typeof result === "object") {
    if (result.mode === "trust") {
      // Trust all — add all common tools to session allow
      for (const t of ["bash", "write_file", "edit_file", "patch", "git", "fetch", "web_search"]) {
        sessionAllow.add(t);
      }
      return result.allowed;
    }
    if (result.mode === "always") {
      sessionAllow.add(toolName);
    }
    return result.allowed;
  }

  // Simple boolean response
  if (result) {
    sessionAllow.add(toolName);
  }
  return result;
}

/** Format a tool call for display (replaces the imported formatToolCall from tui.js) */
function formatToolCallDisplay(toolName: string, toolInput: Record<string, unknown>): string {
  let msg = `Tool: ${toolName}`;
  if (toolInput) {
    if (toolInput.file_path) msg += ` -> ${toolInput.file_path}`;
    else if (toolInput.path) msg += ` -> ${toolInput.path}`;
    else if (toolInput.command) msg += ` -> ${String(toolInput.command).substring(0, 500)}`;
    else if (toolInput.pattern) msg += ` -> pattern: ${toolInput.pattern}`;
    else {
      const keys = Object.keys(toolInput).slice(0, 3);
      if (keys.length > 0) {
        msg += ` -> ${keys.map(k => `${k}: ${String(toolInput[k]).substring(0, 200)}`).join(", ")}`;
      }
    }
  }
  return msg;
}

export async function classifyComplexity(
  config: CliConfig,
  userInput: string,
  output: OrchestrationOutput,
  abortSignal?: AbortSignal,
): Promise<{ isMulti: boolean; reason: string }> {
  logger.info("Classifying complexity", { input: userInput.slice(0, 200) });
  // Resolve file references before classification so "spec.md" becomes the full spec content
  const resolvedInput = resolveTaskInput(userInput, process.cwd());
  const { provider, model: modelName, apiKey, host, contextLength } = getProviderForPersona(config);

  if (apiKey) {
    const envMap: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_GENERATIVE_AI_API_KEY" };
    const envVar = envMap[provider];
    if (envVar && !process.env[envVar]) process.env[envVar] = apiKey;
  }

  const model = createModel(provider as AIProvider, modelName, host, contextLength);

  try {
    const result = await generateObject({
      model,
      abortSignal,
      schema: z.object({
        complexity: z.enum(["single", "multi"]),
        reason: z.string(),
      }),
      prompt: `Analyze this coding task. If it involves multiple distinct concerns that would benefit from different specialist personas (e.g., database + backend + frontend + devops), classify as "multi". If it's a focused task that one developer could handle, classify as "single". Just classify — do not break down into stories.

Task:
${resolvedInput}`,
    });

    return {
      isMulti: result.object.complexity === "multi",
      reason: result.object.reason,
    };
  } catch (err) {
    // Fallback to text-based classification
    try {
      const textResult = await generateText({
        model,
        abortSignal,
        prompt: `Is this task "single" (one developer) or "multi" (needs multiple specialists)? Respond with just "single" or "multi" and a brief reason.

Task: ${resolvedInput}`,
      });

      const isMulti = /\bmulti\b/i.test(textResult.text);
      return { isMulti, reason: textResult.text.slice(0, 200) };
    } catch (err2) {
      logger.debug("Classification double fallback failed", { error: err2 instanceof Error ? err2.message : String(err2) });
    }

    return { isMulti: false, reason: `Classification failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function topologicalSort(stories: Story[]): Story[] {
  const idMap = new Map(stories.map(s => [s.id, s]));
  const visited = new Set<string>();
  const result: Story[] = [];
  const visiting = new Set<string>();

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      // Circular dependency — logged via output would require passing output here,
      // but this is a pure function. The warning is non-critical so we skip it.
      return;
    }
    visiting.add(id);
    const story = idMap.get(id);
    if (story?.dependsOn) {
      for (const dep of story.dependsOn) {
        if (idMap.has(dep)) visit(dep);
      }
    }
    visiting.delete(id);
    visited.add(id);
    if (story) result.push(story);
  }

  for (const story of stories) {
    visit(story.id);
  }
  return result;
}

async function planStories(
  config: CliConfig,
  userTask: string,
  workingDir: string,
  sandboxed: boolean,
  output: OrchestrationOutput,
  abortSignal?: AbortSignal,
): Promise<{ stories: Story[]; provider: string; model: string; inputTokens: number; outputTokens: number; rejected?: boolean; rejectionReason?: string }> {
  const planner = loadPersona("planner");

  const { provider: pProvider, model: pModel, host: pHost, contextLength: pCtx } = getProviderForPersona(config, "planner");
  if (pProvider) {
    const pApiKey = config.providers[pProvider]?.apiKey;
    if (pApiKey) {
      const envMap: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_GENERATIVE_AI_API_KEY" };
      const envVar = envMap[pProvider];
      if (envVar && !process.env[envVar]) {
        const key = pApiKey.startsWith("{env:") ? process.env[pApiKey.slice(5, -1)] : pApiKey;
        if (key) process.env[envVar] = key;
      }
    }
  }

  const plannerModel = createModel(pProvider as AIProvider, pModel, pHost, pCtx);
  const plannerTools = createToolDefinitions(workingDir, plannerModel, sandboxed);

  const readOnlyTools: Record<string, AnyToolDef> = {};
  if (planner) {
    for (const toolName of planner.tools) {
      const toolDef = plannerTools[toolName as keyof typeof plannerTools] as AnyToolDef;
      if (toolDef) {
        readOnlyTools[toolName] = {
          ...toolDef,
          execute: async (input: Record<string, unknown>) => {
            output.toolCall("planner", toolName, input);
            const result = await toolDef.execute(input);
            return result;
          },
        };
      }
    }
  }

  // Detect file references in the task and read them upfront so the planner has full context
  const fileRefPattern = /(?:^|\s)([\w./-]+\.(?:md|txt|yaml|yml|json|toml|ts|js|py|go|rs|spec|requirements|prd|plan))\b/gi;
  const referencedFiles = [...new Set([...userTask.matchAll(fileRefPattern)].map(m => m[1]))];
  let inlinedFileContext = "";
  if (referencedFiles.length > 0) {
    const fs = await import("fs");
    const path = await import("path");
    for (const ref of referencedFiles) {
      const fullPath = path.default.resolve(workingDir, ref);
      try {
        const content = fs.default.readFileSync(fullPath, "utf-8");
        inlinedFileContext += `\n### File: ${ref}\n\`\`\`\n${content}\n\`\`\`\n`;
        output.log("planner", `Read referenced file: ${ref}`);
      } catch {
        // File doesn't exist or unreadable — planner can still try to read it via tools
      }
    }
  }

  const plannerProjectInstructions = formatProjectInstructions(workingDir);
  const plannerPrompt = `You are a senior architect planning an implementation. Your job is to deeply analyze the codebase, understand its patterns, and produce a plan that sets each worker up for success.
${plannerProjectInstructions}
## Task
${userTask}
${inlinedFileContext ? `\n## Referenced Files\n${inlinedFileContext}` : ""}
## Working directory
${workingDir}

## Phase 1: Deep Codebase Analysis

Use your tools to thoroughly understand the existing codebase:
${referencedFiles.length > 0 ? "The referenced files above have been inlined for you. Read any additional files you need." : ""}

1. **Read the project structure** — ls, glob to understand the layout
2. **Read key files** — package.json/pyproject.toml/go.mod for dependencies and scripts. Config files for conventions.
3. **Read existing implementations** — Find 2-3 files that are most similar to what needs to be built. Read them fully. These become reference patterns.
4. **Identify conventions** — How are models defined? How are routes structured? What's the naming convention? What ORM/framework patterns are used? What test framework?
5. **Identify risks** — Are there transactions that webhook/event dispatch must respect? Are there shared types that need updating? Are there existing tests that will break?

## Phase 2: Evaluate Feasibility

Before producing a plan, evaluate whether this task should proceed:

- **Is the spec clear enough?** If the task is too vague to produce specific file-level guidance, REJECT with a reason explaining what's missing.
- **Does it conflict with the existing codebase?** If the task asks to build something that already exists, or contradicts the project's architecture, REJECT and explain why.
- **Is it achievable?** If the task requires external services/credentials that aren't configured, or depends on things outside the repo, note these as blockers.

To REJECT a task, return:
\`\`\`json
{ "rejected": true, "reason": "The spec doesn't specify which database to use and the project has no existing database setup. Please clarify: PostgreSQL, MySQL, or SQLite?" }
\`\`\`

Only reject when proceeding would waste time. If the task is clear enough to produce specific implementation guidance, proceed.

## Phase 3: Produce the Plan

Design a plan with the MINIMUM number of stories:
- ONE persona = ONE story (only split if there's a genuine dependency gate)
- Aim for 5 stories or fewer — combine same-persona work
- Stories run SEQUENTIALLY in the same directory — later stories see earlier output
- Overlapping files between stories are fine

## Output Format

Return a JSON code block. The \`implementationNotes\` field is THE KEY VALUE YOU ADD — it carries your architectural analysis directly to the worker so they don't have to rediscover what you already learned.

\`\`\`json
{
  "stories": [
    {
      "id": "short-kebab-case-id",
      "title": "Brief title",
      "persona": "persona_name",
      "description": "Scope: which files/directories this story owns and what area it covers.",
      "targetFiles": ["src/models/webhook.py", "src/routers/webhooks.py"],
      "referenceFiles": ["src/models/product.py", "src/routers/products.py"],
      "implementationNotes": "Follow the pattern in product.py for the model — use SQLAlchemy declarative with UUID primary key, org_id foreign key, and created_at timestamp. The router should mirror products.py structure: admin-only endpoints using get_current_admin dependency. Use FastAPI BackgroundTasks for async webhook delivery — do NOT dispatch inside the database transaction. The existing audit logger in middleware.py can be extended for delivery tracking.",
      "dependsOn": ["id-of-dependency"]
    }
  ]
}
\`\`\`

**implementationNotes must include:**
- Which existing files to use as patterns and WHY
- Specific framework/ORM patterns to follow (with details from what you read)
- Integration points with existing code (exact function names, imports, patterns)
- Risks or gotchas you discovered while reading the code
- Do NOT be generic ("follow best practices") — be specific ("use the Depends(get_db) pattern from dependencies.py")

**Workers receive the full spec separately.** Do not rewrite the spec in descriptions or notes. Focus on HOW to implement within THIS codebase, not WHAT to implement.

Available personas: backend_developer, frontend_developer, devops_engineer, qa_engineer, security_engineer, data_ml_engineer, mobile_developer, tech_writer, tech_lead`;

  logger.info("Planner started", { provider: pProvider, model: pModel });
  output.log("planner", `Starting planning agent using \x1b[36m${pProvider}/${pModel}\x1b[0m`);
  output.status("Planner reading repository...");

  // Heartbeat — show elapsed time so users know it's still working
  const planStart = Date.now();
  const heartbeat = setInterval(() => {
    const elapsed = Math.floor((Date.now() - planStart) / 1000);
    output.status(`Planner working... (${elapsed}s)`);
  }, 5_000);

  // Use onStepFinish — same pattern as worker/ai-clients/ai-sdk-client.ts
  const planStream = streamText({
    model: plannerModel,
    abortSignal,
    system: planner?.systemPrompt || "You are an implementation planner.",
    prompt: plannerPrompt,
    tools: readOnlyTools as ToolSet,
    stopWhen: stepCountIs(100),
    timeout: { chunkMs: 120_000 },
    ...buildOllamaOptions(pProvider as AIProvider, pCtx),
    onStepFinish() {
      // Text already streamed line-by-line below — just update status between steps
      output.status("planner: thinking...");
    },
  });
  // Stream planner output line-by-line as it arrives
  let planText = "";
  let planUsage: { inputTokens?: number; outputTokens?: number } | undefined;
  try {
    let lineBuffer = "";
    for await (const chunk of planStream.textStream) {
      if (abortSignal?.aborted) break;
      lineBuffer += chunk;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || ""; // keep incomplete last line in buffer
      for (const line of lines) {
        if (line.trim()) {
          output.log("planner", line);
        }
      }
    }
    if (lineBuffer.trim()) {
      output.log("planner", lineBuffer);
    }
    planText = await planStream.text;
    planUsage = await planStream.totalUsage;
  } catch (planErr) {
    clearInterval(heartbeat);
    output.statusDone();
    if (abortSignal?.aborted) {
      logger.info("Planner cancelled by user");
      output.coordinatorLog("Build cancelled by user.");
      return { stories: [], provider: pProvider, model: pModel, inputTokens: 0, outputTokens: 0, rejected: true, rejectionReason: "Cancelled" };
    }
    const msg = planErr instanceof Error ? planErr.message : String(planErr);
    logger.error("Planner failed", { error: msg });
    output.error(`Planner failed: ${msg}`);
    return {
      stories: [],
      provider: pProvider,
      model: pModel,
      inputTokens: 0,
      outputTokens: 0,
      rejected: true,
      rejectionReason: msg,
    };
  }
  clearInterval(heartbeat);

  // Check for planner rejection before parsing stories
  const rejectionMatch = planText.match(/"rejected"\s*:\s*true[\s\S]*?"reason"\s*:\s*"([^"]+)"/);
  if (rejectionMatch) {
    const reason = rejectionMatch[1];
    logger.info("Planner rejected task", { reason });
    output.coordinatorLog(`Planner rejected: ${reason}`);
    output.error(`Task rejected by planner: ${reason}`);
    return {
      stories: [],
      provider: pProvider,
      model: pModel,
      inputTokens: planUsage?.inputTokens || 0,
      outputTokens: planUsage?.outputTokens || 0,
      rejected: true,
      rejectionReason: reason,
    };
  }

  let stories = parseStoriesFromText(planText, output);

  logger.info("Planner completed", { storiesFound: stories.length, planTextLength: planText.length });

  if (stories.length === 0) {
    logger.error("Planner produced no stories", { planTextPreview: planText.slice(0, 500) });
    output.error("Planner failed to produce a plan. This could be a rate limit, API error, or the task was too vague.");
    output.log("system", "Check the planner provider is configured and has available quota. Use /setup to change providers.");
    return {
      stories: [],
      provider: pProvider,
      model: pModel,
      inputTokens: planUsage?.inputTokens || 0,
      outputTokens: planUsage?.outputTokens || 0,
      rejected: true,
      rejectionReason: "Planner produced no output",
    };
  }

  return {
    stories,
    provider: pProvider,
    model: pModel,
    inputTokens: planUsage?.inputTokens || 0,
    outputTokens: planUsage?.outputTokens || 0,
  };
}

/** Parse stories JSON from planner output text */
function parseStoriesFromText(text: string, output: OrchestrationOutput): Story[] {
  // Strategy 1: JSON code block (```json ... ```)
  // Use greedy match and try multiple code blocks if first fails
  const codeBlocks = [...text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/g)];
  for (const match of codeBlocks) {
    const stories = tryParseStories(match[1].trim());
    if (stories) return stories;
  }

  // Strategy 2: Find JSON object with "stories" key using bracket matching
  const storiesIdx = text.indexOf('"stories"');
  if (storiesIdx !== -1) {
    // Walk back to find the opening {
    let braceStart = text.lastIndexOf("{", storiesIdx);
    if (braceStart !== -1) {
      const json = extractBalancedJSON(text, braceStart);
      if (json) {
        const stories = tryParseStories(json);
        if (stories) return stories;
      }
    }
  }

  // Strategy 3: Find any JSON array containing objects with "persona"
  const arrayStart = text.indexOf("[");
  if (arrayStart !== -1 && text.indexOf('"persona"') !== -1) {
    const json = extractBalancedJSON(text, arrayStart);
    if (json) {
      const stories = tryParseStories(json);
      if (stories) return stories;
    }
  }

  // Strategy 4: Try parsing the entire text as JSON
  const stories = tryParseStories(text.trim());
  if (stories) return stories;

  // Log what we couldn't parse for debugging
  const preview = text.slice(0, 500);
  output.log("system", `(planner output preview: ${preview}${text.length > 500 ? "..." : ""})`);

  return [];
}

/** Try to parse text as a stories array or object containing stories */
function normalizeStory(raw: Record<string, unknown>, index: number): Story {
  return {
    id: String(raw.id || raw.index || raw.step || raw.number || index + 1),
    title: String(raw.title || raw.name || raw.summary || ""),
    persona: String(raw.persona || raw.role || raw.agent || "backend_developer"),
    description: String(raw.description || raw.details || raw.task || raw.title || ""),
    dependsOn: Array.isArray(raw.dependsOn) ? raw.dependsOn.map(String)
      : Array.isArray(raw.depends_on) ? raw.depends_on.map(String)
      : Array.isArray(raw.dependencies) ? raw.dependencies.map(String)
      : undefined,
  };
}

function tryParseStories(text: string): Story[] | null {
  try {
    const parsed = JSON.parse(text);
    let rawStories: Record<string, unknown>[] | null = null;

    if (Array.isArray(parsed) && parsed.length > 0 && (parsed[0].persona || parsed[0].role || parsed[0].agent)) {
      rawStories = parsed;
    } else if (parsed && Array.isArray(parsed.stories) && parsed.stories.length > 0) {
      rawStories = parsed.stories;
    } else if (parsed && Array.isArray(parsed.steps) && parsed.steps.length > 0) {
      rawStories = parsed.steps;
    } else if (parsed && Array.isArray(parsed.plan) && parsed.plan.length > 0) {
      rawStories = parsed.plan;
    }

    if (rawStories) {
      return rawStories.map((s, i) => normalizeStory(s, i));
    }
  } catch {
    // Not valid JSON — caller will try other parsing strategies
  }
  return null;
}

/** Extract a balanced JSON structure starting at the given index */
function extractBalancedJSON(text: string, start: number): string | null {
  const open = text[start];
  const close = open === "{" ? "}" : open === "[" ? "]" : null;
  if (!close) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === open) depth++;
    if (ch === close) {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null; // Unbalanced
}

/**
 * Extract quality score from reviewer output.
 * Returns a 1-10 score. Handles both CODE_QUALITY_SCORE (1-10) and
 * legacy ::review_score:: (0-100, converted to 1-10).
 */
function extractScore(text: string): number {
  // 1. CODE_QUALITY_SCORE: N (1-10 scale) — preferred format
  const cqsMatches = [...text.matchAll(/CODE_QUALITY_SCORE:\s*(\d+)/gi)];
  if (cqsMatches.length > 0) {
    const n = parseInt(cqsMatches[cqsMatches.length - 1][1], 10);
    return Math.max(1, Math.min(10, n));
  }

  // 2. Legacy ::review_score:: (0-100) — convert to 1-10
  const markerMatches = [...text.matchAll(/::review_score::(\d+)/g)];
  if (markerMatches.length > 0) {
    const n = parseInt(markerMatches[markerMatches.length - 1][1], 10);
    return Math.max(1, Math.min(10, Math.round(n / 10)));
  }

  // 3. Fallback from decision text
  if (/\bapprove/i.test(text)) return 8;
  if (/\brevis/i.test(text)) return 5;

  return 7; // No score found — default to decent
}

/**
 * Parse AFFECTED_STORIES from reviewer output for selective revision.
 * Copied from worker/epic/inline-reviewer.ts parseAffectedStories().
 */
function parseAffectedStories(text: string): { stories: number[]; reasons: Record<number, string> } | null {
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
      // Reasons JSON is malformed — non-critical, continue without reasons
    }
  }

  return { stories, reasons };
}

export async function runOrchestration(
  config: CliConfig,
  userTask: string,
  trustAll: boolean,
  sandboxed: boolean,
  output: OrchestrationOutput,
  abortSignal?: AbortSignal,
): Promise<void> {
  // Resolve file references so "/build spec.md" becomes the full spec content
  userTask = resolveTaskInput(userTask, process.cwd());

  // Ensure Ollama models are loaded with the correct context length
  const defaultProvider = getProviderForPersona(config);
  if (defaultProvider.provider === "ollama" || config.providers[defaultProvider.provider]?.host) {
    const host = defaultProvider.host || config.providers[defaultProvider.provider]?.host || "http://localhost:11434";
    const ctx = config.providers[defaultProvider.provider]?.contextLength;
    if (ctx) {
      await ensureOllamaContext(host, defaultProvider.model, ctx);
    }
  }

  const costTracker = new CostTracker();
  const persistedMemories = loadMemories();
  const context: SharedContext = {
    filesCreated: [],
    filesModified: [],
    decisions: [],
    learnings: [],
  };
  context.learnings.push(...persistedMemories.filter(m => m.type === "learning").map(m => m.content));
  const sessionAllow = new Set<string>();
  const workingDir = process.cwd();

  // Create feature branch for isolation — matches worker/epic/git-ops.ts pattern.
  // All story commits go on this branch. If cancelled, user can git checkout back.
  const originalBranch = getCurrentBranch(workingDir);
  // Use the spec filename for the branch name if one was referenced, otherwise the task text
  const fileRefForBranch = userTask.match(/[\w./-]+\.(?:md|txt|yaml|yml|json)\b/i);
  const branchLabel = fileRefForBranch ? fileRefForBranch[0] : userTask;
  const featureBranch = createFeatureBranch(workingDir, branchLabel, config.git?.branchPrefix);
  if (featureBranch) {
    output.coordinatorLog(`Working on branch: ${featureBranch}`);
  }
  const mainBranch = originalBranch || "main";

  // Planner explores codebase and produces stories
  const planResult = await planStories(config, userTask, workingDir, sandboxed, output, abortSignal);

  // Track planner cost
  costTracker.addUsage("Planner", planResult.provider, planResult.model, planResult.inputTokens, planResult.outputTokens);
  output.updateCost?.(costTracker.getTotalCost());

  // Handle planner rejection — task is too vague, contradictory, or infeasible
  if (planResult.rejected) {
    output.log("system", `The planner determined this task should not proceed: ${planResult.rejectionReason || "unspecified reason"}`);
    output.log("system", "Refine your spec and try again.");
    return;
  }

  const plannerStories = planResult.stories;

  // Show the plan — WorkerMill format
  output.log("planner", `Plan generated: ${plannerStories.length} stories`);
  plannerStories.forEach((s, i) => {
    output.log("planner", `Story ${i + 1}: [${s.persona}] ${s.title}${s.dependsOn?.length ? ` (after: ${s.dependsOn.join(", ")})` : ""}`);
    if (s.targetFiles?.length) output.log("planner", `  files: ${s.targetFiles.join(", ")}`);
    if (s.referenceFiles?.length) output.log("planner", `  patterns: ${s.referenceFiles.join(", ")}`);
    if (s.implementationNotes) output.log("planner", `  guidance: ${s.implementationNotes.split("\n")[0].slice(0, 120)}...`);
  });
  output.log("planner", `Plan ready: ${plannerStories.length} stories queued for execution.`);

  // Optional critic pass (--critic or config.review.useCritic)
  if (config.review?.useCritic) {
    const critic = loadPersona("critic");
    if (critic) {
      const { provider: cProvider, model: cModel, host: cHost, contextLength: cCtx } = getProviderForPersona(config, "critic");
      const criticModel = createModel(cProvider as AIProvider, cModel, cHost, cCtx);
      const criticTools = createToolDefinitions(workingDir, criticModel, sandboxed);
      const criticReadOnly: Record<string, AnyToolDef> = {};
      for (const name of critic.tools) {
        const toolDef = criticTools[name as keyof typeof criticTools] as AnyToolDef;
        if (toolDef) {
          criticReadOnly[name] = {
            ...toolDef,
            execute: async (input: Record<string, unknown>) => {
              output.log("critic", formatToolCallDisplay(name, input));
              const result = await toolDef.execute(input);
              return result;
            },
          };
        }
      }

      output.status("Critic reviewing plan...");
      const criticStream = streamText({
        model: criticModel,
        abortSignal,
        system: critic.systemPrompt,
        prompt: `Review this implementation plan. Score it 1-10 using CODE_QUALITY_SCORE: N marker.\n\nStories:\n${plannerStories.map(s => `- ${s.id}: ${s.title} (${s.persona}) — ${s.description}`).join("\n")}`,
        tools: criticReadOnly as ToolSet,
        stopWhen: stepCountIs(100),
        timeout: { chunkMs: 120_000 },
        ...buildOllamaOptions(cProvider as AIProvider, cCtx),
      });
      for await (const _chunk of criticStream.textStream) { /* drive */ }
      const criticText = await criticStream.text;
      output.statusDone();

      const score = extractScore(criticText);
      output.log("critic", `::review_score::${score}`);
      const criticThreshold = config.review?.criticThreshold ?? 8;
      output.log("critic", score >= criticThreshold ? "Plan approved" : "Plan needs revision");
        }
  }

  // Ensure every story has a unique ID (some planners output stories without IDs)
  const seenIds = new Set<string>();
  for (let i = 0; i < plannerStories.length; i++) {
    if (!plannerStories[i].id || seenIds.has(plannerStories[i].id)) {
      plannerStories[i].id = `${i + 1}-${(plannerStories[i].title || "story").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`;
    }
    seenIds.add(plannerStories[i].id);
  }

  // Sort by dependencies
  const sorted = topologicalSort(plannerStories);
  logger.info("Topological sort result", { input: plannerStories.length, output: sorted.length, ids: sorted.map(s => s.id) });

  // Prompt user to proceed (unless --trust mode)
  if (!trustAll) {
    let proceed = false;
    try {
      const r = await output.confirm("Execute this plan?");
      proceed = typeof r === "object" ? r.allowed : r;
    } catch (err) {
      logger.debug("Plan confirmation failed", { error: err instanceof Error ? err.message : String(err) });
    }
    if (!proceed) {
      output.log("system", "Plan cancelled.");
      return;
    }
    }

  // Track failed and blocked stories — matches worker/epic/coordinator-stories.ts pattern
  const failedStories = new Set<string>();
  const skippedStories = new Set<string>();

  for (let i = 0; i < sorted.length; i++) {
    // Check if user cancelled (ESC) before starting next story
    if (abortSignal?.aborted) {
      output.coordinatorLog("Build cancelled by user.");
      logger.info("Build cancelled by user before story start", { storyIndex: i });
      return;
    }

    const story = sorted[i];

    // Check if any dependency failed — block this story (cascade failure)
    if (story.dependsOn?.some(dep => failedStories.has(dep) || skippedStories.has(dep))) {
      const blockedBy = story.dependsOn.filter(dep => failedStories.has(dep) || skippedStories.has(dep));
      skippedStories.add(story.id);
      output.log("system", `Skipping story ${i + 1}/${sorted.length}: "${story.title}" — blocked by failed dependency: ${blockedBy.join(", ")}`);
      logger.info(`Story ${i + 1} skipped (dependency failed)`, { story: story.id, blockedBy });
      continue;
    }

    const persona = loadPersona(story.persona);
    if (!persona) {
      output.error(`Unknown persona: ${story.persona}`);
      failedStories.add(story.id);
      continue;
    }

    // Resolve provider for this persona
    const { provider, model: modelName, apiKey, host, contextLength } = getProviderForPersona(
      config,
      persona.provider || story.persona
    );

    // Set API key
    if (apiKey) {
      const envMap: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_GENERATIVE_AI_API_KEY" };
      const envVar = envMap[provider];
      if (envVar && !process.env[envVar]) process.env[envVar] = apiKey;
    }

    output.log("system", `--- Story ${i + 1}/${sorted.length} ---`);
    output.log(story.persona, `Starting ${story.title} (\x1b[33m${provider}/${modelName}\x1b[0m)`);
    logger.info(`Story ${i + 1}/${sorted.length} started`, { persona: story.persona, title: story.title, provider, model: modelName });

    output.status(`${story.persona}: ${story.title.slice(0, 60)}`);

    const model = createModel(provider as AIProvider, modelName, host, contextLength);

    // Build tools filtered by persona's allowed tools
    const allTools = createToolDefinitions(workingDir, model, sandboxed);
    const storyHealth: { testResults?: string; buildErrors?: string; servicesRunning?: string[] } = {};
    const personaTools: Record<string, AnyToolDef> = {};
    // Loop detection — matches worker/ai-clients/ai-sdk-client.ts
    const LOOP_WINDOW = 6;
    const LOOP_THRESHOLD = 4;
    const recentToolSignatures: string[] = [];
    const loopAbort = new AbortController();
    for (const toolName of persona.tools) {
      const toolDef = allTools[toolName as keyof typeof allTools] as AnyToolDef;
      if (toolDef) {
        personaTools[toolName] = {
          ...toolDef,
          execute: async (input: Record<string, unknown>) => {
            const allowed = await checkToolPermission(toolName, input, trustAll, sessionAllow, output);
            if (!allowed) return "Tool execution denied by user.";

            // Track for loop detection
            const sig = `${toolName}:${JSON.stringify(input).substring(0, 200)}`;
            recentToolSignatures.push(sig);
            if (recentToolSignatures.length > LOOP_WINDOW) recentToolSignatures.shift();
            if (recentToolSignatures.length >= LOOP_WINDOW) {
              const counts: Record<string, number> = {};
              for (const s of recentToolSignatures) counts[s] = (counts[s] || 0) + 1;
              const maxCount = Math.max(...Object.values(counts));
              if (maxCount >= LOOP_THRESHOLD) {
                logger.error("Tool call loop detected", { persona: story.persona, maxCount, window: LOOP_WINDOW });
                output.error(`Tool call loop detected (${maxCount}/${LOOP_WINDOW} identical calls) — aborting story`);
                loopAbort.abort();
                return "ABORTED: Tool call loop detected. Stop and report what you've accomplished so far.";
              }
            }

            output.toolCall(story.persona, toolName, input);
            runHooks("pre", toolName, config.hooks, workingDir);
            const result = await toolDef.execute(input);
            runHooks("post", toolName, config.hooks, workingDir);

            // Log tool result to cli.log — full output, no truncation
            const resultStr = typeof result === "string" ? result : JSON.stringify(result);
            const isError = typeof result === "string" && result.startsWith("Error:");
            if (isError) {
              logger.error("Tool error", { persona: story.persona, tool: toolName, result: resultStr });
            } else {
              logger.debug("Tool result", { tool: toolName, result: resultStr });
            }

            // Track docker compose services for auto-cleanup
            if (toolName === "bash") {
              const cmd = (input as { command?: string }).command || "";
              if (/docker[\s-]compose\s+up/i.test(cmd)) {
                const resolvedCwd = (input as { cwd?: string }).cwd || workingDir;
                startedDockerCompose.add(resolvedCwd);
              }
            }

            // Parse structured bash output for story health context
            if (toolName === "bash" && typeof result === "string") {
              // Test results: jest/vitest/pytest/go test/playwright
              const testMatch = result.match(/(\d+)\s+(?:tests?\s+)?passed|(\d+)\s+(?:tests?\s+)?failed|Tests:\s+(\d+)\s+passed/i);
              if (testMatch) {
                storyHealth.testResults = result.split("\n").filter(l =>
                  /pass|fail|error|PASS|FAIL|ERROR|Tests:|test result/i.test(l)
                ).slice(-5).join("\n");
              }

              // Build errors: tsc, eslint, go build
              const errorLines = result.split("\n").filter(l =>
                /error\s+TS\d|SyntaxError|Cannot find module|error:|ERROR/i.test(l)
              );
              if (errorLines.length > 0) {
                storyHealth.buildErrors = errorLines.join("\n");
              }

              // Docker services
              const bashCmd = (input as { command?: string }).command || "";
              if (/docker.*(compose|ps)|CONTAINER\s+ID/i.test(bashCmd)) {
                const serviceLines = result.split("\n").filter(l => /Up|running|healthy/i.test(l));
                if (serviceLines.length > 0) {
                  storyHealth.servicesRunning = serviceLines.map(l => l.trim());
                }
              }
            }

            output.status("");
            return result;
          },
        };
      }
    }

    const startedDockerCompose = new Set<string>(); // tracks cwd where compose was started

    let revisionFeedback = "";
    for (let revision = 0; revision <= 2; revision++) {

    // Build enriched context from prior stories — mirrors worker/epic/prompt-builder.ts
    const contextParts: string[] = [];

    // Sibling files warning — DO NOT DELETE (from worker prompt-builder.ts)
    if (context.filesCreated.length > 0) {
      contextParts.push(`\n## Files Created by Prior Stories — DO NOT DELETE\n${context.filesCreated.map(f => `- ${f}`).join("\n")}\nThese files were created by other experts. You may import or reference them but NEVER delete or overwrite them.`);
    }
    if (context.filesModified.length > 0) {
      contextParts.push(`\n## Files Modified by Prior Stories\n${context.filesModified.map(f => `- ${f}`).join("\n")}\nBe aware these files have been changed. Read them before making assumptions about their contents.`);
    }

    // Decisions as hard constraints (not informational — from worker coordinator pattern)
    if (context.decisions.length > 0) {
      contextParts.push(`\n## Architectural Decisions — FOLLOW THESE\n${context.decisions.map((d, idx) => `${idx + 1}. ${d}`).join("\n")}\nThese decisions were made by prior experts. Follow them — do not contradict or revisit unless the spec explicitly requires a different approach.`);
    }

    // Learnings as helpful context
    if (context.learnings.length > 0) {
      contextParts.push(`\n## Learnings from Prior Stories\n${context.learnings.map(l => `- ${l}`).join("\n")}`);
    }

    const contextBlock = contextParts.join("\n");

    const projectInstructions = formatProjectInstructions(workingDir);
    const systemPrompt = `${persona.systemPrompt}${projectInstructions}${contextBlock}

## Ticket Requirements — THIS IS YOUR SPEC

${userTask}

## Your File Scope — STAY IN YOUR LANE

${story.description}
${story.targetFiles?.length ? `\n**Target files:** ${story.targetFiles.join(", ")}` : ""}
${story.referenceFiles?.length ? `\n**Reference files (read these first for patterns):** ${story.referenceFiles.join(", ")}` : ""}
${story.implementationNotes ? `\n## Implementation Guidance from Architect\n\n${story.implementationNotes}\n\n**This guidance is based on actual analysis of the codebase. Follow it closely.**` : ""}

**The ticket requirements above are your ONLY spec. This scope identifies which files and area of the codebase you are responsible for. Do NOT invent requirements beyond what the ticket states.**
Do NOT modify files outside this scope unless absolutely necessary for shared types/imports. If you must touch a file owned by another story, note it with a ::file_modified:: marker so subsequent experts are aware.

## Verification Before Completion

Before you finish:
1. Verify your implementation addresses every point from your story description above
2. Run the project's build/compile command to confirm your code compiles (e.g. \`npx tsc --noEmit\`, \`go build ./...\`)
3. Run the project's test command if tests exist (e.g. \`npm test\`, \`go test ./...\`)
4. Run lint if configured (e.g. \`npm run lint\`)
5. Fix any errors you find — do not leave broken code for the next expert

If anything described in your scope is NOT implemented, fix it before finishing. Do not leave partial work.

Working directory: ${workingDir}

## Communication Style

Write in a professional, direct tone. Do NOT open messages with filler words or pleasantries like "Perfect!", "Great!", "Awesome!", "Sure!", "Absolutely!", or similar. Start with the substance — what you did, what you found, or what you need. Be concise and informative. Do NOT repeat what you said in previous steps — each response should add new information only.

When summarizing your work at the end, describe decisions in plain language. The internal DEC-xxx markers are parsed by the system automatically — your summary should restate decisions in readable form.

## Critical rules
- NEVER start long-running processes (dev servers, watch modes, npm start, npm run dev, nodemon, tsc --watch, webpack serve, etc.). These block execution indefinitely.
- NEVER run interactive commands that wait for user input.
- Only run commands that complete and exit: npm install, npm test, npx tsc --noEmit, etc.
- If you need to verify a server works, check that the code compiles or run a quick test — do NOT start the actual server.

When you make a decision that affects other parts of the system, include ::decision:: markers in your output.
When you create a file, include ::file_created::path markers.
When you modify a file, include ::file_modified::path markers.
${DOCKER_INSTRUCTIONS}${VERSION_TRUST}${IGNORE_WORKERMILL}${revisionFeedback ? `\n\n## Revision requested\n${revisionFeedback}` : ""}`;

    try {
      // Combine user abort with loop detection abort
      const combinedAbort = new AbortController();
      if (abortSignal) abortSignal.addEventListener("abort", () => combinedAbort.abort());
      loopAbort.signal.addEventListener("abort", () => combinedAbort.abort());

      // Text repetition detection
      const recentTexts: string[] = [];
      const TEXT_LOOP_WINDOW = 8;
      const TEXT_SUPPRESS_THRESHOLD = 5;
      const TEXT_ABORT_THRESHOLD = 10;
      let textRepeatCount = 0;
      let textSuppressed = false;

      // Summary rambling detection — model finishes work and keeps talking
      let hadToolCalls = false;
      let consecutiveTextOnlySteps = 0;

      const stream = streamText({
        model,
        abortSignal: combinedAbort.signal,
        system: systemPrompt,
        prompt: story.description,
        tools: personaTools as ToolSet,
        stopWhen: stepCountIs(100),
        timeout: { chunkMs: 120_000 },
        ...buildReasoningOptions(provider, modelName),
        ...buildOllamaOptions(provider as AIProvider, contextLength),
        onStepFinish({ text, toolCalls }) {
          // Once the model has used tools, text-only steps are just summaries — skip display, stop after 2
          if (toolCalls && toolCalls.length > 0) {
            hadToolCalls = true;
            consecutiveTextOnlySteps = 0;
          } else if (text && hadToolCalls) {
            consecutiveTextOnlySteps++;
            // Log but don't display — summaries are noise in the CLI
            logger.debug("Story output (summary, not displayed)", { persona: story.persona, text });
            if (consecutiveTextOnlySteps >= 2) {
              logger.info("Post-work summary detected — stopping stream", { persona: story.persona });
              combinedAbort.abort();
            }
            return; // skip display for all post-tool text
          }

          if (text) {
            // Text loop detection
            // Normalize signature: trim, collapse whitespace, lowercase first 200 chars
            const textSig = text.trim().replace(/\s+/g, " ").substring(0, 200).toLowerCase();
            recentTexts.push(textSig);
            if (recentTexts.length > TEXT_LOOP_WINDOW) recentTexts.shift();
            if (recentTexts.length >= TEXT_LOOP_WINDOW) {
              const counts: Record<string, number> = {};
              for (const t of recentTexts) counts[t] = (counts[t] || 0) + 1;
              const maxCount = Math.max(...Object.values(counts));
              if (maxCount >= TEXT_SUPPRESS_THRESHOLD) {
                textRepeatCount++;
                if (!textSuppressed) {
                  textSuppressed = true;
                  output.log(story.persona, "(repeating output suppressed)");
                  logger.info("Text repetition suppressed", { persona: story.persona, count: textRepeatCount });
                }
                if (textRepeatCount >= TEXT_ABORT_THRESHOLD) {
                  logger.error("Text output loop — aborting after repeated output", { persona: story.persona });
                  output.error("Text output stuck in loop — aborting story");
                  combinedAbort.abort();
                }
                return;
              }
              textSuppressed = false;
            }

            const lines = text.split("\n").filter(l => l.trim());
            for (const line of lines) {
              if (line.includes("::decision::") || line.includes("::learning::") || line.includes("::remember::") ||
                  line.includes("::file_created::") || line.includes("::file_modified::")) continue;
              output.log(story.persona, line);
            }
            // Always log full text to cli.log — terminal may suppress but logs show truth
            logger.debug("Story output", { persona: story.persona, text });
          }
          output.status(`${story.persona}: thinking...`);
        },
      });

      // Drive the stream (required for streamText) — onStepFinish handles display
      try {
        for await (const _chunk of stream.textStream) { /* consumed */ }
      } catch {
        // Stream may throw on abort (user ESC or rambling detector) — that's expected
      }

      // Check abort immediately after stream ends — user may have pressed ESC
      if (abortSignal?.aborted) {
        output.coordinatorLog("Build cancelled by user.");
        return;
      }

      const text = await stream.text;
      const usage = await stream.totalUsage;

      output.statusDone();

      // Extract markers and display as WorkerMill-style persona activity
      const decisionMatches = text.match(/::decision::(.*?)(?=::\w+::|$)/gs);
      if (decisionMatches) {
        for (const m of decisionMatches) {
          const decision = m.replace("::decision::", "").trim();
          context.decisions.push(decision);
          output.log(story.persona, decision);
        }
      }

      // Learning extraction disabled — smaller models spam generic platitudes
      // ("follows best practices", "implementation is production-ready") that
      // pollute the memory system. Re-enable when we have quality filtering.

      const fileCreatedMatches = text.match(/::file_created::(.*?)(?=::\w+::|$)/gs);
      if (fileCreatedMatches) {
        for (const m of fileCreatedMatches) {
          context.filesCreated.push(m.replace("::file_created::", "").trim());
        }
      }

      const fileModifiedMatches = text.match(/::file_modified::(.*?)(?=::\w+::|$)/gs);
      if (fileModifiedMatches) {
        for (const m of fileModifiedMatches) {
          context.filesModified.push(m.replace("::file_modified::", "").trim());
        }
      }

      // Track cost
      const inTokens = usage?.inputTokens || 0;
      const outTokens = usage?.outputTokens || 0;
      costTracker.addUsage(persona.name, provider, modelName, inTokens, outTokens);
      output.updateCost?.(costTracker.getTotalCost());

      // Detect empty story — model returned nothing
      if (outTokens === 0 && !text.trim()) {
        logger.error(`Story ${i + 1} produced no output`, { persona: story.persona });
        if (revision < 2) {
          output.log(story.persona, `Story produced no output — retrying (${revision + 1}/3)`);
          continue; // retry this story
        }
        output.error(`Story ${i + 1} failed: model produced no output after 3 attempts`);
        failedStories.add(story.id);
        break;
      }

      // --- Post-execution validation ---
      // File existence check only. Build/lint/test verification is the expert's
      // responsibility — they have bash and verify tools. Auto-detecting and
      // running quality gates caused cascading failures when earlier stories
      // created broken configs that later stories couldn't fix.
      {
        const missingFiles = context.filesCreated.filter(f => {
          const fullPath = path.isAbsolute(f) ? f : path.join(workingDir, f);
          return !fs.existsSync(fullPath);
        });
        if (missingFiles.length > 0) {
          logger.info("Missing declared files", { persona: story.persona, files: missingFiles });
          if (revision < 2) {
            output.log(story.persona, `${missingFiles.length} declared file(s) missing — retrying`);
            revisionFeedback = `\n\n## Missing Files\nThese files were declared as created but don't exist on disk:\n${missingFiles.map(f => `- ${f}`).join("\n")}\n\nCreate them or remove the declarations.`;
            continue;
          }
        }
      }

      // Check abort before completing
      if (abortSignal?.aborted) {
        output.coordinatorLog("Build cancelled by user.");
        return;
      }

      output.log(story.persona, `${story.title} — completed! (${i + 1}/${sorted.length})`);
      logger.info(`Story ${i + 1} completed`, { persona: story.persona, inputTokens: inTokens, outputTokens: outTokens });

      // Commit story changes — creates a checkpoint on the feature branch
      // From worker/epic/executor.ts post-execution commit pattern
      if (featureBranch) {
        const hash = commitStoryChanges(workingDir, i + 1, story.title, story.persona);
        if (hash) output.coordinatorLog(`Committed story ${i + 1}: ${hash}`);
      }

          break; // Story succeeded, exit revision loop
    } catch (err) {
      output.statusDone();

      // If user cancelled (ESC), exit immediately — don't retry or classify
      if (abortSignal?.aborted) {
        output.coordinatorLog("Build cancelled by user.");
        logger.info("Build cancelled by user during story execution", { story: i + 1, persona: story.persona });
        return;
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Story ${i + 1} error`, { persona: story.persona, error: errMsg, revision });

      // Classify error — from worker/epic/types.ts + worker-decision-engine.ts
      const errorClass = classifyError(errMsg);
      logger.info(`Error classified`, { category: errorClass.category, fixable: errorClass.fixable, persona: story.persona });

      // Transient errors — retry as-is
      if (errorClass.category === "transient" && revision < 2) {
        output.log(story.persona, `Transient error: ${errMsg} — retrying...`);
        logger.info(`Story ${i + 1} retrying (transient)`, { revision });
        continue;
      }

      // Fixable errors (typescript, lint, test, build) — retry with fix context
      if (errorClass.fixable && revision < 2) {
        output.log(story.persona, `${errorClass.category} error detected — retrying with fix context (${revision + 1}/3)`);
        logger.info(`Story ${i + 1} retrying (fixable ${errorClass.category})`, { revision });
        revisionFeedback = `\n\n## Error During Execution — Fix This\n\nCategory: ${errorClass.category}\n\n${errMsg}\n\n**${errorClass.fixHint}**`;
        continue;
      }

      // Non-fixable or retries exhausted
      if (errorClass.category === "rate_limit") {
        output.error(`Story ${i + 1} hit rate limit — stopping (wait and retry later)`);
      } else if (errorClass.category === "auth") {
        output.error(`Story ${i + 1} auth error — check your API key/credentials`);
      } else {
        output.error(`Story ${i + 1} failed: ${errMsg}`);
      }
      failedStories.add(story.id);
      break;
    }

    } // end revision loop

    // Auto-cleanup: stop any Docker Compose services started during this story
    for (const composeDir of startedDockerCompose) {
      try {
        execSync("docker compose down --timeout 5 2>/dev/null", { cwd: composeDir, timeout: 15_000 });
        output.log("system", "Auto-cleanup: stopped Docker services");
        logger.info("Auto-cleanup docker compose", { cwd: composeDir });
      } catch { /* non-fatal */ }
    }
  }

  // Report failed/skipped stories before review
  if (failedStories.size > 0 || skippedStories.size > 0) {
    const failedNames = sorted.filter(s => failedStories.has(s.id)).map(s => s.title);
    const skippedNames = sorted.filter(s => skippedStories.has(s.id)).map(s => s.title);
    if (failedNames.length > 0) output.coordinatorLog(`Failed stories: ${failedNames.join(", ")}`);
    if (skippedNames.length > 0) output.coordinatorLog(`Skipped (blocked by dependency): ${skippedNames.join(", ")}`);
    logger.info("Story execution summary", { failed: [...failedStories], skipped: [...skippedStories], completed: sorted.length - failedStories.size - skippedStories.size });
  }

  // Review config
  const reviewEnabled = config.review?.enabled !== false; // default: true
  const maxRevisions = config.review?.maxRevisions ?? 3;
  let autoRevise = config.review?.autoRevise ?? false;

  // Run inline review with revision loop
  const reviewer = reviewEnabled ? loadPersona("tech_lead") : null;
  if (reviewer) {
    const { provider: revProvider, model: revModel, host: revHost, contextLength: revCtx } = getProviderForPersona(
      config,
      "tech_lead"
    );

    const revApiKey = config.providers[revProvider]?.apiKey;
    if (revApiKey) {
      const envMap: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_GENERATIVE_AI_API_KEY" };
      const envVar = envMap[revProvider];
      const key = revApiKey.startsWith("{env:") ? process.env[revApiKey.slice(5, -1)] : revApiKey;
      if (envVar && key && !process.env[envVar]) process.env[envVar] = key;
    }

    const reviewModel = createModel(revProvider as AIProvider, revModel, revHost, revCtx);
    const reviewTools = createToolDefinitions(workingDir, reviewModel, sandboxed);

    // Read-only tools for reviewer — wrapped with output.log
    const reviewerTools: Record<string, AnyToolDef> = {};
    for (const toolName of reviewer.tools) {
      const toolDef = reviewTools[toolName as keyof typeof reviewTools] as AnyToolDef;
      if (toolDef) {
        reviewerTools[toolName] = {
          ...toolDef,
          execute: async (input: Record<string, unknown>) => {
            output.log("tech_lead", formatToolCallDisplay(toolName, input));
            const result = await toolDef.execute(input);
            return result;
          },
        };
      }
    }

    let previousReviewFeedback = "";
    let finalReviewText = ""; // Captures the approved review for use in PR body
    // Check if user cancelled before starting review
    if (abortSignal?.aborted) {
      output.coordinatorLog("Build cancelled by user.");
      return;
    }
    logger.info("Starting review loop", { maxRevisions, provider: revProvider, model: revModel });
    let preRevisionHash = ""; // Tracks HEAD before each revision — so reviewer sees only what changed
    for (let reviewRound = 1; reviewRound <= maxRevisions + 1; reviewRound++) {
      const isRevision = reviewRound > 1;
      logger.info(`Review round ${reviewRound}`, { isRevision, maxRevisions });
      output.coordinatorLog(isRevision ? `Starting Tech Lead review (revision ${reviewRound - 1}/${maxRevisions}, ${revProvider}/${revModel})...` : `Starting Tech Lead review (${revProvider}/${revModel})...`);
      output.log("tech_lead", `Starting agent execution (\x1b[35m${revProvider}/${revModel}\x1b[0m)`);

      output.status(isRevision ? "Reviewer -- Re-checking after revisions" : "Reviewer -- Checking code quality");

      try {
        // Build review prompt with full context — matches WorkerMill's inline-reviewer.ts buildReviewPrompt()
        const previousFeedbackSection = isRevision && previousReviewFeedback
          ? `## Previous Review Feedback (Round ${reviewRound})
This is a revision attempt. The previous code was reviewed and these issues were identified:

${previousReviewFeedback}

**Evaluate whether the revision addressed the issues you raised.**
- If your major issues were fixed, approve — even if minor items remain
- If the same issue persists after being flagged, note it in feedback but don't block on it again — the worker may not be able to fix it with the current model
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

        const reviewerProjectInstructions = formatProjectInstructions(workingDir);
        const reviewPrompt = `${previousFeedbackSection}${reviewerProjectInstructions ? `${reviewerProjectInstructions}\n\n` : ""}## Implementation Plan — THIS IS WHAT THE WORKERS WERE TOLD TO DO

Review the code against this plan. The planner analyzed the codebase and gave each worker specific guidance.

${storyPlanDetails}

## Code Changes

The diff below shows what was changed. For new files, use your read_file tool to inspect them.

Files created: ${context.filesCreated.join(", ") || "none"}
Files modified: ${context.filesModified.join(", ") || "none"}
${context.decisions.length > 0 ? `\nDecisions made:\n${context.decisions.map(d => `- ${d}`).join("\n")}` : ""}

${codeDiff || "(no code changes detected)"}

## Original Spec (reference)

The plan above was derived from this spec. Use it to check completeness, but the plan is the workers' source of truth.

${userTask}

## Review Instructions

Review the actual code above. You also have tools (read_file, glob, grep) to examine files in more detail if needed.

### APPROVE when:
- Code correctly implements the requirements from the original spec
- No obvious bugs or security issues
- Code follows existing patterns in the codebase
- Appropriate error handling is in place
- Minor cosmetic issues (formatting, empty lines, comment style, variable naming) are NOT grounds for revision — mention them in feedback but still approve

### REVISION_NEEDED when:
- Code has functional bugs that affect correctness
- Security vulnerabilities that must be fixed
- Missing required functionality from the task spec
- Broken imports, missing dependencies, or code that won't run

### Do NOT request revision for:
- Style preferences (extra/missing blank lines, comment formatting, quote style)
- Minor naming differences that don't affect functionality
- "Could be cleaner" refactoring suggestions
- Missing tests for edge cases when core functionality is tested
- Code that works correctly but isn't how you would have written it

### REJECT when:
- Fundamental approach is wrong and cannot be fixed with revisions
- Security vulnerability that requires different architecture

**Be fair**: Approve code that correctly implements the plan and has no functional bugs or security issues. Request revision for real problems — missing functionality, broken code, security vulnerabilities. Cosmetic preferences and style differences belong in feedback comments, not revision requests. Score honestly — 8+ means ready to ship, below 8 means real issues remain.

## Output Format

\`\`\`
REVIEW_DECISION: approved
\`\`\`
OR
\`\`\`
REVIEW_DECISION: revision_needed
\`\`\`
OR
\`\`\`
REVIEW_DECISION: rejected
\`\`\`

Then add:
\`\`\`
CODE_QUALITY_SCORE: 8
FEEDBACK: Your detailed feedback
\`\`\`

**Score guide (1-10):** 1-3 = fundamentally broken, 4-5 = major issues, 6 = functional but rough, 7 = solid with minor issues (usually approve), 8-9 = good quality, 10 = exceptional. A score of 7+ should almost always accompany an "approved" decision.

### For REVISION_NEEDED Decisions - Specify Affected Stories

When requesting revision, you MUST specify which stories need changes. Use the story numbers from the Story Summary table above.

\`\`\`
AFFECTED_STORIES: [2, 3]
AFFECTED_REASONS: {"2": "Missing error handling in auth controller", "3": "Frontend form has no validation"}
\`\`\`

**Guidelines:**
- Only include stories that have ACTUAL implementation issues
- If ALL stories need revision, you may omit AFFECTED_STORIES (all will re-run)
- Be specific in AFFECTED_REASONS so developers know exactly what to fix`;

        // Use onStepFinish for reviewer — same as WorkerMill ai-sdk-client.ts
        // Accumulate only the reviewer's NEW output (not the echoed prompt/previous feedback)
        let reviewerOutput = "";
        const reviewStream = streamText({
          model: reviewModel,
          abortSignal,
          system: reviewer.systemPrompt,
          prompt: reviewPrompt,
          tools: reviewerTools,
          stopWhen: stepCountIs(100),
          timeout: { chunkMs: 120_000 },
          ...buildOllamaOptions(revProvider as AIProvider, revCtx),
          onStepFinish({ text }) {
            if (text) {
              reviewerOutput += text + "\n";
              const lines = text.split("\n").filter(l => l.trim());
              for (const line of lines) {
                if (line.includes("::review_score::") || line.includes("::review_verdict::") || line.includes("::code_quality_score::")) continue;
                output.log("tech_lead", line);
              }
            }
          },
        });
        for await (const _chunk of reviewStream.textStream) { /* consumed */ }

        // Use accumulated step output (reviewer's own words only, no echoed prompt)
        const reviewText = reviewerOutput;
        logger.debug("Reviewer output", { reviewRound, text: reviewText });
        const reviewUsage = await reviewStream.totalUsage;

        output.statusDone();

        // Extract review decision — 3-tier system matching WorkerMill worker
        const decisionMatch = reviewText.match(/REVIEW_DECISION:\s*(approved|revision_needed|rejected)/i);
        const decision = decisionMatch ? decisionMatch[1].toLowerCase() : null;
        const score = extractScore(reviewText);

        // Score-based auto-approve. Don't rely on the model following its own prompt instructions.
        const threshold = config.review?.approvalThreshold ?? 8;
        const approved = score >= threshold || (decision ? decision === "approved" : true);
        logger.info(`Review round ${reviewRound} result`, { decision: decision || "no-marker-approved", score, approved, reviewTextLength: reviewText.length });

        // Display review result — WorkerMill format
        output.log("tech_lead", `::code_quality_score::${score}/10`);
        output.log("tech_lead", `::review_decision::${approved ? "approved" : decision === "rejected" ? "rejected" : "needs_revision"}`);
        output.coordinatorLog(approved ? `Review approved (${score}/10)` : `Review needs revision (${score}/10)`);
        // Save feedback for next review round — so tech_lead can check if issues were addressed
        previousReviewFeedback = reviewText;
      
        // Track reviewer cost
        costTracker.addUsage(`Reviewer (round ${reviewRound})`, revProvider, revModel,
          reviewUsage?.inputTokens || 0, reviewUsage?.outputTokens || 0);
        output.updateCost?.(costTracker.getTotalCost());

        // If approved or out of revision attempts, done
        if (approved) {
          finalReviewText = reviewText;
          break;
        }
        const revisionsLeft = maxRevisions - (reviewRound - 1);
        if (revisionsLeft <= 0) {
          output.coordinatorLog(`Max revisions (${maxRevisions}) reached, proceeding to commit.`);
          break;
        }

        // Ask user or auto-revise
        let shouldRevise = autoRevise;
        if (!autoRevise) {
          try {
            const rv = await output.confirm(`Revise and re-review? (${revisionsLeft} left)`);
            if (typeof rv === "object") {
              shouldRevise = rv.allowed;
              if (rv.mode === "always") {
                // Switch to auto-revise for remaining rounds
                autoRevise = true;
                output.coordinatorLog("Auto-revise enabled for remaining rounds.");
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

        if (!shouldRevise) break;

        // Parse which stories need revision — send feedback back to the original workers
        // (selective revision from inline-reviewer.ts)
        const affected = parseAffectedStories(reviewText);
        const affectedSet = affected ? new Set(affected.stories) : null;

        if (affected) {
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

        // Capture prior work context before revision — prevents oscillation
        // (from worker/epic/coordinator-review.ts captureStoryBranchSummaries pattern)
        let priorWorkSummary = "";
        try {
          const diffStat = execSync("git diff --stat HEAD 2>/dev/null || true", { cwd: workingDir, encoding: "utf-8", timeout: 10_000 }).trim();
          const diffContent = execSync("git diff HEAD 2>/dev/null || true", { cwd: workingDir, encoding: "utf-8", timeout: 15_000 }).trim();
          // Also capture any recent commits on this session
          const recentCommits = execSync("git log --oneline -5 2>/dev/null || true", { cwd: workingDir, encoding: "utf-8", timeout: 5_000 }).trim();
          if (diffStat || recentCommits) {
            const parts: string[] = [];
            if (recentCommits) parts.push(`**Recent commits:**\n${recentCommits}`);
            if (diffStat) parts.push(`**Uncommitted changes:**\n${diffStat}`);
            if (diffContent) {
              parts.push(`**Current diff (what exists now):**\n\`\`\`diff\n${diffContent}\n\`\`\``);
            }
            priorWorkSummary = parts.join("\n\n");
          }
        } catch {
          // Non-fatal — proceed without prior work context
        }

        for (let i = 0; i < sorted.length; i++) {
          const story = sorted[i];

          // Skip stories not affected by the review (selective revision)
          if (affectedSet && !affectedSet.has(i + 1)) {
            output.coordinatorLog(`Skipping story ${i + 1}/${sorted.length} — not affected`);
            continue;
          }

          const storyPersona = loadPersona(story.persona);
          if (!storyPersona) continue;

          const { provider: sProvider, model: sModel, host: sHost, contextLength: sCtx } = getProviderForPersona(
            config, storyPersona.provider || story.persona
          );
          if (sProvider) {
            const sApiKey = config.providers[sProvider]?.apiKey;
            if (sApiKey) {
              const envMap: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_GENERATIVE_AI_API_KEY" };
              const envVar = envMap[sProvider];
              if (envVar && !process.env[envVar]) {
                const key = sApiKey.startsWith("{env:") ? process.env[sApiKey.slice(5, -1)] : sApiKey;
                if (key) process.env[envVar] = key;
              }
            }
          }

          // Build per-story feedback: use AFFECTED_REASONS if available, otherwise full review text
          const storyReason = affected?.reasons?.[i + 1];
          const storyFeedback = storyReason
            ? `Story ${i + 1} (${story.title}):\n${storyReason}`
            : reviewText;

          output.coordinatorLog(`Revising story ${i + 1} of ${sorted.length}: ${story.title}`);
          logger.info(`Revision started`, { story: i + 1, persona: story.persona, title: story.title, hasSpecificFeedback: !!storyReason });
          output.log(story.persona, `Starting revision: ${story.title} (\x1b[33m${sProvider}/${sModel}\x1b[0m)`);

          output.status(`${story.persona}: revising...`);

          const storyModel = createModel(sProvider as AIProvider, sModel, sHost, sCtx);
          const storyAllTools = createToolDefinitions(workingDir, storyModel, sandboxed);
          const storyTools: Record<string, AnyToolDef> = {};
          for (const toolName of storyPersona.tools) {
            const toolDef = storyAllTools[toolName as keyof typeof storyAllTools] as AnyToolDef;
            if (toolDef) {
              storyTools[toolName] = {
                ...toolDef,
                execute: async (input: Record<string, unknown>) => {
                  const allowed = await checkToolPermission(toolName, input, trustAll, sessionAllow, output);
                  if (!allowed) return "Tool execution denied by user.";
                  output.toolCall(story.persona, toolName, input);
                  output.status(`${story.persona}: working...`);
                  const result = await toolDef.execute(input);
                  output.status("");
                  return result;
                },
              };
            }
          }

          // Revision prompt follows WorkerMill platform pattern (prompt-builder.ts):
          // Per-story feedback + what was tried before + efficiency tips + scope enforcement.
          // The worker gets enough context to fix its own mistakes without re-implementing.

          // Capture per-story prior work from git history — matches worker/epic/git-ops.ts:captureStoryBranchSummaries()
          const whatYouDidLastTime = featureBranch
            ? captureStoryPriorWork(workingDir, mainBranch, i + 1)
            : "";

          const revisionSystemPrompt = `${storyPersona.systemPrompt}

Working directory: ${workingDir}`;

          try {
            const revStream = streamText({
              model: storyModel,
              abortSignal,
              system: revisionSystemPrompt,
              prompt: `## ⚠️ REVISION REQUIRED — Tech Lead Feedback

### Your Story's Required Fix
${storyFeedback}
${whatYouDidLastTime}
## Your Story Scope
Story ${i + 1}: "${story.title}" — ${story.description}
${story.targetFiles?.length ? `**Target files:** ${story.targetFiles.join(", ")}` : ""}
${story.implementationNotes ? `\n## Architect's Guidance\n${story.implementationNotes}` : ""}

**IMPORTANT: Only fix issues that are YOUR story's responsibility.**
- Fix the specific issues listed above
- Do NOT fix issues in files that belong to other stories
- Do NOT rewrite files from scratch — use edit_file for targeted changes
- READ each file BEFORE editing it

**EFFICIENCY TIP: Go straight to the files mentioned in the feedback.**
- You already built this code in the previous attempt
- Skip re-reading files unless they're directly relevant to the feedback
- Focus on the specific issues, not re-implementation`,
              tools: storyTools as ToolSet,
              stopWhen: stepCountIs(100),
              timeout: { chunkMs: 120_000 },
              ...buildReasoningOptions(sProvider, sModel),
              ...buildOllamaOptions(sProvider as AIProvider, sCtx),
              onStepFinish({ text }) {
                if (text) {
                  const lines = text.split("\n").filter(l => l.trim());
                  for (const line of lines) {
                    if (line.includes("::")) continue;
                    output.log(story.persona, line);
                  }
                }
                output.status(`${story.persona}: thinking...`);
              },
            });

            for await (const _chunk of revStream.textStream) { /* drive */ }
            const revUsage = await revStream.totalUsage;

            costTracker.addUsage(`${storyPersona.name} (revision)`, sProvider, sModel,
              revUsage?.inputTokens || 0, revUsage?.outputTokens || 0);
            output.updateCost?.(costTracker.getTotalCost());

            logger.info(`Revision completed`, { story: i + 1, persona: story.persona, inputTokens: revUsage?.inputTokens || 0, outputTokens: revUsage?.outputTokens || 0 });
            output.log(story.persona, `${story.title} — revision complete!`);

            // Commit revision changes — checkpoint on the feature branch
            if (featureBranch) {
              const hash = commitRevisionChanges(workingDir, i + 1, story.title, story.persona, reviewRound);
              if (hash) output.coordinatorLog(`Committed revision ${reviewRound} for story ${i + 1}: ${hash}`);
            }
          } catch (err) {
            output.statusDone();
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error(`Revision failed`, { story: i + 1, persona: story.persona, error: errMsg });
            output.log("system", `Revision failed for story ${i + 1}: ${errMsg}`);
          }
        }
              // Loop back to review again
      } catch (err) {
        output.statusDone();
        output.log("system", `Review skipped: ${err instanceof Error ? err.message : String(err)}`);
              break;
      }
    } // end review loop
  }

  // --- Completion Summary ---
  try {
    if (featureBranch) {
      // Show branch summary
      const commitCount = execSync(`git rev-list --count ${mainBranch}..HEAD 2>/dev/null || echo 0`, { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
      const diffStat = execSync(`git diff --stat ${mainBranch}..HEAD 2>/dev/null || true`, { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();

      output.log("system", "");
      output.log("system", `Branch: **${featureBranch}** (${commitCount} commits)`);
      if (diffStat) output.log("system", diffStat);
      output.log("system", "");

      // Commit any remaining uncommitted changes
      try {
        execSync("git add .", { cwd: workingDir, stdio: "pipe" });
        const status = execSync("git status --porcelain", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
        if (status) {
          execSync('git commit --no-verify -m "chore: uncommitted changes from /ship session"', { cwd: workingDir, stdio: "pipe" });
        }
      } catch { /* nothing to commit */ }

      // Check if remote exists for PR
      let hasRemote = false;
      try {
        const remote = execSync("git remote get-url origin 2>/dev/null", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
        hasRemote = !!remote;
      } catch { /* no remote */ }

      if (hasRemote) {
        output.log("system", `To review the full diff first, say no and use: /diff or \`!git diff ${mainBranch}..HEAD\``);
        const cr = await output.confirm("Push branch and open a pull request?");
        const confirmed = typeof cr === "object" ? cr.allowed : cr;
        if (confirmed) {
          try {
            output.status("Pushing branch...");
            execSync(`git push -u origin "${featureBranch}" 2>&1`, { cwd: workingDir, encoding: "utf-8", stdio: "pipe" });
            output.statusDone();

            // Try to create PR with gh CLI
            try {
              const storyTitles = sorted.map(s => s.title).join(", ");
              const prTitle = storyTitles.length > 70 ? storyTitles.slice(0, 67) + "..." : storyTitles;

              // Build PR body: task overview + stories + tech lead review
              const prParts: string[] = [];
              prParts.push("## Task\n");
              prParts.push(userTask);
              prParts.push("\n## Stories\n");
              prParts.push(sorted.map((s, i) => `- **Story ${i + 1}** (${s.persona}): ${s.title}`).join("\n"));
              if (finalReviewText) {
                // Extract just the FEEDBACK section from the review, not the markers
                const feedbackMatch = finalReviewText.match(/FEEDBACK:\s*([\s\S]*?)(?=AFFECTED_|REVIEW_DECISION|CODE_QUALITY|$)/i);
                const feedback = feedbackMatch ? feedbackMatch[1].trim() : finalReviewText.split("\n").filter(l => !l.includes("REVIEW_DECISION") && !l.includes("CODE_QUALITY_SCORE") && !l.includes("AFFECTED_")).join("\n").trim();
                if (feedback) {
                  prParts.push("\n## Tech Lead Review\n");
                  prParts.push(feedback);
                }
              }
              prParts.push("\n---\nShipped by [WorkerMill CLI](https://workermill.com)");
              const prBody = prParts.join("\n");
              const prUrl = execSync(
                `gh pr create --title "${prTitle.replace(/"/g, '\\"')}" --body "${prBody.replace(/"/g, '\\"')}" --head "${featureBranch}" --base "${mainBranch}" 2>&1`,
                { cwd: workingDir, encoding: "utf-8", stdio: "pipe" },
              ).trim();
              output.log("system", `Pull request created: ${prUrl}`);
            } catch (prErr) {
              const prMsg = prErr instanceof Error ? (prErr as any).stdout || prErr.message : String(prErr);
              output.log("system", `Branch pushed. Create a PR manually (gh CLI error: ${prMsg.split("\n")[0]})`);
            }
          } catch (pushErr) {
            output.statusDone();
            const pushMsg = pushErr instanceof Error ? pushErr.message : String(pushErr);
            output.log("system", `Push failed: ${pushMsg.split("\n")[0]}`);
            output.log("system", `Branch is local: \`${featureBranch}\`. Push manually with: git push -u origin ${featureBranch}`);
          }
        } else {
          output.log("system", `Branch is local: \`${featureBranch}\``);
          output.log("system", `To push later: git push -u origin ${featureBranch}`);
          output.log("system", `To create a PR: gh pr create --head ${featureBranch}`);
        }
      } else {
        output.log("system", `No remote configured. Branch: \`${featureBranch}\``);
      }
    } else {
      // No feature branch — old behavior, commit uncommitted changes
      const diff = execSync("git diff --stat 2>/dev/null || true", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
      const untracked = execSync("git ls-files --others --exclude-standard 2>/dev/null || true", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
      if (diff || untracked) {
        output.coordinatorLog(`${diff ? diff.split("\n").length : 0} modified, ${untracked ? untracked.split("\n").filter(Boolean).length : 0} new files`);
      }
    }
  } catch (err) {
    logger.debug("Completion summary failed", { error: err instanceof Error ? err.message : String(err) });
  }

  // Final cost update
  output.updateCost?.(costTracker.getTotalCost());
}
