import { streamText, generateObject, generateText, stepCountIs, type ToolSet } from "ai";
import { z } from "zod";
import { createModel, buildOllamaOptions, ensureOllamaContext } from "../../packages/engine/src/model-factory.js";
import { createToolDefinitions } from "../../packages/engine/src/tools/index.js";
import type { AIProvider } from "../../packages/engine/src/types.js";
import fs from "fs";
import path from "path";
import { loadPersona } from "./personas.js";
import * as logger from "./logger.js";
import { CostTracker } from "./cost-tracker.js";
import type { CliConfig } from "./config.js";
import { getProviderForPersona } from "./config.js";

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
  confirm: (prompt: string) => Promise<boolean>;
  /** Log a tool call */
  toolCall: (persona: string, toolName: string, toolInput: Record<string, unknown>) => void;
  /** Update running cost in the UI (optional — noop if not provided) */
  updateCost?: (cost: number) => void;
}

/**
 * Learning instructions — from worker/epic/experts.ts lines 50-69.
 * Teaches models what constitutes a valid learning.
 */
const LEARNING_INSTRUCTIONS = `

## Reporting Learnings

When you discover something specific and actionable about this codebase, emit a learning marker:

\`\`\`
::learning::The test suite requires DATABASE_URL env var or tests silently pass without running
::learning::New API routes must be registered in backend/src/routes/index.ts or they won't load
\`\`\`

**Emit a learning when you discover:**
- A non-obvious requirement (specific env vars, config files, build steps)
- A codebase convention not documented elsewhere (naming patterns, file organization)
- A gotcha you had to work around (unexpected failures, ordering dependencies)
- Files that must be modified together (route + model + migration + test)

**Do NOT emit generic advice** like "write tests" or "handle errors properly."
Include file paths, commands, and exact details. Only emit when you genuinely discover something non-obvious.
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

/** Read-only tool names that are auto-approved without user confirmation */
const READ_TOOLS = new Set(["read_file", "glob", "grep", "ls", "sub_agent"]);

/** Dangerous command patterns — kept in sync with permissions.ts */
const DANGEROUS_PATTERNS = [
  { pattern: /rm\s+(-[a-z]*f|-[a-z]*r|--force|--recursive)/i, label: "recursive/forced delete" },
  { pattern: /git\s+reset\s+--hard/i, label: "hard reset" },
  { pattern: /git\s+push\s+.*--force/i, label: "force push" },
  { pattern: /git\s+clean\s+-[a-z]*f/i, label: "git clean" },
  { pattern: /drop\s+table/i, label: "drop table" },
  { pattern: /truncate\s+/i, label: "truncate" },
  { pattern: /DELETE\s+FROM\s+\w+\s*;/i, label: "DELETE without WHERE" },
  { pattern: /chmod\s+777/i, label: "chmod 777" },
  { pattern: />(\/dev\/sda|\/dev\/disk)/i, label: "write to disk device" },
];

function isDangerous(command: string): string | null {
  for (const { pattern, label } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) return label;
  }
  return null;
}

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
      if (trustAll) return true;
      output.error(`DANGEROUS: ${danger}`);
      output.error(`Command: ${cmd}`);
      const confirmed = await output.confirm("This is a dangerous operation. Are you sure?");
      return confirmed;
    }
  }

  if (trustAll) return true;
  if (READ_TOOLS.has(toolName)) return true;
  if (sessionAllow.has(toolName)) return true;

  // Prompt user via output.confirm
  const display = formatToolCallDisplay(toolName, toolInput);
  output.log("system", `Tool: ${toolName} -- ${display}`);
  const confirmed = await output.confirm(`Allow ${toolName}?`);
  if (confirmed) {
    // Auto-allow this tool for the rest of the session (equivalent to "always" in the old y/n/a/t prompt)
    sessionAllow.add(toolName);
  }
  return confirmed;
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
    } catch { /* double fallback failed */ }

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

  const plannerPrompt = `You are an expert implementation planner. Analyze this task and create a high-quality implementation plan.

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
Return ONLY a JSON code block with this structure:
\`\`\`json
{
  "stories": [
    {
      "id": "short-kebab-case-id",
      "title": "Brief title",
      "persona": "persona_name",
      "description": "Detailed description: what to create/modify, which files, what approach, what to watch out for",
      "dependsOn": ["id-of-dependency"]
    }
  ]
}
\`\`\`

Available personas: backend_developer, frontend_developer, devops_engineer, qa_engineer, security_engineer, data_ml_engineer, mobile_developer, tech_writer, tech_lead`;

  logger.info("Planner started", { provider: pProvider, model: pModel });
  output.log("planner", `Starting planning agent using ${pModel}`);
  output.status("Planner reading repository...");

  // Use onStepFinish — same pattern as worker/ai-clients/ai-sdk-client.ts
  let planText = "";
  const planStream = streamText({
    model: plannerModel,
    abortSignal,
    system: planner?.systemPrompt || "You are an implementation planner.",
    prompt: plannerPrompt,
    tools: readOnlyTools as ToolSet,
    stopWhen: stepCountIs(100),
    timeout: { totalMs: 3 * 60 * 1000, chunkMs: 120_000 },
    ...buildOllamaOptions(pProvider as AIProvider, pCtx),
    onStepFinish({ text }) {
      if (text) {
        const lines = text.split("\n").filter(l => l.trim());
        for (const line of lines) {
          output.log("planner", line);
        }
      }
    },
  });
  // Drive the stream
  for await (const _chunk of planStream.textStream) { /* consumed */ }

  // Also check stream.text in case the accumulated text missed something
  const finalText = await planStream.text;
  if (finalText && finalText.length > planText.length) {
    planText = finalText;
  }

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
function tryParseStories(text: string): Story[] | null {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      // Validate at least one item has persona field
      if (parsed.length > 0 && parsed[0].persona) return parsed;
    }
    if (parsed && Array.isArray(parsed.stories)) {
      if (parsed.stories.length > 0) return parsed.stories;
    }
  } catch { /* not valid JSON */ }
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

/** Extract a numeric score from critic output — tries markers, then natural language patterns */
function extractScore(text: string): number {
  // 1. Try ::review_score:: marker — use LAST match (final verdict, not echoed feedback)
  const markerMatches = [...text.matchAll(/::review_score::(\d+)/g)];
  if (markerMatches.length > 0) {
    return parseInt(markerMatches[markerMatches.length - 1][1], 10);
  }

  // 2. Try "Score: N/100" or "score: N" patterns — use LAST match
  const scorePatterns = [
    /\bscore[:\s]+(\d+)\s*\/\s*100/gi,
    /\bscore[:\s]+(\d+)/gi,
    /\brating[:\s]+(\d+)/gi,
  ];
  for (const pattern of scorePatterns) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length > 0) {
      const n = parseInt(matches[matches.length - 1][1], 10);
      if (n >= 0 && n <= 100) return n;
    }
  }

  // 3. If text contains "approve" but no score, assume 85
  if (/\bapprove/i.test(text)) return 85;

  // 4. If text contains "revise" or "revision" but no score, assume 60
  if (/\brevis/i.test(text)) return 60;

  // 5. No score found — default to 75 (proceed with caution rather than block)
  return 75;
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
    } catch { /* continue without reasons */ }
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
  const context: SharedContext = {
    filesCreated: [],
    filesModified: [],
    decisions: [],
    learnings: [],
  };
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

  // Sort by dependencies
  const sorted = topologicalSort(plannerStories);

  // Prompt user to proceed (unless --trust mode)
  if (!trustAll) {
    let proceed = false;
    try {
      proceed = await output.confirm("Execute this plan?");
    } catch {
      // confirm failed — default to no
    }
    if (!proceed) {
      output.log("system", "Plan cancelled.");
      return;
    }
    }

  for (let i = 0; i < sorted.length; i++) {
    const story = sorted[i];
    const persona = loadPersona(story.persona);
    if (!persona) {
      output.error(`Unknown persona: ${story.persona}`);
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
    let lastToolCall = "";  // Dedup consecutive identical tool calls
    for (const toolName of persona.tools) {
      const toolDef = allTools[toolName as keyof typeof allTools] as AnyToolDef;
      if (toolDef) {
        personaTools[toolName] = {
          ...toolDef,
          execute: async (input: Record<string, unknown>) => {
            const allowed = await checkToolPermission(toolName, input, trustAll, sessionAllow, output);
            if (!allowed) return "Tool execution denied by user.";

            const sig = `${toolName}:${JSON.stringify(input)}`;
            const isDuplicate = sig === lastToolCall;
            lastToolCall = sig;

            if (!isDuplicate) {
              output.statusDone();
              output.toolCall(story.persona, toolName, input);
            }
            const result = await toolDef.execute(input);
            output.status("");
            return result;
          },
        };
      }
    }

    let revisionFeedback = "";
    for (let revision = 0; revision <= 2; revision++) {

    // Build system prompt with context from prior stories
    const contextParts: string[] = [];
    if (context.filesCreated.length > 0) {
      contextParts.push(`Files created: ${context.filesCreated.join(", ")}`);
    }
    if (context.filesModified.length > 0) {
      contextParts.push(`Files modified: ${context.filesModified.join(", ")}`);
    }
    if (context.decisions.length > 0) {
      contextParts.push(`Decisions: ${context.decisions.join("; ")}`);
    }
    if (context.learnings.length > 0) {
      contextParts.push(`Learnings: ${context.learnings.join("; ")}`);
    }

    const contextBlock = contextParts.length > 0
      ? `\n\n## Context from prior experts\n${contextParts.join("\n")}`
      : "";

    const systemPrompt = `${persona.systemPrompt}${contextBlock}

Working directory: ${workingDir}

Your task: ${story.description}

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
${LEARNING_INSTRUCTIONS}${DOCKER_INSTRUCTIONS}${VERSION_TRUST}${IGNORE_WORKERMILL}${revisionFeedback ? `\n\n## Revision requested\n${revisionFeedback}` : ""}`;

    try {
      // Use onStepFinish to capture text between tool calls — same pattern as
      // worker/ai-clients/ai-sdk-client.ts (the battle-tested WorkerMill approach)
      let allText = "";
      const stream = streamText({
        model,
        abortSignal,
        system: systemPrompt,
        prompt: story.description,
        tools: personaTools as ToolSet,
        stopWhen: stepCountIs(100),
        timeout: { totalMs: 10 * 60 * 1000, chunkMs: 120_000 },
        ...buildReasoningOptions(provider, modelName),
        ...buildOllamaOptions(provider as AIProvider, contextLength),
        onStepFinish({ text }) {
          if (text) {
            const lines = text.split("\n").filter(l => l.trim());
            for (const line of lines) {
              if (line.includes("::decision::") || line.includes("::learning::") ||
                  line.includes("::file_created::") || line.includes("::file_modified::")) continue;
              output.log(story.persona, line);
            }
          }
          // Show thinking status between steps
          output.status(`${story.persona}: thinking...`);
        },
      });

      // Drive the stream (required for streamText) — onStepFinish handles display
      for await (const _chunk of stream.textStream) { /* consumed */ }

      const text = await stream.text;
      allText = text;
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

      const learningMatches = text.match(/::learning::(.*?)(?=::\w+::|$)/gs);
      if (learningMatches) {
        for (const m of learningMatches) {
          context.learnings.push(m.replace("::learning::", "").trim());
        }
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

      output.log(story.persona, `${story.title} — completed! (${i + 1}/${sorted.length})`);
      logger.info(`Story ${i + 1} completed`, { persona: story.persona, inputTokens: inTokens, outputTokens: outTokens });
          break; // Story succeeded, exit revision loop
    } catch (err) {
      output.statusDone();
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Story ${i + 1} error`, { persona: story.persona, error: errMsg, revision });

      // Retry on transient errors (network, 5xx) — from coordinator-utils.ts
      if (isTransientError(err) && revision < 2) {
        output.log(story.persona, `Transient error: ${errMsg} — retrying...`);
        logger.info(`Story ${i + 1} retrying (transient)`, { revision });
        continue; // retry this revision
      }

      output.error(`Story ${i + 1} failed: ${errMsg}`);
      break;
    }

    } // end revision loop
  }

  // Review config
  const approvalThreshold = config.review?.approvalThreshold ?? 80;

  // Run inline review with revision loop
  const reviewer = loadPersona("tech_lead");
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
    logger.info("Starting review loop", { approvalThreshold, provider: revProvider, model: revModel });
    for (let reviewRound = 0; ; reviewRound++) {
      const isRevision = reviewRound > 0;
      logger.info(`Review round ${reviewRound}`, { isRevision });
      output.coordinatorLog(isRevision ? `Starting Tech Lead review (revision ${reviewRound}, ${revProvider}/${revModel})...` : `Starting Tech Lead review (${revProvider}/${revModel})...`);
      output.log("tech_lead", `Starting agent execution (model: ${revModel})`);

      output.status(isRevision ? "Reviewer -- Re-checking after revisions" : "Reviewer -- Checking code quality");

      try {
        // Build review prompt with full context — matches WorkerMill's inline-reviewer.ts buildReviewPrompt()
        const previousFeedbackSection = isRevision && previousReviewFeedback
          ? `## Previous Review Feedback (Round ${reviewRound + 1})
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
          const files = [...context.filesCreated, ...context.filesModified]
            .slice(0, 3).join(", ") || "(none)";
          return `| ${idx + 1} | ${s.persona} | ${s.title} | ${files} |`;
        }).join("\n");

        const reviewPrompt = `${previousFeedbackSection}## Original Task

${userTask}

## Story Summary

| # | Persona | Title | Files |
|---|---------|-------|-------|
${storySummaryRows}

## Changes Made

Files created: ${context.filesCreated.join(", ") || "none"}
Files modified: ${context.filesModified.join(", ") || "none"}
${context.decisions.length > 0 ? `\nDecisions made:\n${context.decisions.map(d => `- ${d}`).join("\n")}` : ""}

## Review Instructions

Use read_file, glob, grep, and git tools to examine the actual code. Check:
- Does the code correctly implement the original task requirements?
- Are there bugs, logic errors, or security issues?
- Does the code follow existing project conventions?
- Is error handling appropriate?
- Are there missing pieces from the task requirements?

Use \`git diff\` or read individual files to see the actual changes.

Provide a review with a quality score (0-100) using ::review_score:: marker and a verdict using ::review_verdict::approved or ::review_verdict::needs_revision.

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
              output.statusDone();
              const lines = text.split("\n").filter(l => l.trim());
              for (const line of lines) {
                if (line.includes("::review_score::") || line.includes("::review_verdict::")) continue;
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

        // Extract review markers (with fallback parsing)
        const score = extractScore(reviewText);
        const approved = score >= approvalThreshold;
        logger.info(`Review round ${reviewRound} result`, { score, approved, threshold: approvalThreshold, reviewTextLength: reviewText.length });

        // Display review result — WorkerMill format
        output.log("tech_lead", `::code_quality_score::${score}`);
        output.log("tech_lead", `::review_decision::${approved ? "approved" : "needs_revision"}`);
        output.coordinatorLog(approved ? `Review approved (score: ${score}/100)` : `Review needs revision (score: ${score}/100)`);
        // Save feedback for next review round — so tech_lead can check if issues were addressed
        previousReviewFeedback = reviewText;
      
        // Track reviewer cost
        costTracker.addUsage(`Reviewer (round ${reviewRound + 1})`, revProvider, revModel,
          reviewUsage?.inputTokens || 0, reviewUsage?.outputTokens || 0);
        output.updateCost?.(costTracker.getTotalCost());

        // If approved, done
        if (approved) break;

        // Ask user whether to revise
        let shouldRevise = false;
        try {
          shouldRevise = await output.confirm("Revise and re-review?");
        } catch {
          shouldRevise = false; // cancelled
        }

        if (!shouldRevise) break;

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

          output.coordinatorLog(`Revision pass for story ${i + 1}/${sorted.length}`);
          output.log(story.persona, `Starting revision: ${story.title} (model: ${sModel})`);

          output.status("");

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
                  output.statusDone();
                  output.log(story.persona, formatToolCallDisplay(toolName, input));
                  const result = await toolDef.execute(input);
                  output.status("");
                  return result;
                },
              };
            }
          }

          const revisionSystemPrompt = `${storyPersona.systemPrompt}

Working directory: ${workingDir}

## Communication Style

Write in a professional, direct tone. Do NOT open messages with filler words or pleasantries like "Perfect!", "Great!", "Awesome!", "Sure!", "Absolutely!", or similar. Start with the substance — what you did, what you found, or what you need. Be concise and informative. Do NOT repeat what you said in previous steps — each response should add new information only.

## Critical rules
- NEVER start long-running processes (dev servers, watch modes, npm start, npm run dev, nodemon, tsc --watch, etc.)
- NEVER run interactive commands that wait for user input
- Only run commands that complete and exit

## Reviewer feedback — fix these issues:
${reviewText}

Your task: Address the reviewer's feedback for "${story.title}". Fix the specific issues mentioned. Do not rewrite code that wasn't flagged.`;

          try {
            const revStream = streamText({
              model: storyModel,
              abortSignal,
              system: revisionSystemPrompt,
              prompt: `Fix the reviewer's issues for: ${story.title}\n\n${story.description}`,
              tools: storyTools as ToolSet,
              stopWhen: stepCountIs(100),
              timeout: { totalMs: 5 * 60 * 1000, chunkMs: 120_000 },
              ...buildReasoningOptions(sProvider, sModel),
              ...buildOllamaOptions(sProvider as AIProvider, sCtx),
              onStepFinish({ text }) {
                if (text) {
                  output.statusDone();
                  const lines = text.split("\n").filter(l => l.trim());
                  for (const line of lines) {
                    if (line.includes("::")) continue;
                    output.log(story.persona, line);
                  }
                }
              },
            });

            for await (const _chunk of revStream.textStream) { /* drive */ }
            const revUsage = await revStream.totalUsage;
            output.statusDone();

            costTracker.addUsage(`${storyPersona.name} (revision)`, sProvider, sModel,
              revUsage?.inputTokens || 0, revUsage?.outputTokens || 0);
            output.updateCost?.(costTracker.getTotalCost());

            output.log(story.persona, `${story.title} — revision complete!`);
          } catch (err) {
            output.statusDone();
            output.log("system", `Revision failed for story ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
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

  // Git commit step
  try {
    const { execSync } = await import("child_process");

    // Auto-init git if not a repo
    try {
      execSync("git rev-parse --git-dir", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" });
    } catch {
      output.coordinatorLog("Initializing git repository...");
      execSync("git init", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" });
      // Create default .gitignore if none exists
      const fs = await import("fs");
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
        const commitConfirmed = await output.confirm("Commit these changes?");
        if (commitConfirmed) {
          // Stage specific files from context (NOT git add -A)
          const filesToStage = [...context.filesCreated, ...context.filesModified].filter(Boolean);
          if (filesToStage.length > 0) {
            for (const f of filesToStage) {
              try {
                execSync(`git add "${f}"`, { cwd: workingDir, stdio: "pipe" });
              } catch { /* file may not exist */ }
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
    // Silently skip — don't dump git help text
  }

  // Final cost update — status bar shows the running total
  output.updateCost?.(costTracker.getTotalCost());
}
