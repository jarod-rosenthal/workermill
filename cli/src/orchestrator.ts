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
import { findModelInfo } from "../../api/src/providers/index.js";
import * as logger from "./logger.js";
import { CostTracker } from "./cost-tracker.js";
import type { CliConfig, HooksConfig } from "./config.js";
import { getProviderForPersona } from "./config.js";
import { runHooks, runLifecycleHooks, runPreHooksWithBlocking } from "./hooks.js";
import {
  isGitRepo, getCurrentBranch, createFeatureBranch,
  commitStoryChanges, commitRevisionChanges,
  captureStoryPriorWork, getDiffForReview, getDiffSinceCommit,
  getHeadHash, returnToOriginalBranch,
} from "./git-ops.js";
import { loadMemories, addMemory, extractMemoryMarkers, formatMemoriesForPrompt } from "./memory.js";
import { isDangerous, isDangerousFile, READ_TOOLS, checkPermissionRules } from "./safety.js";
import { saveShipRun, clearShipRun } from "./ship-state.js";
import { startAllMCPServers, getMCPToolDefinitions, stopAllMCPServers, autoDetectMCPServers, getMCPToolDefinitionsAsync } from "./mcp-client.js";
import { withConcurrencyControl } from "./tool-concurrency.js";

/** Check if an error indicates a rate limit (HTTP 429) and extract the wait duration. */
function isRateLimitError(err: unknown): { retryAfterMs: number } | null {
  if (!err || typeof err !== "object") return null;
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  // Quick exit — not a rate limit
  const RATE_LIMIT_SIGNALS = ["429", "rate limit", "too many requests", "quota exceeded"];
  if (!RATE_LIMIT_SIGNALS.some(signal => lower.includes(signal))) return null;

  // 1. Parse "retry after N" from the error message body
  const inlineSeconds = lower.match(/retry[\s\-_.]?after[:\s]+(\d+)/)?.[1];
  if (inlineSeconds) return { retryAfterMs: Number(inlineSeconds) * 1000 };

  // 2. Read the Retry-After HTTP header if the error exposes it
  const headers = (err as Record<string, unknown>).headers ?? (err as Record<string, unknown>).responseHeaders;
  if (headers && typeof headers === "object") {
    const raw = (headers as Record<string, string>)["retry-after"];
    const parsed = raw ? Number(raw) : NaN;
    if (!Number.isNaN(parsed) && parsed > 0) return { retryAfterMs: parsed * 1000 };
  }

  // 3. Fallback — wait 30 seconds
  return { retryAfterMs: 30_000 };
}

const MAX_RATE_LIMIT_RETRIES = 3;

/** Get context window for a model — from pricing registry or configured override.
 *  If unknown, defaults to 256K — no cloud model ships below that anymore. */
function getModelContext(model: string, configuredCtx?: number): number {
  if (configuredCtx) return configuredCtx;
  const info = findModelInfo(model);
  return info?.contextWindow || 256_000;
}

/** Format context limit for display: 200000 → "200K", 65536 → "64K" */
function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 1000)}K`;
  // Use /1024 for power-of-2 values (Ollama: 65536, 131072), /1000 for round values (200000)
  if (tokens >= 1000) {
    const k1024 = tokens / 1024;
    if (Number.isInteger(k1024)) return `${k1024}K`;
    return `${Math.round(tokens / 1000)}K`;
  }
  return `${tokens}`;
}

/** Sleep helper for rate limit backoff */
function rateLimitSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
  /** Update the git branch displayed in the status bar */
  updateBranch?: (branch: string) => void;
  /** Update running cost in the UI (optional — noop if not provided) */
  updateCost?: (cost: number) => void;
  /** Update tokens-per-second for a model (optional — noop if not provided) */
  updateTokPerSec?: (providerModel: string, tokPerSec: number) => void;
}

/**
 * External tools — teaches agents they can use bash for GitHub, web lookups, etc.
 */
const EXTERNAL_TOOLS = `

## External Tools Available via Bash

You have full access to CLI tools installed on this machine through the bash tool. Use them freely:

### GitHub CLI (\`gh\`)
- \`gh issue list\` — list open issues
- \`gh issue view 123\` — read a specific issue
- \`gh issue search "search query"\` — search issues
- \`gh pr list\` — list pull requests
- \`gh pr view 123\` — read a specific PR
- \`gh api repos/OWNER/REPO/issues\` — raw GitHub API access

### Web & Research
- Use the \`web_search\` tool to search the web for documentation, examples, or solutions
- Use the \`fetch\` tool to read web pages or API docs
- Use \`bash\` with \`curl\` for API calls or downloading files

### Package Managers
- \`npm\`, \`yarn\`, \`pnpm\` — install dependencies, run scripts
- \`pip\`, \`cargo\`, \`go get\` — language-specific package managers

You are NOT restricted to just reading and writing files. Use any available CLI tool to gather information, install dependencies, or verify your work. The only restriction is on destructive commands (rm -rf /, git push --force, etc.) and long-running processes (dev servers, watch modes).
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

// DANGEROUS_PATTERNS, READ_TOOLS, ACCEPT_EDITS_TOOLS imported from ./safety.js

/**
 * Check tool permission using output.confirm() instead of readline.
 * Mirrors the logic from PermissionManager but uses the callback-based output interface.
 */
export async function checkToolPermission(
  toolName: string,
  toolInput: Record<string, unknown>,
  trustAll: boolean | (() => boolean),
  sessionAllow: Set<string>,
  output: OrchestrationOutput,
  permissionRules?: { allow?: string[]; deny?: string[] },
): Promise<boolean> {
  // Check trust mode first — bypass skips all permission prompts including dangerous checks
  const isTrustedEarly = typeof trustAll === "function" ? trustAll() : trustAll;
  const isBypass = isTrustedEarly || sessionAllow.has("*");

  // Dangerous command check
  if (toolName === "bash") {
    const cmd = String(toolInput.command || "");
    const danger = isDangerous(cmd);
    if (danger && !isBypass) {
      output.error(`DANGEROUS: ${danger}`);
      output.error(`Command: ${cmd}`);
      const result = await output.confirm("This is a dangerous operation. Are you sure?");
      return typeof result === "object" ? result.allowed : result;
    }
  }

  // Dangerous file path check for write operations
  if (toolName === "write_file" || toolName === "edit_file" || toolName === "patch") {
    const filePath = String(toolInput.path || toolInput.file_path || "");
    const fileDanger = isDangerousFile(filePath);
    if (fileDanger && !isBypass) {
      output.error(`SENSITIVE FILE: ${fileDanger}`);
      output.error(`Path: ${filePath}`);
      const result = await output.confirm("This file may be sensitive. Are you sure?");
      return typeof result === "object" ? result.allowed : result;
    }
  }

  // Granular permission rules — deny > ask > allow.
  const ruleResult = checkPermissionRules(toolName, toolInput, permissionRules);
  if (ruleResult === "deny") return false;
  // "ask" falls through to prompt below
  if (ruleResult === "allow") return true;

  if (ruleResult !== "ask") {
    // Normal mode checks (skip if "ask" rule forced a prompt)
    const isTrusted = typeof trustAll === "function" ? trustAll() : trustAll;
    if (isTrusted) return true;
    if (READ_TOOLS.has(toolName)) return true;
    if (sessionAllow.has(toolName) || sessionAllow.has("*")) return true;
  }

  // Prompt user — Yes / Yes don't ask again / Deny
  const display = formatToolCallDisplay(toolName, toolInput);
  const result = await output.confirm(`Allow ${toolName}? ${display}`);

  if (typeof result === "object") {
    if (result.mode === "trust" && result.allowed) {
      // "Trust all" — add wildcard to session allow so all future tools auto-approve
      sessionAllow.add("*");
    } else if (result.mode === "always" && result.allowed) {
      // "Yes, don't ask again" — for bash save permanent rule, otherwise session-only
      if (toolName === "bash" && toolInput.command) {
        const { commandToRule } = await import("./safety.js");
        const { loadConfig, saveConfig } = await import("./config.js");
        try {
          const cfg = loadConfig();
          if (cfg) {
            cfg.permissions = cfg.permissions || {};
            cfg.permissions.allow = cfg.permissions.allow || [];
            const rule = commandToRule(String(toolInput.command));
            if (!cfg.permissions.allow.includes(rule)) {
              cfg.permissions.allow.push(rule);
            }
            saveConfig(cfg);
          }
        } catch {
          // Fall back to session-only
        }
      }
      sessionAllow.add(toolName);
    }
    return result.allowed;
  }

  // Simple boolean — allow once, no persistence
  return result;
}

/** Format a tool call for display — short and to the point. */
function formatToolCallDisplay(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolInput.file_path) return String(toolInput.file_path);
  if (toolInput.path) return String(toolInput.path);
  if (toolInput.command) {
    const cmd = String(toolInput.command);
    return cmd.length > 80 ? cmd.slice(0, 77) + "..." : cmd;
  }
  return "";
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
      const cycleStory = idMap.get(id);
      logger.warn("Circular story dependency detected — breaking cycle", { storyId: id, storyTitle: cycleStory?.title || "unknown" });
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
  sandboxed: boolean | "os",
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

  // Add MCP tools to planner's read-only tools
  const plannerMcpTools = getMCPToolDefinitions();
  for (const [key, def] of Object.entries(plannerMcpTools)) {
    readOnlyTools[key] = def;
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
  output.log("planner", `Planning with \x1b[36m${pProvider}/${pModel}\x1b[0m (${formatContext(getModelContext(pModel, pCtx))} context)`);
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
    // Track tok/s for planner model
    const planElapsed = (Date.now() - planStart) / 1000;
    const planOutTokens = planUsage?.outputTokens || 0;
    if (planOutTokens > 0 && planElapsed > 0) {
      const planTokPerSec = Math.round(planOutTokens / planElapsed);
      output.updateTokPerSec?.(`${pProvider}/${pModel}`, planTokPerSec);
      logger.info("Model performance", { provider: pProvider, model: pModel, tokPerSec: planTokPerSec });
    }
  } catch (planErr) {
    clearInterval(heartbeat);
    output.statusDone();
    if (abortSignal?.aborted) {
      logger.info("Planner cancelled by user");
      output.coordinatorLog("Build cancelled by user.");
      return { stories: [], provider: pProvider, model: pModel, inputTokens: 0, outputTokens: 0, rejected: true, rejectionReason: "Cancelled" };
    }
    // TODO: Rate limit retry for planner — requires extracting planner into a separate function
    // to enable clean retry. For now, the error message surfaces the rate limit to the user.
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

  // 3. Fallback from decision text — return middle-of-range values,
  // never hardcode the approval threshold. The caller compares against config.
  if (/\bapprove/i.test(text)) return 10;
  if (/\brevis/i.test(text)) return 5;
  if (/\breject/i.test(text)) return 2;

  return 5; // No score found — assume mediocre, let threshold decide
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

/** Result from a completed (or failed) orchestration — used by /retry. */
export interface OrchestrationResult {
  stories: Story[];
  completedStoryIds: string[];
  featureBranch: string | null;
  userTask: string;
}

/** Retry plan — skips planning, resumes from first incomplete story. */
export interface RetryPlan {
  stories: Story[];
  completedStoryIds: string[];
  featureBranch: string;
  mainBranch: string;
}

export async function runOrchestration(
  config: CliConfig,
  userTask: string,
  trustAll: boolean | (() => boolean),
  sandboxed: boolean | "os",
  output: OrchestrationOutput,
  abortSignal?: AbortSignal,
  retryPlan?: RetryPlan,
  ticketKey?: string,
): Promise<OrchestrationResult> {
  // Resolve file references so "/build spec.md" becomes the full spec content
  userTask = resolveTaskInput(userTask, process.cwd());

  // Resolve ticket references — fetch from issue tracker if ticketKey is set
  if (ticketKey) {
    try {
      const { TicketOps } = await import("./ticket-ops.js");
      const ticketSystem = config.ticketSystem || "github";

      // Ensure credentials are available
      if (ticketSystem === "jira" && config.jira) {
        process.env.JIRA_BASE_URL = config.jira.baseUrl;
        process.env.JIRA_EMAIL = config.jira.email;
        process.env.JIRA_API_TOKEN = config.jira.apiToken;
      } else if (ticketSystem === "linear" && config.linear) {
        process.env.LINEAR_API_KEY = config.linear.apiKey;
      }
      if (ticketSystem === "github") {
        if (!process.env.GITHUB_TOKEN) {
          try {
            process.env.GITHUB_TOKEN = execSync("gh auth token 2>/dev/null", { encoding: "utf-8", stdio: "pipe" }).trim();
          } catch { /* gh not installed or not logged in */ }
        }
        if (!process.env.GITHUB_REPO) {
          try {
            const remote = execSync("git remote get-url origin 2>/dev/null", { encoding: "utf-8", stdio: "pipe" }).trim();
            const match = remote.match(/github\.com[:/]([^/]+\/[^/.]+)/);
            if (match) process.env.GITHUB_REPO = match[1].replace(/\.git$/, "");
          } catch { /* not a git repo */ }
        }
      }

      const ops = new TicketOps(ticketKey, ticketSystem);
      if (!ops.isAvailable()) {
        const hints: Record<string, string> = {
          github: "Ensure GITHUB_TOKEN is set or run `gh auth login`. Repo detected from git remote.",
          jira: "Run `/setup` to add your Jira URL, email, and API token (generate at id.atlassian.com).",
          linear: "Run `/setup` to add your Linear API key (generate at linear.app/settings/api).",
        };
        output.error(`Cannot connect to ${ticketSystem} — credentials not found.\n${hints[ticketSystem] || "Run `/setup` to configure your issue tracker."}`);
        return { stories: [], completedStoryIds: [], featureBranch: null, userTask };
      }
      const ticket = await ops.fetchTicket();
      if (ticket) {
        userTask = `# ${ticket.title}\n\n${ticket.body}${ticket.labels?.length ? `\n\nLabels: ${ticket.labels.join(", ")}` : ""}`;
        output.coordinatorLog(`Fetched ${ticketKey}: ${ticket.title}`);
      } else {
        const hints: Record<string, string> = {
          github: `Verify the issue exists at github.com and your token has repo access.`,
          jira: `Verify ${ticketKey} exists and your API token has read permissions.`,
          linear: `Verify ${ticketKey} exists and your API key has access to this team.`,
        };
        output.error(`Could not fetch ${ticketKey} from ${ticketSystem}.\n${hints[ticketSystem] || ""}`);
        return { stories: [], completedStoryIds: [], featureBranch: null, userTask };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      output.error(`Failed to fetch ${ticketKey}: ${msg}`);
      return { stories: [], completedStoryIds: [], featureBranch: null, userTask };
    }
  }

  // Create a reusable TicketOps instance for posting updates throughout the run
  let ticketOps: InstanceType<typeof import("./ticket-ops.js").TicketOps> | null = null;
  if (ticketKey) {
    try {
      const { TicketOps } = await import("./ticket-ops.js");
      const ticketSystem = config.ticketSystem || "github";
      const ops = new TicketOps(ticketKey, ticketSystem);
      logger.info("TicketOps availability check", {
        ticketKey, ticketSystem, isAvailable: ops.isAvailable(),
        hasToken: !!process.env.GITHUB_TOKEN,
        hasRepo: !!process.env.GITHUB_REPO,
      });
      if (ops.isAvailable()) ticketOps = ops;
    } catch { /* non-critical */ }
  }

  // Ensure Ollama models are loaded with the correct context length
  const defaultProvider = getProviderForPersona(config);
  if (defaultProvider.provider === "ollama" || config.providers[defaultProvider.provider]?.host) {
    const host = defaultProvider.host || config.providers[defaultProvider.provider]?.host || "http://localhost:11434";
    const ctx = config.providers[defaultProvider.provider]?.contextLength;
    if (ctx) {
      await ensureOllamaContext(host, defaultProvider.model, ctx);
    }
  }

  // Start MCP servers — auto-detect Docker Desktop + user config
  const mcpConfig = autoDetectMCPServers(config.mcp || {});
  if (Object.keys(mcpConfig).length > 0) {
    output.coordinatorLog(`Starting ${Object.keys(mcpConfig).length} MCP server(s)...`);
    await startAllMCPServers(mcpConfig);
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

  runLifecycleHooks("ship_start", config.hooks, workingDir, { WORKERMILL_TASK: userTask.slice(0, 200) });

  // Track completed story IDs for the result (used by /retry)
  const completedStoryIds: string[] = [];

  let featureBranch: string | null;
  let mainBranch: string;
  let sorted: Story[];

  if (retryPlan) {
    // ── Retry mode: skip planning, resume on the existing feature branch ──
    featureBranch = retryPlan.featureBranch;
    mainBranch = retryPlan.mainBranch;
    const currentBranch = getCurrentBranch(workingDir);

    // Checkout the feature branch if we're not already on it
    if (currentBranch !== featureBranch) {
      // Verify branch exists
      try {
        execSync(`git rev-parse --verify "${featureBranch}"`, { cwd: workingDir, stdio: "pipe" });
      } catch {
        output.error(`Branch \`${featureBranch}\` no longer exists. Nothing to retry.`);
        return { stories: retryPlan.stories, completedStoryIds: [...retryPlan.completedStoryIds], featureBranch, userTask };
      }

      output.coordinatorLog(`Switching to \`${featureBranch}\`...`);
      try {
        execSync(`git checkout "${featureBranch}"`, { cwd: workingDir, stdio: "pipe" });
      } catch {
        output.error(`Could not checkout \`${featureBranch}\` — you have uncommitted changes. Commit or stash them first, then \`/retry\`.`);
        return { stories: retryPlan.stories, completedStoryIds: [...retryPlan.completedStoryIds], featureBranch, userTask };
      }
    }
    output.updateBranch?.(featureBranch);
    await new Promise(r => setTimeout(r, 0));

    sorted = retryPlan.stories;
    completedStoryIds.push(...retryPlan.completedStoryIds);
    const remaining = sorted.filter(s => !retryPlan.completedStoryIds.includes(s.id));
    const actionable = remaining.filter(s => !s.dependsOn?.some(dep => remaining.some(r => r.id === dep)));
    const blocked = remaining.length - actionable.length;
    const summary = blocked > 0
      ? `${retryPlan.completedStoryIds.length} done, ${actionable.length} to run, ${blocked} blocked by dependencies`
      : `${retryPlan.completedStoryIds.length} done, ${remaining.length} remaining`;
    output.coordinatorLog(`Retrying on branch: ${featureBranch} — ${summary}`);
    remaining.forEach((s, i) => {
      output.log("coordinator", `Story ${i + 1}/${remaining.length}: [${s.persona}] ${s.title}`);
    });
  } else {
    // ── Normal mode: plan on current branch, create feature branch after acceptance ──
    const originalBranch = getCurrentBranch(workingDir);
    mainBranch = originalBranch || "main";

    // Planner runs on the current branch — no branch created yet
    const planResult = await planStories(config, userTask, workingDir, sandboxed, output, abortSignal);

    // Track planner cost
    costTracker.addUsage("Planner", planResult.provider, planResult.model, planResult.inputTokens, planResult.outputTokens);
    output.updateCost?.(costTracker.getTotalCost());

    // Handle planner rejection — still on original branch, nothing to clean up
    if (planResult.rejected) {
      output.log("system", `The planner determined this task should not proceed: ${planResult.rejectionReason || "unspecified reason"}`);
      output.log("system", "Refine your spec and try again.");
      return { stories: [], completedStoryIds: [], featureBranch: null, userTask };
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

    // [EXPERIMENTAL] Planning critic — not yet implemented.
    // The platform has a battle-tested Planner-Critic loop in
    // api/src/services/critic-agent.ts (cloud) and critic-agent-local.ts (local).
    // It scores plans on completeness, feasibility, dependencies, quality, and risk
    // (85/100 threshold, up to 3 refinement iterations). When we add full spec builds
    // to the CLI, port the local critic (buildCriticPrompt, runLocalCriticAgent,
    // runPlanCriticLoop) from critic-agent-local.ts — it already supports all providers.
    if (config.review?.useCritic) {
      output.log("planner", "Planning critic is experimental and not yet implemented — skipping.");
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
    sorted = topologicalSort(plannerStories);
    logger.info("Topological sort result", { input: plannerStories.length, output: sorted.length, ids: sorted.map(s => s.id) });

    // Prompt user to proceed (unless --trust mode)
    // Still on original branch — declining costs nothing
    if (!(typeof trustAll === "function" ? trustAll() : trustAll)) {
      let proceed = false;
      try {
        const r = await output.confirm("Execute this plan?");
        proceed = typeof r === "object" ? r.allowed : r;
      } catch (err) {
        logger.debug("Plan confirmation failed", { error: err instanceof Error ? err.message : String(err) });
      }
      if (!proceed) {
        output.log("system", "Plan cancelled.");
        return { stories: sorted, completedStoryIds: [], featureBranch: null, userTask };
      }
    }

    // ── Plan accepted — NOW create the feature branch ──
    // Ticket-driven: use ticket key as prefix, title as slug
    // File/inline: use repo name as prefix, task text as slug
    let branchPrefix: string | undefined;
    let branchLabel: string;
    if (ticketKey) {
      branchPrefix = ticketKey.startsWith("#")
        ? `GH-${ticketKey.slice(1)}`
        : ticketKey.toUpperCase();
      // Use just the title line (first line after "# ") not the whole body
      const titleMatch = userTask.match(/^# (.+)/m);
      branchLabel = titleMatch ? titleMatch[1] : userTask;
    } else {
      const fileRefForBranch = userTask.match(/[\w./-]+\.(?:md|txt|yaml|yml|json)\b/i);
      branchLabel = fileRefForBranch ? fileRefForBranch[0] : userTask;
    }
    featureBranch = createFeatureBranch(workingDir, branchLabel, branchPrefix);
    if (featureBranch) {
      output.coordinatorLog(`Working on branch: ${featureBranch}`);
      output.updateBranch?.(featureBranch);
      // Yield to let Ink render the branch update
      await new Promise(r => setTimeout(r, 0));
    } else if (isGitRepo(workingDir)) {
      output.error("Could not create feature branch. You may have uncommitted changes — commit or stash them first.");
      return { stories: sorted, completedStoryIds: [], featureBranch: null, userTask };
    }
    // If not a git repo, featureBranch stays null — commits and state persistence are skipped
  }

  // Helper: consistent exit message when stories are incomplete
  let retryable = true; // set to false when run made no progress
  function logRetryHint(): void {
    if (!featureBranch || !retryable) return;
    const done = completedStoryIds.length;
    const total = sorted.length;
    if (done < total) {
      output.coordinatorLog(`Staying on branch \`${featureBranch}\` — ${done}/${total} stories completed. Run \`/retry\` to continue.`);
    }
  }

  // Persist the plan so /retry works even if the first story fails
  if (featureBranch) {
    saveShipRun({ workingDir, featureBranch, mainBranch, userTask, stories: sorted, completedStoryIds, updatedAt: "" });
  }

  // Track failed and blocked stories — matches worker/epic/coordinator-stories.ts pattern
  const failedStories = new Set<string>();
  const skippedStories = new Set<string>();

  for (let i = 0; i < sorted.length; i++) {
    // Check if user cancelled (ESC) before starting next story
    if (abortSignal?.aborted) {
      output.coordinatorLog("Build cancelled.");
      logger.info("Build cancelled by user before story start", { storyIndex: i });
      logRetryHint();
      return { stories: sorted, completedStoryIds, featureBranch, userTask };
    }

    const story = sorted[i];

    // Skip already-completed stories (retry mode)
    if (completedStoryIds.includes(story.id)) {
      output.log("system", `Skipping story ${i + 1}/${sorted.length}: "${story.title}" — already completed`);
      continue;
    }

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
    output.log(story.persona, `Starting ${story.title} (\x1b[38;5;208m${provider}/${modelName}\x1b[0m, ${formatContext(getModelContext(modelName, contextLength))} context)`);
    logger.info(`Story ${i + 1}/${sorted.length} started`, { persona: story.persona, title: story.title, provider, model: modelName });

    output.status(`${story.persona}: ${story.title.slice(0, 60)}`);

    const model = createModel(provider as AIProvider, modelName, host, contextLength);

    // Build tools filtered by persona's allowed tools
    const allTools = createToolDefinitions(workingDir, model, sandboxed);
    const storyHealth: { testResults?: string; buildErrors?: string; servicesRunning?: string[] } = {};
    const personaTools: Record<string, AnyToolDef> = {};
    // Loop detection — matches worker/ai-clients/ai-sdk-client.ts
    // Reset per revision so a tool loop on revision 0 doesn't permanently abort retries
    const LOOP_WINDOW = 6;
    const LOOP_THRESHOLD = 4;
    let recentToolSignatures: string[] = [];
    let loopAbort = new AbortController();
    for (const toolName of persona.tools) {
      const toolDef = allTools[toolName as keyof typeof allTools] as AnyToolDef;
      if (toolDef) {
        personaTools[toolName] = {
          ...toolDef,
          execute: async (input: Record<string, unknown>) => {
            const allowed = await checkToolPermission(toolName, input, trustAll, sessionAllow, output, config.permissions);
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
            const hookResult = runPreHooksWithBlocking(toolName, config.hooks, workingDir, { input: JSON.stringify(input).substring(0, 10000) });
            if (hookResult.blocked) {
              return `Tool blocked by pre-hook: ${hookResult.reason}`;
            }
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

    // Merge MCP tools into persona tools — same pattern as useAgent.ts
    const mcpTools = getMCPToolDefinitions();
    for (const [key, def] of Object.entries(mcpTools)) {
      personaTools[key] = def;
    }

    // TODO: Deferred tool loading — skipped in orchestrator because persona-based filtering
    // already limits tools per story. MCP tools are the only unbounded set. If MCP tool counts
    // become large, add partitionTools() here (see useAgent.ts for the pattern).

    // Add skill tool — lets story workers invoke custom skills mid-execution
    personaTools["skill"] = {
      description: "Invoke a custom skill by name. Skills are reusable workflows from .workermill/skills/.",
      inputSchema: z.object({
        name: z.string().describe("The skill name to invoke"),
        args: z.string().optional().describe("Optional arguments"),
      }),
      execute: async ({ name: skillName, args }: { name: string; args?: string }) => {
        const { loadCustomCommands } = await import("./custom-commands.js");
        const skills = loadCustomCommands();
        const match = skills.find(
          (s: { name: string }) => s.name.toLowerCase() === skillName.toLowerCase(),
        );
        if (!match) return `Skill "${skillName}" not found.`;
        return args ? `${match.prompt}\n\n**Arguments:** ${args}` : match.prompt;
      },
    };

    // Apply concurrency control — safe tools (read_file, list_dir, etc.) run in parallel
    for (const [name, td] of Object.entries(personaTools)) {
      if (td && typeof td.execute === "function") {
        const original = td.execute;
        (personaTools as any)[name] = { ...td, execute: withConcurrencyControl(name, original as any) };
      }
    }

    const startedDockerCompose = new Set<string>(); // tracks cwd where compose was started

    let revisionFeedback = "";
    let storyRateLimitRetries = 0;
    for (let revision = 0; revision <= 2; revision++) {

    // Reset loop detection for each revision attempt
    recentToolSignatures = [];
    loopAbort = new AbortController();

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
${DOCKER_INSTRUCTIONS}${VERSION_TRUST}${IGNORE_WORKERMILL}${EXTERNAL_TOOLS}${revisionFeedback ? `\n\n## Revision requested\n${revisionFeedback}` : ""}`;

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
      let expertSummary = ""; // Captures the expert's post-work summary for ticket comments

      // Track tool calls for structured ticket update
      const storyActions: Array<{ tool: string; detail: string }> = [];

      const storyStartMs = Date.now();
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
            // Track actions for ticket update
            for (const tc of toolCalls) {
              const name = tc.toolName;
              const input = tc.input as Record<string, unknown>;
              if (name === "write_file" && input.file_path) {
                storyActions.push({ tool: "created", detail: String(input.file_path) });
              } else if ((name === "edit_file" || name === "patch") && input.file_path) {
                storyActions.push({ tool: "edited", detail: String(input.file_path) });
              } else if (name === "bash" && input.command) {
                const cmd = String(input.command);
                // Only track meaningful commands, not reads
                if (/npm (test|run|install)|npx|yarn|pnpm|docker|go (build|test)|pytest|cargo|make|mvn|gradle/i.test(cmd)) {
                  storyActions.push({ tool: "ran", detail: cmd.length > 80 ? cmd.slice(0, 77) + "..." : cmd });
                }
              } else if (name === "verify" && input.command) {
                storyActions.push({ tool: "verified", detail: String(input.command).slice(0, 80) });
              }
            }
          } else if (text && hadToolCalls) {
            consecutiveTextOnlySteps++;
            // Capture first post-work summary for ticket comments (don't display — noise in CLI)
            if (consecutiveTextOnlySteps === 1) expertSummary = text.slice(0, 2000);
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
        output.coordinatorLog("Build cancelled.");
        logRetryHint();
        return { stories: sorted, completedStoryIds, featureBranch, userTask };
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

      // Track tok/s for worker model
      const storyElapsed = (Date.now() - storyStartMs) / 1000;
      if (outTokens > 0 && storyElapsed > 0) {
        const workerTokPerSec = Math.round(outTokens / storyElapsed);
        output.updateTokPerSec?.(`${provider}/${modelName}`, workerTokPerSec);
        logger.info("Model performance", { provider, model: modelName, tokPerSec: workerTokPerSec });
      }

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
        output.coordinatorLog("Build cancelled.");
        logRetryHint();
        return { stories: sorted, completedStoryIds, featureBranch, userTask };
      }

      output.log(story.persona, `${story.title} — completed! (${i + 1}/${sorted.length})`);
      logger.info(`Story ${i + 1} completed`, { persona: story.persona, inputTokens: inTokens, outputTokens: outTokens });
      completedStoryIds.push(story.id);

      // Post story completion to ticket — structured update like a real team member
      if (ticketOps) {
        // Build structured summary from actual tool calls
        const created = [...new Set(storyActions.filter(a => a.tool === "created").map(a => a.detail))];
        const edited = [...new Set(storyActions.filter(a => a.tool === "edited").map(a => a.detail))];
        const commands = storyActions.filter(a => a.tool === "ran" || a.tool === "verified");

        const updateParts: string[] = [];

        // Lead with the expert's own summary if available
        if (expertSummary) {
          updateParts.push(expertSummary);
          updateParts.push("");
        }

        // Concrete actions taken
        const actionLines: string[] = [];
        if (created.length > 0) actionLines.push(`**Created:** ${created.map(f => `\`${f}\``).join(", ")}`);
        if (edited.length > 0) actionLines.push(`**Modified:** ${edited.map(f => `\`${f}\``).join(", ")}`);
        if (commands.length > 0) {
          const cmdList = commands.slice(0, 5).map(c => `\`${c.detail}\``).join(", ");
          actionLines.push(`**Ran:** ${cmdList}${commands.length > 5 ? ` +${commands.length - 5} more` : ""}`);
        }
        if (actionLines.length > 0) {
          updateParts.push("**Actions:**");
          updateParts.push(...actionLines);
        }

        // Fallback if no actions tracked
        if (updateParts.length === 0) {
          const changedFiles = [...new Set([...context.filesCreated, ...context.filesModified])];
          updateParts.push(`Implemented ${story.title}. ${changedFiles.length} file${changedFiles.length !== 1 ? "s" : ""} changed.`);
        }

        ticketOps.postComment(
          `### ${story.persona} — ${story.title} (${i + 1}/${sorted.length})\n\n${updateParts.join("\n")}`
        ).catch(() => {});
      }

      // Persist progress so /retry works across terminal restarts
      if (featureBranch) {
        saveShipRun({ workingDir, featureBranch, mainBranch, userTask, stories: sorted, completedStoryIds, updatedAt: "" });
      }

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
        output.coordinatorLog("Build cancelled.");
        logger.info("Build cancelled by user during story execution", { story: i + 1, persona: story.persona });
        logRetryHint();
        return { stories: sorted, completedStoryIds, featureBranch, userTask };
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Story ${i + 1} error`, { persona: story.persona, error: errMsg, revision });

      // Rate limit retry with backoff — retry in-place before falling through to error classification
      const rl = isRateLimitError(err);
      if (rl && storyRateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
        storyRateLimitRetries++;
        const waitSec = Math.ceil(rl.retryAfterMs / 1000);
        output.log("system", `Rate limited — retrying in ${waitSec}s (${storyRateLimitRetries}/${MAX_RATE_LIMIT_RETRIES})`);
        logger.info("Rate limit retry", { story: i + 1, attempt: storyRateLimitRetries, waitSec });
        await rateLimitSleep(rl.retryAfterMs);
        continue; // retry same revision
      }

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

    // If no new stories completed in this run, the plan can't make progress.
    // Clear state so /retry doesn't repeat the same failures.
    const newCompletions = completedStoryIds.filter(id => !retryPlan?.completedStoryIds.includes(id));
    if (newCompletions.length === 0 && failedStories.size > 0) {
      output.coordinatorLog("No stories completed — this run made no progress. Edit your spec and `/ship` again.");
      if (featureBranch) clearShipRun(featureBranch);
      retryable = false;
    }
  }

  // Review config
  const reviewEnabled = config.review?.enabled !== false; // default: true
  const maxRevisions = config.review?.maxRevisions ?? 3;
  let autoRevise = config.review?.autoRevise ?? false;

  // Run inline review with revision loop
  let finalReviewText = ""; // Captures the approved review for use in PR body
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
    // Check if user cancelled before starting review
    if (abortSignal?.aborted) {
      output.coordinatorLog("Build cancelled.");
      logRetryHint();
      return { stories: sorted, completedStoryIds, featureBranch, userTask };
    }
    logger.info("Starting review loop", { maxRevisions, provider: revProvider, model: revModel });
    let preRevisionHash = ""; // Tracks HEAD before each revision — so reviewer sees only what changed
    for (let reviewRound = 1; reviewRound <= maxRevisions + 1; reviewRound++) {
      const isRevision = reviewRound > 1;
      logger.info(`Review round ${reviewRound}`, { isRevision, maxRevisions });
      output.coordinatorLog(isRevision ? `Starting Tech Lead review (revision ${reviewRound - 1}/${maxRevisions}, ${revProvider}/${revModel})...` : `Starting Tech Lead review (${revProvider}/${revModel})...`);
      output.log("tech_lead", `Reviewing with \x1b[35m${revProvider}/${revModel}\x1b[0m (${formatContext(getModelContext(revModel, revCtx))} context)`);

      output.status(isRevision ? "Reviewer -- Re-checking after revisions" : "Reviewer -- Checking code quality");

      try {
        // Build review prompt with full context — matches WorkerMill's inline-reviewer.ts buildReviewPrompt()
        const previousFeedbackSection = isRevision && previousReviewFeedback
          ? `## Previous Review Feedback (Round ${reviewRound})
This is a revision attempt. The previous code was reviewed and these issues were identified:

${previousReviewFeedback}

**Evaluate whether the revision addressed the issues you raised.**
- If your major issues were fixed, approve — even if minor items remain
- If a cosmetic or minor issue persists after being flagged, note it in feedback but don't block on it again
- If a functional bug, security issue, or missing requirement persists, you MUST block on it again — these are real problems regardless of how many times they've been flagged
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

        // Cap diff to fit within the reviewer model's context window.
        // Rough estimate: 1 token ≈ 4 chars. Reserve 40% of context for system prompt,
        // tools, instructions, and response. The diff gets the remaining 60%.
        const revContextWindow = getModelContext(revModel, revCtx);
        const maxDiffChars = Math.floor(revContextWindow * 3 * 0.5);
        if (codeDiff.length > maxDiffChars) {
          // Write full diff to a temp file so the reviewer can read_file it
          const diffFile = path.join(workingDir, ".workermill-review-diff.tmp");
          try { fs.writeFileSync(diffFile, codeDiff, "utf-8"); } catch { /* best effort */ }
          const stat = codeDiff.match(/## Branch Diff.*?\n([\s\S]*?)\n\n/)?.[1] || "";
          codeDiff = codeDiff.slice(0, maxDiffChars) +
            `\n\n... (diff truncated to fit ${formatContext(revContextWindow)} context window)\n\n` +
            `**Full diff saved to:** \`${diffFile}\` — use \`read_file ${diffFile}\` to review the complete diff.\n\n` +
            `${stat ? `File list:\n${stat}` : ""}`;
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

## Feedback Guidelines

- **Be specific**: Point to exact files and issues when providing feedback
- **Be constructive**: Suggest alternatives, not just problems
- **Be balanced**: Acknowledge what's done well alongside improvements
- **Be pragmatic**: Distinguish must-fix from nice-to-have issues

### APPROVE when:
- Code correctly implements the requirements from the original spec
- No obvious bugs or security issues
- Code follows existing patterns in the codebase
- Minor cosmetic issues are NOT grounds for revision — mention them in feedback but still approve

### REVISION_NEEDED when:
- Code has functional bugs that affect correctness
- Security vulnerabilities that must be fixed
- Missing required functionality from the task spec
- Broken imports, missing dependencies, or code that won't run

### REJECT when:
- Fundamental approach is wrong and cannot be fixed with revisions

**Bias toward approval**: If the code works and implements the requirements, approve it. Every revision cycle costs significant time and tokens — only block when there's a real functional or security issue. A score of ${config.review?.approvalThreshold ?? 8}+ means approved.

## Output Format

You MUST write your detailed feedback FIRST, THEN add the decision markers at the end.

**1. Write your full review** — analyze the code, list specific issues with file paths, explain what's good and what needs fixing. This is the most important part. Workers read this to know what to fix. Be thorough.

**2. Then add these markers at the end:**

REVIEW_DECISION: approved (or revision_needed or rejected)
CODE_QUALITY_SCORE: ${config.review?.approvalThreshold ?? 8}
FEEDBACK: One-line summary of your decision

**Score guide (1-10):** 1-3 = fundamentally broken, 4-5 = major issues, 6 = functional but rough, 7 = solid with minor issues, ${config.review?.approvalThreshold ?? 8}+ = good quality (approve), 10 = exceptional. A score of ${config.review?.approvalThreshold ?? 8}+ means the code is ready to ship. Below ${config.review?.approvalThreshold ?? 8} means there are real issues to address.

### For REVISION_NEEDED Decisions - Specify Affected Stories

There are exactly ${sorted.length} stories (numbered 1 to ${sorted.length}):
${sorted.map((s, i) => `  ${i + 1}. ${s.title} (${s.persona})`).join("\n")}

AFFECTED_STORIES MUST only contain numbers from 1 to ${sorted.length}. Do NOT invent story numbers that don't exist.

\`\`\`
AFFECTED_STORIES: [2, 3]
AFFECTED_REASONS: {"2": "reason for story 2", "3": "reason for story 3"}
\`\`\`

**Guidelines:**
- Only reference story numbers 1-${sorted.length} — these are the ONLY stories that exist
- Only include stories that have ACTUAL implementation issues in their code
- If ALL stories need revision, you may omit AFFECTED_STORIES (all will re-run)
- Be specific in AFFECTED_REASONS so developers know exactly what to fix
- Do NOT list issues as separate "stories" — map issues back to the story that should have handled them`;

        // Use onStepFinish for reviewer — same as WorkerMill ai-sdk-client.ts
        // TODO: Rate limit retry for reviewer streamText — add isRateLimitError check in catch block
        // Accumulate only the reviewer's NEW output (not the echoed prompt/previous feedback)
        let reviewerOutput = "";
        const reviewStartMs = Date.now();
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

        // Score must meet threshold — the model's decision marker alone is not enough.
        const threshold = config.review?.approvalThreshold ?? 8;
        const approved = score >= threshold;
        const revInputTokens = reviewUsage?.inputTokens || 0;
        const revOutputTokens = reviewUsage?.outputTokens || 0;
        // Track tok/s for reviewer model
        const reviewElapsed = (Date.now() - reviewStartMs) / 1000;
        if (revOutputTokens > 0 && reviewElapsed > 0) {
          const reviewTokPerSec = Math.round(revOutputTokens / reviewElapsed);
          output.updateTokPerSec?.(`${revProvider}/${revModel}`, reviewTokPerSec);
          logger.info("Model performance", { provider: revProvider, model: revModel, tokPerSec: reviewTokPerSec });
        }
        logger.info(`Review round ${reviewRound} result`, { decision: decision || "no-marker-approved", score, approved, reviewTextLength: reviewText.length, inputTokens: revInputTokens, outputTokens: revOutputTokens });

        // Display review result with horizontal rules
        output.log("tech_lead", "\u2500".repeat(60));
        output.log("tech_lead", `::code_quality_score::${score}/10`);
        output.log("tech_lead", `::review_decision::${approved ? "approved" : decision === "rejected" ? "rejected" : "needs_revision"}`);
        output.log("tech_lead", "\u2500".repeat(60));
        output.coordinatorLog(approved ? `Review approved (${score}/10)` : `Review needs revision (${score}/10)`);

        // Post review result to ticket — matches worker/epic/coordinator-review.ts
        if (ticketOps) {
          // Extract the full review — everything before the decision markers is the detailed analysis
          const markerIdx = reviewText.search(/REVIEW_DECISION:|CODE_QUALITY_SCORE:/i);
          const detailedReview = markerIdx > 0 ? reviewText.slice(0, markerIdx).trim() : "";
          const feedbackMatch = reviewText.match(/FEEDBACK:\s*([\s\S]*?)(?=AFFECTED_|```|$)/i);
          const feedbackSummary = feedbackMatch ? feedbackMatch[1].trim() : "";
          const feedback = detailedReview || feedbackSummary;
          if (approved) {
            const roundLabel = reviewRound > 1 ? ` after ${reviewRound - 1} revision${reviewRound > 2 ? "s" : ""}` : "";
            ticketOps.postComment(
              `## ✅ Tech Lead Review — Approved${roundLabel} (${score}/10)\n\n${feedback}`
            ).catch(() => {});
          } else {
            ticketOps.postComment(
              `## 🔄 Tech Lead Review — Revision ${reviewRound}/${maxRevisions} (${score}/10)\n\n${feedback}`
            ).catch(() => {});
          }
        }

        // Save feedback for next review round — so tech_lead can check if issues were addressed
        previousReviewFeedback = reviewText;
      
        // Track reviewer cost
        costTracker.addUsage(`Reviewer (round ${reviewRound})`, revProvider, revModel,
          revInputTokens, revOutputTokens);
        output.updateCost?.(costTracker.getTotalCost());

        // If approved or out of revision attempts, done
        if (approved) {
          finalReviewText = reviewText;
          runLifecycleHooks("review_complete", config.hooks, workingDir, {
            WORKERMILL_REVIEW_SCORE: String(score),
            WORKERMILL_REVIEW_DECISION: "approved",
          });
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
        // Filter out invalid story numbers — model may invent numbers beyond the plan
        if (affected) {
          affected.stories = affected.stories.filter(n => n >= 1 && n <= sorted.length);
          for (const key of Object.keys(affected.reasons)) {
            const n = parseInt(key, 10);
            if (n < 1 || n > sorted.length) delete affected.reasons[n];
          }
        }
        const affectedSet = affected && affected.stories.length > 0 ? new Set(affected.stories) : null;

        if (affected && affected.stories.length > 0) {
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
          output.log(story.persona, `Starting revision: ${story.title} (\x1b[38;5;208m${sProvider}/${sModel}\x1b[0m, ${formatContext(getModelContext(sModel, sCtx))} context)`);

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
                  const allowed = await checkToolPermission(toolName, input, trustAll, sessionAllow, output, config.permissions);
                  if (!allowed) return "Tool execution denied by user.";
                  output.toolCall(story.persona, toolName, input);
                  const revHookResult = runPreHooksWithBlocking(toolName, config.hooks, workingDir, { input: JSON.stringify(input).substring(0, 10000) });
                  if (revHookResult.blocked) {
                    return `Tool blocked by pre-hook: ${revHookResult.reason}`;
                  }
                  output.status(`${story.persona}: working...`);
                  const result = await toolDef.execute(input);
                  runHooks("post", toolName, config.hooks, workingDir);
                  output.status("");
                  return result;
                },
              };
            }
          }

          // Apply concurrency control to revision tools — same as story execution
          for (const [name, td] of Object.entries(storyTools)) {
            if (td && typeof td.execute === "function") {
              const original = td.execute;
              (storyTools as any)[name] = { ...td, execute: withConcurrencyControl(name, original as any) };
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
            // TODO: Rate limit retry for revision streamText — add isRateLimitError check in catch block
            const revisionStartMs = Date.now();
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

            // Track tok/s for revision worker model
            const revisionElapsed = (Date.now() - revisionStartMs) / 1000;
            const revisionOutTokens = revUsage?.outputTokens || 0;
            if (revisionOutTokens > 0 && revisionElapsed > 0) {
              const revisionTokPerSec = Math.round(revisionOutTokens / revisionElapsed);
              output.updateTokPerSec?.(`${sProvider}/${sModel}`, revisionTokPerSec);
              logger.info("Model performance", { provider: sProvider, model: sModel, tokPerSec: revisionTokPerSec });
            }

            logger.info(`Revision completed`, { story: i + 1, persona: story.persona, inputTokens: revUsage?.inputTokens || 0, outputTokens: revUsage?.outputTokens || 0 });
            output.log(story.persona, `${story.title} — revision complete!`);

            // Commit revision changes — checkpoint on the feature branch
            if (featureBranch) {
              const hash = commitRevisionChanges(workingDir, i + 1, story.title, story.persona, reviewRound);
              if (hash) output.coordinatorLog(`Committed revision ${reviewRound} for story ${i + 1}: ${hash}`);
            }
          } catch (err) {
            output.statusDone();
            const revRl = isRateLimitError(err);
            if (revRl) {
              const waitSec = Math.ceil(revRl.retryAfterMs / 1000);
              output.log("system", `Revision rate limited — retrying in ${waitSec}s`);
              logger.info("Revision rate limit retry", { story: i + 1, waitSec });
              await rateLimitSleep(revRl.retryAfterMs);
              // Fall through to next review loop iteration which will re-attempt
            } else {
              const errMsg = err instanceof Error ? err.message : String(err);
              logger.error(`Revision failed`, { story: i + 1, persona: story.persona, error: errMsg });
              output.log("system", `Revision failed for story ${i + 1}: ${errMsg}`);
            }
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

      output.log("system", `Branch: ${featureBranch} (${commitCount} commits)`);

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
        output.log("system", `To review the full diff first, say no and run: \`!git diff ${mainBranch}..HEAD\``);
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
                const feedback = feedbackMatch ? feedbackMatch[1].trim() : finalReviewText.split("\n").filter((l: string) => !l.includes("REVIEW_DECISION") && !l.includes("CODE_QUALITY_SCORE") && !l.includes("AFFECTED_")).join("\n").trim();
                if (feedback) {
                  prParts.push("\n## Tech Lead Review\n");
                  prParts.push(feedback);
                }
              }
              prParts.push("\n---\nShipped by [WorkerMill CLI](https://workermill.com)");
              const prBody = prParts.join("\n");
              const prUrl = execSync(
                `gh pr create --title "${prTitle.replace(/"/g, '\\"')}" --body-file - --head "${featureBranch}" --base "${mainBranch}" 2>&1`,
                { cwd: workingDir, encoding: "utf-8", input: prBody, stdio: ["pipe", "pipe", "pipe"] },
              ).trim();
              output.log("system", `Pull request created: ${prUrl}`);

              // Post the tech lead review as a proper GitHub PR review
              // Matches worker/epic/coordinator-review.ts ensureGitHubReviewPosted()
              if (finalReviewText) {
                try {
                  const reviewScore = extractScore(finalReviewText);
                  const feedbackMatch = finalReviewText.match(/FEEDBACK:\s*([\s\S]*?)(?=AFFECTED_|REVIEW_DECISION|CODE_QUALITY|```|$)/i);
                  const feedback = feedbackMatch ? feedbackMatch[1].trim() : "";
                  const emoji = reviewScore >= (config.review?.approvalThreshold ?? 8) ? "✅" : "🔄";
                  const reviewBody = `## ${emoji} Tech Lead Review\n\n**Code Quality Score:** ${reviewScore}/10\n\n${feedback}`;
                  const reviewFlag = reviewScore >= (config.review?.approvalThreshold ?? 8) ? "--approve" : "--request-changes";
                  execSync(
                    `gh pr review --body-file - ${reviewFlag} 2>&1`,
                    { cwd: workingDir, encoding: "utf-8", input: reviewBody, stdio: ["pipe", "pipe", "pipe"], timeout: 15_000 },
                  );
                } catch {
                  // Non-critical — review comment is best-effort
                }
              }
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

  // On full success: clear retry state. Stay on the feature branch so the
  // developer can review, test, and push when ready.
  if (featureBranch && completedStoryIds.length === sorted.length) {
    clearShipRun(featureBranch);
  }

  runLifecycleHooks("ship_complete", config.hooks, workingDir, {
    WORKERMILL_COST: costTracker.getTotalCost().toFixed(4),
  });

  // Post final completion to ticket — matches worker/epic/coordinator-review.ts
  if (ticketOps) {
    try {
      const { GitHubCommentFormat } = await import("./ticket-ops.js");
      const completedCount = sorted.filter((s) => completedStoryIds.includes(s.id)).length;
      const storyList = sorted.map((s, i) => {
        const done = completedStoryIds.includes(s.id);
        return `${done ? "✅" : "❌"} **Story ${i + 1}** (${s.persona}): ${s.title}`;
      }).join("\n");
      const summary = `${completedCount}/${sorted.length} stories completed.\n\n${storyList}`;
      // prUrl is captured earlier if PR was created
      await ticketOps.postComment(GitHubCommentFormat.completed(summary));
    } catch {
      // Soft failure — don't crash on post-back errors
    }
  }

  // Clean up temp review diff file
  try { fs.unlinkSync(path.join(workingDir, ".workermill-review-diff.tmp")); } catch { /* may not exist */ }

  // Stop MCP servers and language server
  stopAllMCPServers();
  const { shutdown: shutdownLSP } = await import("../../packages/engine/src/tools/lsp.js");
  shutdownLSP();

  return { stories: sorted, completedStoryIds, featureBranch, userTask };
}

// ---------------------------------------------------------------------------
// Standalone Review — extracted review step for /review command
// ---------------------------------------------------------------------------

export interface StandaloneReviewResult {
  score: number;
  decision: "approved" | "revision_needed" | "rejected";
  feedback: string;
  reviewText: string;
}

/**
 * Run a standalone Tech Lead review against the current branch or uncommitted changes.
 * Uses the same model, prompt, and scoring as the orchestrator review loop.
 */
export async function runStandaloneReview(
  config: CliConfig,
  output: OrchestrationOutput,
  target?: string,
  abortSignal?: AbortSignal,
): Promise<StandaloneReviewResult | null> {
  const reviewer = loadPersona("tech_lead");
  if (!reviewer) {
    output.error("Tech Lead persona not found.");
    return null;
  }

  const workingDir = process.cwd();
  const { provider: revProvider, model: revModel, host: revHost, contextLength: revCtx } = getProviderForPersona(config, "tech_lead");

  // Set API key
  const revApiKey = config.providers[revProvider]?.apiKey;
  if (revApiKey) {
    const envMap: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_GENERATIVE_AI_API_KEY" };
    const envVar = envMap[revProvider];
    const key = revApiKey.startsWith("{env:") ? process.env[revApiKey.slice(5, -1)] : revApiKey;
    if (envVar && key && !process.env[envVar]) process.env[envVar] = key;
  }

  output.coordinatorLog(`Starting Tech Lead review (${revProvider}/${revModel})...`);
  output.log("tech_lead", `Reviewing with \x1b[35m${revProvider}/${revModel}\x1b[0m (${formatContext(getModelContext(revModel, revCtx))} context)`);
  output.status("Reviewer -- Checking code quality");

  const sandboxed = config.sandbox ?? true;
  const reviewModel = createModel(revProvider as AIProvider, revModel, revHost, revCtx);
  const reviewTools = createToolDefinitions(workingDir, reviewModel, sandboxed);

  // Build reviewer tools — same pattern as orchestrator
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

  // Get the diff based on target
  let codeDiff = "";
  const normalizedTarget = (target || "branch").toLowerCase().trim();
  const prMatch = normalizedTarget.match(/^(?:pr)?#?(\d+)$/i);

  if (prMatch) {
    // PR review — fetch diff via gh CLI
    const prNumber = prMatch[1];
    try {
      const prDiff = execSync(`gh pr diff ${prNumber}`, {
        cwd: workingDir, encoding: "utf-8", stdio: "pipe", timeout: 30_000,
      }).trim();
      codeDiff += `## PR #${prNumber}\n\n${prDiff}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      output.error(`Failed to fetch PR #${prNumber}: ${msg}`);
      output.statusDone();
      return null;
    }
  } else if (normalizedTarget === "diff") {
    // Uncommitted changes only
    try {
      const stat = execSync("git diff --stat HEAD 2>/dev/null || git diff --stat 2>/dev/null", {
        cwd: workingDir, encoding: "utf-8", stdio: "pipe",
      }).trim();
      const diff = execSync("git diff HEAD 2>/dev/null || git diff 2>/dev/null", {
        cwd: workingDir, encoding: "utf-8", stdio: "pipe",
      }).trim();
      if (stat) codeDiff += `## Uncommitted Changes\n${stat}\n\n`;
      if (diff) codeDiff += diff;
    } catch { /* not a git repo */ }
  } else {
    // "branch" or anything else — diff current branch vs main
    let mainBranch = "main";
    try {
      mainBranch = execSync("git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || echo refs/heads/main", {
        cwd: workingDir, encoding: "utf-8", stdio: "pipe",
      }).trim().replace(/^refs\/heads\/|^refs\/remotes\/origin\//g, "");
    } catch { /* default to main */ }

    const { stat, diff } = getDiffForReview(workingDir, mainBranch);
    if (stat) codeDiff += `## Branch Diff (${mainBranch}..HEAD)\n${stat}\n\n`;
    if (diff) codeDiff += diff;
  }

  if (!codeDiff.trim()) {
    output.error("No changes to review.");
    output.statusDone();
    return null;
  }

  // Cap diff to fit within context window.
  // Conservative: ~3 chars/token for code, 50% budget for diff (rest is system prompt, tools, instructions).
  const revContextWindow = getModelContext(revModel, revCtx);
  const maxDiffChars = Math.floor(revContextWindow * 3 * 0.5);
  if (codeDiff.length > maxDiffChars) {
    const diffFile = path.join(workingDir, ".workermill-review-diff.tmp");
    try { fs.writeFileSync(diffFile, codeDiff, "utf-8"); } catch { /* best effort */ }
    const stat = codeDiff.match(/## (?:Branch Diff|Uncommitted|PR).*?\n([\s\S]*?)\n\n/)?.[1] || "";
    codeDiff = codeDiff.slice(0, maxDiffChars) +
      `\n\n... (diff truncated to fit ${formatContext(revContextWindow)} context window)\n\n` +
      `**Full diff saved to:** \`${diffFile}\` — use \`read_file ${diffFile}\` to review the complete diff.\n\n` +
      `${stat ? `File list:\n${stat}` : ""}`;
  }

  const reviewerProjectInstructions = formatProjectInstructions(workingDir);
  const reviewPrompt = `${reviewerProjectInstructions ? `${reviewerProjectInstructions}\n\n` : ""}## Code Changes

The diff below shows what was changed. Use your read_file tool to inspect specific files in detail.

${codeDiff || "(no code changes detected)"}

## Review Instructions

Review the code changes above for quality, correctness, and security.

### APPROVE when:
- Code correctly implements the requirements
- No obvious bugs or security issues
- Code follows existing patterns in the codebase
- Appropriate error handling is in place
- Minor cosmetic issues are NOT grounds for revision

### REVISION_NEEDED when:
- Code has functional bugs that affect correctness
- Security vulnerabilities that must be fixed
- Missing required functionality
- Broken imports, missing dependencies, or code that won't run

### REJECT when:
- Fundamental approach is wrong and cannot be fixed with revisions
- Security vulnerability that requires different architecture

**Be fair**: Approve code that works and has no functional bugs or security issues. Request revision for real problems only.

## Output Format

\`\`\`
REVIEW_DECISION: approved
\`\`\`
OR
\`\`\`
REVIEW_DECISION: revision_needed
\`\`\`

Then add:
\`\`\`
CODE_QUALITY_SCORE: ${config.review?.approvalThreshold ?? 8}
FEEDBACK: Your detailed feedback explaining what's good and what needs fixing
\`\`\`

**Score guide (1-10):** 1-3 = fundamentally broken, 4-5 = major issues, 6 = functional but rough, 7 = solid with minor issues, ${config.review?.approvalThreshold ?? 8}+ = good quality (approve), 10 = exceptional. A score of ${config.review?.approvalThreshold ?? 8}+ means the code is ready to ship. Below ${config.review?.approvalThreshold ?? 8} means there are real issues to address.`;

  // Stream the review — use onStepFinish to capture text between tool calls
  // This matches the orchestrator's review pattern exactly.
  let reviewerOutput = "";
  let reviewText = "";
  const reviewStartMs = Date.now();
  try {
    const reviewStream = streamText({
      model: reviewModel,
      abortSignal,
      system: reviewer.systemPrompt,
      prompt: reviewPrompt,
      tools: reviewerTools as ToolSet,
      stopWhen: stepCountIs(100),
      timeout: { chunkMs: 120_000 },
      ...buildOllamaOptions(revProvider as AIProvider, revCtx),
      onStepFinish({ text }) {
        if (text) {
          reviewerOutput += text + "\n";
          const lines = text.split("\n").filter((l: string) => l.trim());
          for (const line of lines) {
            if (line.includes("::review_score::") || line.includes("::review_verdict::") || line.includes("::code_quality_score::")) continue;
            output.log("tech_lead", line);
          }
        }
        output.status("tech_lead: reviewing...");
      },
    });
    for await (const _chunk of reviewStream.textStream) { /* consumed */ }
    reviewText = reviewerOutput;
    const reviewUsage = await reviewStream.totalUsage;
    // Track cost
    const revInputTokens = reviewUsage?.inputTokens || 0;
    const revOutputTokens = reviewUsage?.outputTokens || 0;
    const costTracker = new CostTracker();
    costTracker.addUsage("Tech Lead Review", revProvider, revModel, revInputTokens, revOutputTokens);
    output.updateCost?.(costTracker.getTotalCost());
    // Track tok/s for reviewer model
    const reviewElapsed = (Date.now() - reviewStartMs) / 1000;
    if (revOutputTokens > 0 && reviewElapsed > 0) {
      const reviewTokPerSec = Math.round(revOutputTokens / reviewElapsed);
      output.updateTokPerSec?.(`${revProvider}/${revModel}`, reviewTokPerSec);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    output.error(`Review failed: ${msg}`);
    output.statusDone();
    return null;
  }

  output.statusDone();

  // Parse results — same logic as orchestrator
  const score = extractScore(reviewText);
  const threshold = config.review?.approvalThreshold ?? 8;
  const approved = score >= threshold;
  const decisionMatch = reviewText.match(/REVIEW_DECISION:\s*(approved|revision_needed|rejected)/i);
  const decision = approved ? "approved" : (decisionMatch?.[1]?.toLowerCase() as "revision_needed" | "rejected") || "revision_needed";

  // Display structured result
  output.log("tech_lead", "\u2500".repeat(60));
  output.log("tech_lead", `::code_quality_score::${score}/10`);
  output.log("tech_lead", `::review_decision::${decision}`);
  output.log("tech_lead", "\u2500".repeat(60));
  output.coordinatorLog(approved ? `Review approved (${score}/10)` : `Review needs revision (${score}/10)`);

  const feedbackMatch = reviewText.match(/FEEDBACK:\s*([\s\S]*?)(?=AFFECTED_|REVIEW_DECISION|CODE_QUALITY|```|$)/i);
  const feedback = feedbackMatch ? feedbackMatch[1].trim() : "";

  // Clean up temp file
  try { fs.unlinkSync(path.join(workingDir, ".workermill-review-diff.tmp")); } catch { /* may not exist */ }

  return { score, decision, feedback, reviewText };
}
