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
): Promise<{ stories: Story[]; provider: string; model: string; inputTokens: number; outputTokens: number }> {
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
  const plannerPrompt = `You are an expert implementation planner. Analyze this task and create a high-quality implementation plan.
${plannerProjectInstructions}
## Task
${userTask}
${inlinedFileContext ? `\n## Referenced Files\n${inlinedFileContext}` : ""}
## Working directory
${workingDir}

## Instructions
1. Use your tools to explore the working directory and understand what exists. Stay within the working directory.${referencedFiles.length > 0 ? "\n   The referenced files above have been inlined for you. Read any additional files you need for context." : ""}
2. Design a plan that breaks the task into focused stories, each assigned to a specialist persona.
3. Each story should be a meaningful unit of work — not too granular, not too broad.
4. Quality criteria:
   - Every story has a clear, specific description
   - Stories are ordered correctly — dependencies satisfied before dependents
   - Each story is scoped for ONE persona
   - Descriptions include enough detail for the persona to execute without ambiguity

## Output format

Workers receive the FULL spec as their specification, so story descriptions define SCOPE (which files and area to work on), not specs (how to build it — the spec has those).

Return ONLY a JSON code block with this structure:
\`\`\`json
{
  "stories": [
    {
      "id": "short-kebab-case-id",
      "title": "Brief title",
      "persona": "persona_name",
      "description": "File scope: which files/directories this story owns and what area of the system it covers (2-3 lines). Do NOT rewrite the spec — workers read the full spec themselves.",
      "dependsOn": ["id-of-dependency"]
    }
  ]
}
\`\`\`

Available personas: backend_developer, frontend_developer, devops_engineer, qa_engineer, security_engineer, data_ml_engineer, mobile_developer, tech_writer, tech_lead`;

  logger.info("Planner started", { provider: pProvider, model: pModel });
  output.log("planner", `Starting planning agent using ${pModel}`);
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
    timeout: { totalMs: 3 * 60 * 1000, chunkMs: 120_000 },
    ...buildOllamaOptions(pProvider as AIProvider, pCtx),
    onStepFinish() {
      // Text already streamed line-by-line below — just update status between steps
      output.status("planner: thinking...");
    },
  });
  // Stream planner output line-by-line as it arrives
  let lineBuffer = "";
  for await (const chunk of planStream.textStream) {
    lineBuffer += chunk;
    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop() || ""; // keep incomplete last line in buffer
    for (const line of lines) {
      if (line.trim()) {
        output.log("planner", line);
      }
    }
  }
  // Flush remaining buffer
  if (lineBuffer.trim()) {
    output.log("planner", lineBuffer);
  }

  const planText = await planStream.text;
  clearInterval(heartbeat);

  const planUsage = await planStream.totalUsage;

  let stories = parseStoriesFromText(planText, output);

  logger.info("Planner completed", { storiesFound: stories.length, planTextLength: planText.length });

  if (stories.length === 0) {
    logger.info("Plan parsing failed, falling back to single story", { planTextPreview: planText.slice(0, 500) });
    output.log("system", "Planner didn't produce structured stories, falling back to single story");
    stories = [{
      id: "implement",
      title: userTask.slice(0, 60),
      persona: "backend_developer",
      description: userTask,
    }];
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

  // Planner explores codebase and produces stories
  const planResult = await planStories(config, userTask, workingDir, sandboxed, output, abortSignal);
  const plannerStories = planResult.stories;

  // Track planner cost
  costTracker.addUsage("Planner", planResult.provider, planResult.model, planResult.inputTokens, planResult.outputTokens);
  output.updateCost?.(costTracker.getTotalCost());

  // Show the plan — WorkerMill format
  output.log("planner", `Plan generated: ${plannerStories.length} stories`);
  plannerStories.forEach((s, i) => {
    output.log("planner", `Step ${i + 1}: [${s.persona}] ${s.title}${s.dependsOn?.length ? ` (after: ${s.dependsOn.join(", ")})` : ""}`);
  });
  output.log("planner", `Plan validated: ${plannerStories.length} stories. Task queued for execution.`);

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
        prompt: `Review this implementation plan. Score it 0-100 using ::review_score::N marker.\n\nStories:\n${plannerStories.map(s => `- ${s.id}: ${s.title} (${s.persona}) — ${s.description}`).join("\n")}`,
        tools: criticReadOnly as ToolSet,
        stopWhen: stepCountIs(100),
        timeout: { totalMs: 3 * 60 * 1000, chunkMs: 120_000 },
        ...buildOllamaOptions(cProvider as AIProvider, cCtx),
      });
      for await (const _chunk of criticStream.textStream) { /* drive */ }
      const criticText = await criticStream.text;
      output.statusDone();

      const score = extractScore(criticText);
      output.log("critic", `::review_score::${score}`);
      output.log("critic", score >= 80 ? "Plan approved" : "Plan needs revision");
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
    output.log(story.persona, `Starting ${story.title} (${provider}/${modelName})`);
    logger.info(`Story ${i + 1}/${sorted.length} started`, { persona: story.persona, title: story.title, provider, model: modelName });

    output.status(`${story.persona}: ${story.title.slice(0, 60)}`);

    const model = createModel(provider as AIProvider, modelName, host, contextLength);

    // Build tools filtered by persona's allowed tools
    const allTools = createToolDefinitions(workingDir, model, sandboxed);
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
            output.status("");
            return result;
          },
        };
      }
    }

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

**The ticket requirements above are your ONLY spec. This scope identifies which files and area of the codebase you are responsible for. Do NOT invent requirements beyond what the ticket states.**
Do NOT modify files outside this scope unless absolutely necessary for shared types/imports. If you must touch a file owned by another story, note it with a ::file_modified:: marker so subsequent experts are aware.

## Verification Before Completion

Before you finish, verify your implementation addresses every point from your story description above. If anything described in your scope is NOT implemented, fix it before finishing. Do not leave partial work.

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
${MEMORY_INSTRUCTIONS}${DOCKER_INSTRUCTIONS}${VERSION_TRUST}${IGNORE_WORKERMILL}${revisionFeedback ? `\n\n## Revision requested\n${revisionFeedback}` : ""}`;

    try {
      // Combine user abort with loop detection abort
      const combinedAbort = new AbortController();
      if (abortSignal) abortSignal.addEventListener("abort", () => combinedAbort.abort());
      loopAbort.signal.addEventListener("abort", () => combinedAbort.abort());

      // Text repetition detection — suppress display after 5 repeats, abort after 50
      const recentTexts: string[] = [];
      const TEXT_LOOP_WINDOW = 8;
      const TEXT_SUPPRESS_THRESHOLD = 5;
      const TEXT_ABORT_THRESHOLD = 10;
      let textRepeatCount = 0;
      let textSuppressed = false;

      const stream = streamText({
        model,
        abortSignal: combinedAbort.signal,
        system: systemPrompt,
        prompt: story.description,
        tools: personaTools as ToolSet,
        stopWhen: stepCountIs(100),
        timeout: { totalMs: 10 * 60 * 1000, chunkMs: 120_000 },
        ...buildReasoningOptions(provider, modelName),
        ...buildOllamaOptions(provider as AIProvider, contextLength),
        onStepFinish({ text }) {
          if (text) {
            // Text loop detection
            const textSig = text.substring(0, 200);
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
          }
          output.status(`${story.persona}: thinking...`);
        },
      });

      // Drive the stream (required for streamText) — onStepFinish handles display
      for await (const _chunk of stream.textStream) { /* consumed */ }

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

      // Extract and save memories from worker output
      const storyMemories = extractMemoryMarkers(text);
      for (const m of storyMemories) {
        addMemory(m.type, m.content);
        if (m.type === "learning") context.learnings.push(m.content);
      }

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

      // --- Post-execution validation (from worker/epic/story-validator.ts) ---
      {
        const validationIssues: string[] = [];

        // 1. Verify created files actually exist on disk
        for (const f of context.filesCreated) {
          const fullPath = path.isAbsolute(f) ? f : path.join(workingDir, f);
          if (!fs.existsSync(fullPath)) {
            validationIssues.push(`File declared as created but not found on disk: ${f}`);
          }
        }

        // 2. Auto-detect typecheck — if .ts/.tsx files were touched and tsconfig.json exists
        const touchedFiles = [...context.filesCreated, ...context.filesModified];
        const hasTsFiles = touchedFiles.some(f => f.endsWith(".ts") || f.endsWith(".tsx"));
        if (hasTsFiles && fs.existsSync(path.join(workingDir, "tsconfig.json"))) {
          try {
            execSync("npx tsc --noEmit 2>&1", { cwd: workingDir, timeout: 300_000, encoding: "utf-8" });
            output.log(story.persona, "Typecheck passed");
          } catch (tscErr) {
            const tscOutput = tscErr instanceof Error && "stdout" in tscErr ? String((tscErr as any).stdout) : String(tscErr);
            // Limit to first 40 lines to avoid bloating the retry prompt
            const truncated = tscOutput.split("\n").slice(0, 40).join("\n");
            validationIssues.push(`TypeScript errors:\n${truncated}`);
          }
        }

        // 3. Auto-detect lint — if package.json has a lint script
        try {
          const pkgPath = path.join(workingDir, "package.json");
          if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
            if (pkg.scripts?.lint) {
              try {
                execSync("npm run lint 2>&1", { cwd: workingDir, timeout: 120_000, encoding: "utf-8" });
                output.log(story.persona, "Lint passed");
              } catch (lintErr) {
                const lintOutput = lintErr instanceof Error && "stdout" in lintErr ? String((lintErr as any).stdout) : String(lintErr);
                const truncated = lintOutput.split("\n").slice(0, 30).join("\n");
                validationIssues.push(`Lint errors:\n${truncated}`);
              }
            }
          }
        } catch {
          // package.json parse error — skip lint check
        }

        if (validationIssues.length > 0 && revision < 2) {
          output.log(story.persona, `Validation found ${validationIssues.length} issue(s) — retrying with fix context`);
          logger.info("Story validation failed, retrying", { persona: story.persona, issues: validationIssues.length });
          revisionFeedback = `\n\n## Validation Errors — Fix These Before Completing\n\n${validationIssues.join("\n\n")}`;
          continue; // retry with validation errors as context
        }
        if (validationIssues.length > 0) {
          // Final attempt also had issues — log but proceed (don't block forever)
          output.log(story.persona, `Validation issues remain after retries: ${validationIssues.length} issue(s)`);
          logger.info("Story validation issues on final attempt", { persona: story.persona, issues: validationIssues });
        }
      }

      // --- Inline Verifier (from worker/epic/inline-verifier.ts) ---
      // Spec compliance check: does the implementation satisfy the story description?
      // Read-only — no edits, just verification. If gaps found, feed back for one more pass.
      if (revision < 2) {
        try {
          output.status(`${story.persona}: verifying spec compliance...`);
          const { provider: vProvider, model: vModel, host: vHost, contextLength: vCtx } = getProviderForPersona(config, "tech_lead");
          const vApiKey = config.providers[vProvider]?.apiKey;
          if (vApiKey) {
            const envMap: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_GENERATIVE_AI_API_KEY" };
            const envVar = envMap[vProvider];
            const key = vApiKey.startsWith("{env:") ? process.env[vApiKey.slice(5, -1)] : vApiKey;
            if (envVar && key && !process.env[envVar]) process.env[envVar] = key;
          }

          const verifierModel = createModel(vProvider as AIProvider, vModel, vHost, vCtx);
          const verifierAllTools = createToolDefinitions(workingDir, verifierModel, sandboxed);
          const verifierTools: Record<string, AnyToolDef> = {};
          for (const toolName of ["read_file", "glob", "grep", "ls", "bash"]) {
            const toolDef = verifierAllTools[toolName as keyof typeof verifierAllTools] as AnyToolDef;
            if (toolDef) {
              verifierTools[toolName] = {
                ...toolDef,
                execute: async (input: Record<string, unknown>) => {
                  output.status(`verifier: checking...`);
                  const result = await toolDef.execute(input);
                  return result;
                },
              };
            }
          }

          const verifierSystemPrompt = `You are an independent QA Verification Agent. You did NOT write the code you are reviewing.

Your job: verify that the implementation satisfies every requirement from the original specification.

## Rules

- You are testing SPEC COMPLIANCE, not code quality. The code may be ugly but correct — that's a pass.
- For each requirement, determine: does the code actually do what the spec says?
- For API criteria: read the route handlers and verify the exact request/response shapes match.
- For database criteria: read the models/migrations and verify exact field names and types.
- For frontend criteria: read the components and verify exact UI elements and behavior.
- For test criteria: check if the specified tests exist and cover the stated scenarios.
- If you can verify a criterion by reading code alone, do that. Only run tests if reading isn't sufficient.
- NEVER start long-running processes (dev servers, watch modes, npm start, npm run dev, etc.)

## Communication Style

Write in a professional, direct tone. No filler words. Start with substance.

## Output Format

After checking all criteria, output:

VERIFICATION_DECISION: pass
OR
VERIFICATION_DECISION: partial_pass
OR
VERIFICATION_DECISION: fail

Then for each criterion that FAILED:

FAILED_CRITERION: [criterion text] | [reason for failure]

Then:

VERIFICATION_SUMMARY: [overall summary of findings]`;

          let verifierOutput = "";
          const verifierStream = streamText({
            model: verifierModel,
            abortSignal,
            system: verifierSystemPrompt,
            prompt: `## Task Specification\n\n${userTask}\n\n## Story Scope\n\nStory ${i + 1}: "${story.title}" — ${story.description}\n\n## Instructions\n\nVerify that the implementation in ${workingDir} satisfies the requirements above. Read the relevant files and check each requirement.\n\nWorking directory: ${workingDir}`,
            tools: verifierTools as ToolSet,
            stopWhen: stepCountIs(30),
            timeout: { totalMs: 3 * 60 * 1000, chunkMs: 120_000 },
            ...buildOllamaOptions(vProvider as AIProvider, vCtx),
            onStepFinish({ text }) {
              if (text) {
                verifierOutput += text + "\n";
              }
              output.status(`verifier: checking...`);
            },
          });
          for await (const _chunk of verifierStream.textStream) { /* consumed */ }
          const verifierUsage = await verifierStream.totalUsage;
          output.statusDone();

          costTracker.addUsage("Verifier", vProvider, vModel,
            verifierUsage?.inputTokens || 0, verifierUsage?.outputTokens || 0);
          output.updateCost?.(costTracker.getTotalCost());

          const vDecisionMatch = verifierOutput.match(/VERIFICATION_DECISION:\s*(pass|partial_pass|fail)/i);
          const vDecision = vDecisionMatch ? vDecisionMatch[1].toLowerCase() : "pass";

          if (vDecision === "pass") {
            output.log(story.persona, "Spec verification passed");
          } else {
            // Extract failed criteria
            const failedCriteria: string[] = [];
            const fcPattern = /FAILED_CRITERION:\s*(.+)/gi;
            let fcMatch;
            while ((fcMatch = fcPattern.exec(verifierOutput)) !== null) {
              failedCriteria.push(fcMatch[1].trim());
            }
            const vSummaryMatch = verifierOutput.match(/VERIFICATION_SUMMARY:\s*(.+)/i);
            const vSummary = vSummaryMatch ? vSummaryMatch[1].trim() : "Spec gaps detected";

            output.log(story.persona, `Spec verification: ${vDecision} — ${vSummary}`);
            logger.info("Spec verification failed", { decision: vDecision, failedCriteria: failedCriteria.length, persona: story.persona });

            // Feed gaps back to the executor for one more pass
            const gapDetails = failedCriteria.length > 0
              ? failedCriteria.map(c => `- ${c}`).join("\n")
              : vSummary;
            revisionFeedback = `\n\n## Spec Compliance Gaps — Fix These Before Completing\n\nThe QA verifier found that your implementation does not fully satisfy the spec:\n\n${gapDetails}\n\nFix these gaps. Do NOT rewrite what already works — only add what's missing.`;
            continue; // retry with gap feedback
          }
        } catch (verifierErr) {
          output.statusDone();
          logger.debug("Verifier error (non-fatal)", { error: verifierErr instanceof Error ? verifierErr.message : String(verifierErr) });
          // Verifier failure is non-fatal — proceed without it
        }
      }

      output.log(story.persona, `${story.title} — completed! (${i + 1}/${sorted.length})`);
      logger.info(`Story ${i + 1} completed`, { persona: story.persona, inputTokens: inTokens, outputTokens: outTokens });
          break; // Story succeeded, exit revision loop
    } catch (err) {
      output.statusDone();
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
        // Truncate error to avoid bloating the prompt
        const truncatedErr = errMsg.split("\n").slice(0, 40).join("\n");
        revisionFeedback = `\n\n## Error During Execution — Fix This\n\nCategory: ${errorClass.category}\n\n${truncatedErr}\n\n**${errorClass.fixHint}**`;
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
  }

  // Report failed/skipped stories before review
  if (failedStories.size > 0 || skippedStories.size > 0) {
    const failedNames = sorted.filter(s => failedStories.has(s.id)).map(s => s.title);
    const skippedNames = sorted.filter(s => skippedStories.has(s.id)).map(s => s.title);
    if (failedNames.length > 0) output.coordinatorLog(`Failed stories: ${failedNames.join(", ")}`);
    if (skippedNames.length > 0) output.coordinatorLog(`Skipped (blocked by dependency): ${skippedNames.join(", ")}`);
    logger.info("Story execution summary", { failed: [...failedStories], skipped: [...skippedStories], completed: sorted.length - failedStories.size - skippedStories.size });
  }

  // --- Integration Check (from worker/epic/inline-integration-fixer.ts) ---
  // For multi-story builds, run cross-story validation before review.
  // Auto-detects quality gates (typecheck, lint), runs them, and if they fail
  // spawns an integration fixer agent to resolve cross-story issues.
  const completedStories = sorted.filter(s => !failedStories.has(s.id) && !skippedStories.has(s.id));
  if (completedStories.length >= 2) {
    output.coordinatorLog("Running integration check across stories...");
    output.status("Integration check: validating cross-story compatibility...");
    logger.info("Starting integration check", { stories: completedStories.length });

    const integrationIssues: string[] = [];

    // Run typecheck across the full project
    if (fs.existsSync(path.join(workingDir, "tsconfig.json"))) {
      try {
        execSync("npx tsc --noEmit 2>&1", { cwd: workingDir, timeout: 300_000, encoding: "utf-8" });
      } catch (tscErr) {
        const tscOutput = tscErr instanceof Error && "stdout" in tscErr ? String((tscErr as any).stdout) : String(tscErr);
        integrationIssues.push(`TypeScript errors (cross-story):\n${tscOutput.split("\n").slice(0, 50).join("\n")}`);
      }
    }

    // Run lint across the full project
    try {
      const pkgPath = path.join(workingDir, "package.json");
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        if (pkg.scripts?.lint) {
          try {
            execSync("npm run lint 2>&1", { cwd: workingDir, timeout: 120_000, encoding: "utf-8" });
          } catch (lintErr) {
            const lintOutput = lintErr instanceof Error && "stdout" in lintErr ? String((lintErr as any).stdout) : String(lintErr);
            integrationIssues.push(`Lint errors (cross-story):\n${lintOutput.split("\n").slice(0, 30).join("\n")}`);
          }
        }
      }
    } catch { /* skip */ }

    // Go quality gates
    if (fs.existsSync(path.join(workingDir, "go.mod"))) {
      for (const cmd of ["go vet ./...", "go build ./..."]) {
        try {
          execSync(`${cmd} 2>&1`, { cwd: workingDir, timeout: 120_000, encoding: "utf-8" });
        } catch (goErr) {
          const goOutput = goErr instanceof Error && "stdout" in goErr ? String((goErr as any).stdout) : String(goErr);
          integrationIssues.push(`${cmd} errors:\n${goOutput.split("\n").slice(0, 30).join("\n")}`);
        }
      }
    }

    output.statusDone();

    if (integrationIssues.length > 0) {
      output.coordinatorLog(`Integration check found ${integrationIssues.length} issue(s) — spawning fixer...`);
      logger.info("Integration issues detected", { count: integrationIssues.length });

      try {
        const { provider: ifProvider, model: ifModel, host: ifHost, contextLength: ifCtx } = getProviderForPersona(config, "tech_lead");
        const ifApiKey = config.providers[ifProvider]?.apiKey;
        if (ifApiKey) {
          const envMap: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_GENERATIVE_AI_API_KEY" };
          const envVar = envMap[ifProvider];
          const key = ifApiKey.startsWith("{env:") ? process.env[ifApiKey.slice(5, -1)] : ifApiKey;
          if (envVar && key && !process.env[envVar]) process.env[envVar] = key;
        }

        const ifModel_ = createModel(ifProvider as AIProvider, ifModel, ifHost, ifCtx);
        const ifAllTools = createToolDefinitions(workingDir, ifModel_, sandboxed);
        const ifTools: Record<string, AnyToolDef> = {};
        for (const toolName of ["read_file", "write_file", "edit_file", "patch", "glob", "grep", "ls", "bash"]) {
          const toolDef = ifAllTools[toolName as keyof typeof ifAllTools] as AnyToolDef;
          if (toolDef) {
            ifTools[toolName] = {
              ...toolDef,
              execute: async (input: Record<string, unknown>) => {
                const allowed = await checkToolPermission(toolName, input, trustAll, sessionAllow, output);
                if (!allowed) return "Tool execution denied by user.";
                output.toolCall("integration_fixer", toolName, input);
                output.status("integration_fixer: working...");
                const result = await toolDef.execute(input);
                output.status("");
                return result;
              },
            };
          }
        }

        const ifSystemPrompt = `You are an Integration Fix Agent. Multiple AI experts worked on separate stories in the same codebase. Their combined changes introduced integration issues.

Fix ALL quality gate failures. You have access to ALL files in the repository.

## Common Integration Issues

- Missing props/types from one story expected by another
- Duplicate test query selectors or test IDs
- Conflicting imports or re-exports
- Incompatible function signatures across story boundaries
- Missing dependencies that one story assumed another would provide
- Service startup failures (missing env vars, wrong port bindings)
- Middleware configuration errors (wrong order, missing CORS, auth misconfiguration)

## Rules

- Fix EVERY failing command, not just the first
- Run each command after fixing to verify
- Do NOT refactor beyond what's needed to pass gates
- NEVER change language versions (Go, Node.js, Python version pins are intentional)
- NEVER change framework or dependency major versions unless explicitly incompatible
- NEVER modify configuration files (tsconfig.json, .eslintrc, etc.) to suppress errors — fix the CODE
- NEVER start long-running processes (dev servers, watch modes, npm start, etc.)

## Communication Style

Write in a professional, direct tone. No filler words. Start with substance.

## Output Format

After fixing (or determining it's unfixable), you MUST output:

INTEGRATION_FIX_DECISION: passed
OR
INTEGRATION_FIX_DECISION: fixed
OR
INTEGRATION_FIX_DECISION: unfixable

Then:

INTEGRATION_FIX_SUMMARY: <description of what you fixed or why it's unfixable>`;

        let ifOutput = "";
        output.status("integration_fixer: resolving cross-story issues...");
        const ifStream = streamText({
          model: ifModel_,
          abortSignal,
          system: ifSystemPrompt,
          prompt: `## Integration Failures\n\nThe following quality gate commands failed after all stories were applied:\n\n${integrationIssues.join("\n\n---\n\n")}\n\n## Stories That Were Executed\n\n${completedStories.map((s, idx) => `${idx + 1}. ${s.persona}: ${s.title} — ${s.description}`).join("\n")}\n\nWorking directory: ${workingDir}\n\nFix the integration issues. Run the failing commands after each fix to verify.`,
          tools: ifTools as ToolSet,
          stopWhen: stepCountIs(50),
          timeout: { totalMs: 5 * 60 * 1000, chunkMs: 120_000 },
          ...buildOllamaOptions(ifProvider as AIProvider, ifCtx),
          onStepFinish({ text }) {
            if (text) {
              ifOutput += text + "\n";
              const lines = text.split("\n").filter(l => l.trim());
              for (const line of lines) {
                if (line.includes("INTEGRATION_FIX_DECISION") || line.includes("INTEGRATION_FIX_SUMMARY")) continue;
                output.log("integration_fixer", line);
              }
            }
            output.status("integration_fixer: working...");
          },
        });
        for await (const _chunk of ifStream.textStream) { /* consumed */ }
        const ifUsage = await ifStream.totalUsage;
        output.statusDone();

        costTracker.addUsage("Integration Fixer", ifProvider, ifModel,
          ifUsage?.inputTokens || 0, ifUsage?.outputTokens || 0);
        output.updateCost?.(costTracker.getTotalCost());

        const ifDecisionMatch = ifOutput.match(/INTEGRATION_FIX_DECISION:\s*(passed|fixed|unfixable)/i);
        const ifDecision = ifDecisionMatch ? ifDecisionMatch[1].toLowerCase() : "unfixable";
        const ifSummaryMatch = ifOutput.match(/INTEGRATION_FIX_SUMMARY:\s*(.+)/i);
        const ifSummary = ifSummaryMatch ? ifSummaryMatch[1].trim() : "";

        if (ifDecision === "fixed") {
          output.coordinatorLog(`Integration issues resolved: ${ifSummary}`);
        } else if (ifDecision === "unfixable") {
          output.coordinatorLog(`Integration fixer could not resolve all issues: ${ifSummary}`);
        } else {
          output.coordinatorLog("Integration check passed after fixes");
        }
        logger.info("Integration fix result", { decision: ifDecision, summary: ifSummary });
      } catch (ifErr) {
        output.statusDone();
        logger.debug("Integration fixer error (non-fatal)", { error: ifErr instanceof Error ? ifErr.message : String(ifErr) });
        output.coordinatorLog("Integration fixer encountered an error — proceeding to review");
      }
    } else {
      output.coordinatorLog("Integration check passed — no cross-story issues");
      logger.info("Integration check passed");
    }
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
    logger.info("Starting review loop", { maxRevisions, provider: revProvider, model: revModel });
    for (let reviewRound = 1; reviewRound <= maxRevisions + 1; reviewRound++) {
      const isRevision = reviewRound > 1;
      logger.info(`Review round ${reviewRound}`, { isRevision, maxRevisions });
      output.coordinatorLog(isRevision ? `Starting Tech Lead review (revision ${reviewRound - 1}/${maxRevisions}, ${revProvider}/${revModel})...` : `Starting Tech Lead review (${revProvider}/${revModel})...`);
      output.log("tech_lead", `Starting agent execution (model: ${revModel})`);

      output.status(isRevision ? "Reviewer -- Re-checking after revisions" : "Reviewer -- Checking code quality");

      try {
        // Build review prompt with full context — matches WorkerMill's inline-reviewer.ts buildReviewPrompt()
        const previousFeedbackSection = isRevision && previousReviewFeedback
          ? `## Previous Review Feedback (Round ${reviewRound})
This is a revision attempt. The previous code was reviewed and these issues were identified:

${previousReviewFeedback}

**IMPORTANT: Check if ALL issues above have been addressed, not just some of them.**
- The developer was instructed to fix every item
- If ANY issue remains unaddressed, request another revision
- Be specific about which items are still outstanding

---

`
          : "";

        const storySummaryRows = sorted.map((s, idx) => {
          const files = [...new Set([...context.filesCreated, ...context.filesModified])]
            .join(", ") || "(none)";
          return `| ${idx + 1} | ${s.persona} | ${s.title} | ${files} |`;
        }).join("\n");

        // Gather actual code for the reviewer — don't depend on ::file_created:: markers
        // Gather ALL code for the reviewer — tracked diffs AND untracked files
        let codeDiff = "";
        try {
          const diff = execSync("git diff HEAD 2>/dev/null || git diff 2>/dev/null", {
            cwd: workingDir, encoding: "utf-8", stdio: "pipe", timeout: 10_000,
          }).trim();
          if (diff) codeDiff = diff + "\n\n";
        } catch {
          // Not a git repo or no changes staged
        }

        // ALWAYS check for untracked files — git diff misses new files entirely
        {
          let allFiles: string[] = [...new Set([...context.filesCreated, ...context.filesModified])].filter(Boolean);

          if (allFiles.length === 0) {
            try {
              const gitFiles = execSync(
                "git ls-files --others --modified --exclude-standard 2>/dev/null",
                { cwd: workingDir, encoding: "utf-8", stdio: "pipe", timeout: 5_000 },
              ).trim();
              if (gitFiles) allFiles = gitFiles.split("\n").filter(Boolean);
            } catch {
              // Not a git repo — will try filesystem scan
            }
          }

          // Still nothing? Scan for common source files
          if (allFiles.length === 0) {
            try {
              const found = execSync(
                "find . -maxdepth 4 -type f \\( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.py' -o -name '*.go' -o -name '*.json' -o -name '*.yml' -o -name '*.yaml' -o -name 'Dockerfile' \\) -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.workermill/*' -not -path '*/dist/*' | head -200",
                { cwd: workingDir, encoding: "utf-8", stdio: "pipe", timeout: 5_000 },
              ).trim();
              if (found) allFiles = found.split("\n").filter(Boolean);
            } catch {
              // find command failed — proceed with empty file list
            }
          }
          const fileContents: string[] = [];

          for (const f of allFiles) {
            try {
              const fullPath = path.isAbsolute(f) ? f : path.join(workingDir, f);
              const content = fs.readFileSync(fullPath, "utf-8");
              fileContents.push(`\n--- ${f} ---\n${content}`);
            } catch {
              // File may have been deleted since listing — skip
            }
          }
          if (fileContents.length > 0) {
            codeDiff += "\n## Untracked / New Files\n" + fileContents.join("\n");
          }
        }

        const reviewerProjectInstructions = formatProjectInstructions(workingDir);
        const reviewPrompt = `${previousFeedbackSection}${reviewerProjectInstructions ? `${reviewerProjectInstructions}\n\n` : ""}## Original Task

${userTask}

## Story Summary

| # | Persona | Title | Files |
|---|---------|-------|-------|
${storySummaryRows}

## Changes Made

Files created: ${context.filesCreated.join(", ") || "none"}
Files modified: ${context.filesModified.join(", ") || "none"}
${context.decisions.length > 0 ? `\nDecisions made:\n${context.decisions.map(d => `- ${d}`).join("\n")}` : ""}

## Actual Code

The following is the actual code that was written. Review THIS, not the summary above.

\`\`\`
${codeDiff || "(no code changes detected)"}
\`\`\`

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

**Bias toward approval**: If the code works and implements the spec requirements, approve it. Every revision cycle costs significant time and tokens — only request revision for real functional or security issues. A score of 7+ should almost always be an approval.

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
          timeout: { totalMs: 5 * 60 * 1000, chunkMs: 120_000 },
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
        const reviewUsage = await reviewStream.totalUsage;

        output.statusDone();

        // Extract review decision — 3-tier system matching WorkerMill worker
        const decisionMatch = reviewText.match(/REVIEW_DECISION:\s*(approved|revision_needed|rejected)/i);
        const decision = decisionMatch ? decisionMatch[1].toLowerCase() : null;
        const score = extractScore(reviewText); // informational only

        // Decision driven by REVIEW_DECISION marker. If absent, bias toward approval.
        const approved = decision ? decision === "approved" : true;
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
        if (approved) break;
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

        // --- Inline Review Fix (from worker/epic/inline-review-fixer.ts) ---
        // Try a lightweight surgical fix before full story re-execution.
        // If the fix succeeds, skip the expensive full revision and go straight back to review.
        {
          output.coordinatorLog("Attempting inline review fix (surgical)...");
          output.status("Inline fix: applying reviewer feedback...");
          logger.info("Attempting inline review fix", { reviewRound });

          const fixFeedback = reviewText;
          const fixModel = reviewModel; // reuse reviewer's model for the fix pass
          const fixTools: Record<string, AnyToolDef> = {};
          // Use full tool set (not read-only) since we need to edit files
          const fixAllTools = createToolDefinitions(workingDir, fixModel, sandboxed);
          const fixToolNames = ["read_file", "write_file", "edit_file", "patch", "glob", "grep", "ls", "bash", "git"];
          for (const toolName of fixToolNames) {
            const toolDef = fixAllTools[toolName as keyof typeof fixAllTools] as AnyToolDef;
            if (toolDef) {
              fixTools[toolName] = {
                ...toolDef,
                execute: async (input: Record<string, unknown>) => {
                  const allowed = await checkToolPermission(toolName, input, trustAll, sessionAllow, output);
                  if (!allowed) return "Tool execution denied by user.";
                  output.toolCall("review_fixer", toolName, input);
                  output.status("review_fixer: working...");
                  const result = await toolDef.execute(input);
                  output.status("");
                  return result;
                },
              };
            }
          }

          const fixSystemPrompt = `You are a Review Fix Agent. A Tech Lead reviewed the implementation and requested changes.
Your job is to apply ONLY the requested changes — do not rewrite unrelated code.

## Rules

- Only fix what the Tech Lead asked for. Do NOT refactor or improve other code.
- Read the feedback carefully — apply every requested change.
- If the feedback references specific files or lines, start there.
- Run any relevant build/lint/test commands to verify your changes don't break anything.
- You are making TARGETED FIXES to existing code. Do NOT rewrite files from scratch.
- READ each file BEFORE editing it.

## Communication Style

Write in a professional, direct tone. No filler words. Start with substance.

## Critical rules
- NEVER start long-running processes (dev servers, watch modes, npm start, npm run dev, etc.)
- NEVER run interactive commands that wait for user input
- Only run commands that complete and exit

## Output Format

After fixing (or determining it's unfixable), you MUST output one of these markers:

REVIEW_FIX_DECISION: fixed
REVIEW_FIX_SUMMARY: <what you fixed>

OR

REVIEW_FIX_DECISION: unfixable
REVIEW_FIX_SUMMARY: <why it cannot be surgically fixed>`;

          try {
            let fixOutput = "";
            const fixStream = streamText({
              model: fixModel,
              abortSignal,
              system: fixSystemPrompt,
              prompt: `## Reviewer Feedback — Fix These Issues\n\n${fixFeedback}\n\nWorking directory: ${workingDir}`,
              tools: fixTools as ToolSet,
              stopWhen: stepCountIs(50),
              timeout: { totalMs: 5 * 60 * 1000, chunkMs: 120_000 },
              ...buildOllamaOptions(revProvider as AIProvider, revCtx),
              onStepFinish({ text }) {
                if (text) {
                  fixOutput += text + "\n";
                  const lines = text.split("\n").filter(l => l.trim());
                  for (const line of lines) {
                    if (line.includes("REVIEW_FIX_DECISION") || line.includes("REVIEW_FIX_SUMMARY")) continue;
                    output.log("review_fixer", line);
                  }
                }
                output.status("review_fixer: thinking...");
              },
            });
            for await (const _chunk of fixStream.textStream) { /* drive */ }
            const fixUsage = await fixStream.totalUsage;
            output.statusDone();

            costTracker.addUsage("Review Fixer", revProvider, revModel,
              fixUsage?.inputTokens || 0, fixUsage?.outputTokens || 0);
            output.updateCost?.(costTracker.getTotalCost());

            const fixDecisionMatch = fixOutput.match(/REVIEW_FIX_DECISION:\s*(fixed|unfixable)/i);
            const fixDecision = fixDecisionMatch ? fixDecisionMatch[1].toLowerCase() : null;

            if (fixDecision === "fixed") {
              output.coordinatorLog("Inline fix succeeded — skipping full revision, re-reviewing...");
              logger.info("Inline review fix succeeded", { reviewRound });
              continue; // go straight back to the review loop
            }

            // unfixable or no marker — fall through to full revision
            const summaryMatch = fixOutput.match(/REVIEW_FIX_SUMMARY:\s*(.+)/i);
            const reason = summaryMatch ? summaryMatch[1].trim() : "no decision marker";
            output.coordinatorLog(`Inline fix could not resolve all issues (${reason}) — falling back to full revision`);
            logger.info("Inline review fix fell through", { fixDecision, reason });
          } catch (fixErr) {
            output.statusDone();
            const fixErrMsg = fixErr instanceof Error ? fixErr.message : String(fixErr);
            logger.debug("Inline review fix error", { error: fixErrMsg });
            output.coordinatorLog(`Inline fix failed (${fixErrMsg}) — falling back to full revision`);
          }
        }

        // Parse which stories need revision (selective revision from inline-reviewer.ts)
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
            // Include truncated diff for context (cap at 4K chars to avoid blowing up prompt)
            if (diffContent) {
              const truncatedDiff = diffContent.length > 4000
                ? diffContent.slice(0, 4000) + `\n... (${diffContent.length - 4000} chars truncated)`
                : diffContent;
              parts.push(`**Current diff (what exists now):**\n\`\`\`diff\n${truncatedDiff}\n\`\`\``);
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
          output.log(story.persona, `Starting revision: ${story.title} (${sProvider}/${sModel})`);

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

          const revisionSystemPrompt = `${storyPersona.systemPrompt}

Working directory: ${workingDir}

## Ticket Requirements — THIS IS YOUR SPEC

${userTask}

## Communication Style

Write in a professional, direct tone. Do NOT open messages with filler words or pleasantries. Start with the substance. Be concise.

## Critical rules
- NEVER start long-running processes (dev servers, watch modes, npm start, npm run dev, nodemon, tsc --watch, etc.)
- NEVER run interactive commands that wait for user input
- Only run commands that complete and exit
- You are making TARGETED FIXES to existing code. Do NOT rewrite files from scratch.
- READ each file BEFORE editing it. The code already works — you are fixing specific issues.`;

          try {
            // Build prior work section — prevents oscillation across revision rounds
            const priorWorkSection = priorWorkSummary
              ? `## What Was Done Before This Revision

The following work already exists from previous attempts. Do NOT undo or rewrite this work
unless the reviewer specifically flagged it as wrong. Build on what's there.

${priorWorkSummary}

**CRITICAL: If previous revisions already addressed an issue, do NOT redo or revert that work.
Only fix the specific issues the reviewer flagged below.**

`
              : "";

            const revStream = streamText({
              model: storyModel,
              abortSignal,
              system: revisionSystemPrompt,
              prompt: `${priorWorkSection}## Reviewer feedback — fix these specific issues:

${storyFeedback}

## Your scope

Story ${i + 1}: "${story.title}" — ${story.description}

## Instructions

1. READ the files mentioned in the feedback first
2. Make TARGETED edits to fix ONLY the issues the reviewer flagged
3. Do NOT delete or rewrite files — use edit_file for surgical changes
4. Do NOT add features or refactor code that wasn't flagged
5. If the reviewer says something is missing, add it — don't restructure what exists
6. Do NOT undo changes from previous revision rounds unless they were explicitly flagged`,
              tools: storyTools as ToolSet,
              stopWhen: stepCountIs(100),
              timeout: { totalMs: 5 * 60 * 1000, chunkMs: 120_000 },
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

  // Persist learnings as memories
  for (const learning of context.learnings) {
    addMemory("learning", learning);
  }

  // Git commit step
  try {
    // Auto-init git if not a repo
    try {
      execSync("git rev-parse --git-dir", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" });
    } catch {
      output.coordinatorLog("Initializing git repository...");
      execSync("git init", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" });
      const gitignorePath = `${workingDir}/.gitignore`;
      if (!fs.existsSync(gitignorePath)) {
        fs.writeFileSync(gitignorePath, "node_modules/\ndist/\n.env\n.workermill/\n*.log\n", "utf-8");
      }
      output.coordinatorLog("Git repo initialized");
    }

    const diff = execSync("git diff --stat", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
    // Also check for untracked files
    const untracked = execSync("git ls-files --others --exclude-standard", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
    const hasChanges = diff || untracked;

    if (hasChanges) {
      // Count changes for a compact summary
      const diffLines = diff ? diff.split("\n").length : 0;
      const untrackedFiles = untracked ? untracked.split("\n").filter(Boolean) : [];
      const parts: string[] = [];
      if (diffLines > 0) parts.push(`${diffLines} modified`);
      if (untrackedFiles.length > 0) parts.push(`${untrackedFiles.length} new`);
      output.coordinatorLog(`${parts.join(", ")} files`);

      if (!trustAll) {
        const cr = await output.confirm("Commit these changes?");
        const commitConfirmed = typeof cr === "object" ? cr.allowed : cr;
        if (commitConfirmed) {
          // Stage specific files from context (NOT git add -A)
          const filesToStage = [...context.filesCreated, ...context.filesModified].filter(Boolean);
          if (filesToStage.length > 0) {
            for (const f of filesToStage) {
              try {
                execSync(`git add "${f}"`, { cwd: workingDir, stdio: "pipe" });
              } catch {
                // File may have been deleted or moved — skip
              }
            }
          } else {
            // Fallback: stage tracked modified + all new files from context
            execSync("git add -u", { cwd: workingDir, stdio: "pipe" });
          }
          const storyTitles = sorted.map(s => s.title).join(", ");
          const msg = `feat: ${storyTitles}`.slice(0, 72);
          execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { cwd: workingDir, stdio: "pipe" });
          output.log("system", "Changes committed");
        }
      }
    }
  } catch (err) {
    logger.debug("Git commit step failed", { error: err instanceof Error ? err.message : String(err) });
  }

  // Final cost update — status bar shows the running total
  output.updateCost?.(costTracker.getTotalCost());
}
