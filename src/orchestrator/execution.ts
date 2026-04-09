import { streamText, stepCountIs, type ToolSet } from "ai";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { isDangerous, isDangerousFile, READ_TOOLS, checkPermissionRules } from "../safety.js";
import { checkpoint } from "../checkpoints.js";
import * as logger from "../logger.js";
import { estimateContextTokens } from "../compaction.js";
import { createModel, buildOllamaOptions } from "../engine/model-factory.js";
import type { AIProvider } from "../engine/types.js";
import { createToolDefinitions } from "../engine/tools/index.js";
import { loadPersona } from "../personas.js";
import { formatProjectInstructions } from "../instructions.js";
import { getProviderForPersona } from "../config.js";
import { getApiKeyEnvVar } from "../provider-capabilities.js";
import type { CliConfig } from "../config.js";
import { runHooks, runPreHooksWithBlocking } from "../hooks.js";
import { isGitRepo, commitStoryChanges } from "../git-ops.js";
import { withConcurrencyControl } from "../tool-concurrency.js";
import { CostTracker } from "../cost-tracker.js";
import { saveShipRun } from "../ship-state.js";
import { getMCPToolDefinitions } from "../mcp-client.js";
import * as lspTool from "../engine/tools/lsp.js";
import { addMemory, extractMemoryMarkers } from "../memory.js";

import type { Story, OrchestrationOutput, FailureCode, StoryContractIssue, SharedContext } from "./types.js";
import {
  truncateForPrompt,
  estimateToolSchemaTokens,
  extractToolFilePath,
  isRateLimitError,
  isBalanceOrQuotaError,
  MAX_RATE_LIMIT_RETRIES,
  getModelContext,
  formatContext,
  normalizeErrorSignature,
  rateLimitSleep,
  parsePromptLengthError,
  extractDeclaredFileMarkers,
  classifyError,
  buildReasoningOptions,
  emitReasoningDelta,
} from "./utils.js";
import { isExcludedTestPath, deriveAutoRequiredTests } from "./planning.js";

// Re-export toPosixPath and uniqueStrings from planning for internal use
import { toPosixPath, uniqueStrings } from "./planning.js";

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * External tools — teaches agents they can use bash for GitHub, web lookups, etc.
 */
export const EXTERNAL_TOOLS = `

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
export const DOCKER_INSTRUCTIONS = `

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

/** Check if a story likely involves databases/services that need Docker. */
export const SERVICE_KEYWORDS = /\b(postgres|mysql|mongo|redis|database|db|docker|compose|migration|schema|seed|service.?container)\b/i;

const LOW_SIGNAL_MEMORY_PATTERNS = [
  /\bbest practices?\b/i,
  /\bproduction-?ready\b/i,
  /\bimplementation is complete\b/i,
  /\btests? pass(?:ed)?\b/i,
  /\bworks correctly\b/i,
  /\bfollows? project patterns?\b/i,
  /\blooks good\b/i,
];

/* -------------------------------------------------------------------------- */
/*  needsDockerInstructions                                                   */
/* -------------------------------------------------------------------------- */

export function needsDockerInstructions(story: Story, userTask: string): boolean {
  const text = `${story.description} ${story.implementationNotes ?? ""} ${userTask} ${(story.targetFiles ?? []).join(" ")}`;
  return SERVICE_KEYWORDS.test(text);
}

function isHighConfidenceMemory(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  if (trimmed.length < 12) return false;
  if (LOW_SIGNAL_MEMORY_PATTERNS.some((pattern) => pattern.test(trimmed))) return false;
  return true;
}

/* -------------------------------------------------------------------------- */
/*  buildWorkerPromptSections                                                 */
/* -------------------------------------------------------------------------- */

export function buildWorkerPromptSections(args: {
  personaSystemPrompt: string;
  projectInstructions: string;
  userTask: string;
  story: Story;
  contextBlock: string;
  revisionFeedback: string;
  workingDir: string;
}): { systemPrompt: string; prompt: string } {
  const {
    personaSystemPrompt,
    projectInstructions,
    userTask,
    story,
    contextBlock,
    revisionFeedback,
    workingDir,
  } = args;

  const implementationGuidance = story.implementationNotes
    ? `\n## Implementation Guidance from Architect\n\n${story.implementationNotes}\n\n**This guidance is based on actual analysis of the codebase. Follow it closely.**`
    : "";

  const systemPrompt = `${personaSystemPrompt}${projectInstructions}${contextBlock}

## Ticket Requirements — THIS IS YOUR SPEC

${userTask}

## Your File Scope — STAY IN YOUR LANE

${story.description}
${story.targetFiles?.length ? `\n**Target files:** ${story.targetFiles.join(", ")}` : ""}
${story.referenceFiles?.length ? `\n**Reference files (read these first for patterns):** ${story.referenceFiles.join(", ")}` : ""}
${story.primaryPattern ? `\n**Primary pattern file:** ${story.primaryPattern}` : ""}
${story.integrationPoints?.length ? `\n**Integration points:** ${story.integrationPoints.join(", ")}` : ""}
${story.nonGoals?.length ? `\n**Non-goals:** ${story.nonGoals.join(", ")}` : ""}
${story.assumptions?.length ? `\n**Assumptions (verify before coding):** ${story.assumptions.join(", ")}` : ""}
${story.validationSignal ? `\n**Validation signal:** ${story.validationSignal}` : ""}${implementationGuidance}

**The ticket requirements above are your ONLY spec. This scope identifies which files and area of the codebase you are responsible for. Do NOT invent requirements beyond what the ticket states.**
Do NOT modify files outside this scope unless absolutely necessary for shared types/imports. If you must touch a file owned by another story, note it with a ::file_modified:: marker so subsequent experts are aware.

## Verification Before Completion

Before you finish:
1. Verify your implementation addresses every point from your story description above
2. Prefer the repository's own verification commands first: existing package scripts, documented CI commands, or commands already used in the repo
3. Only run stack-specific compile/typecheck commands when the repo actually supports them. Examples: run \`npx tsc --noEmit\` only when TypeScript is configured, \`go build ./...\` only when a Go module exists, and similar for other ecosystems
4. Run the project's test command if tests exist and are relevant to your change
5. Run lint if configured and relevant to your change
6. If the repo does not expose a heavier compile/test command, run the smallest valid verification for the actual stack instead (for example \`node -c\` for a simple JavaScript entry file)
7. Fix any errors you find — do not leave broken code for the next expert

Verification rules:
- Do NOT invent generic verification commands. Derive them from the actual repo/toolchain in front of you.
- Do NOT run \`npx tsc --noEmit\` in plain JavaScript repos that do not have TypeScript configured.
- Do NOT treat missing toolchains as blockers if they are not part of the repo's actual stack.
- If a verification command fails because the toolchain is absent or not applicable, choose a smaller repo-appropriate verification instead of repeating the same bad command.

Dependency rules:
- NEVER downgrade a dependency version. If a package is at v4.x, do not change it to v3.x. Downgrades break peer dependencies and CI.
- NEVER change dependency versions in package.json unless your story specifically requires adding a new dependency or the task explicitly asks for a version change.
- If you encounter a compatibility issue with an existing dependency, work within the current version — do not downgrade to an older API.

If anything described in your scope is NOT implemented, fix it before finishing. Do not leave partial work.

Working directory: ${workingDir}

## Communication Style

Write in a professional, direct tone. Do NOT open messages with filler words or pleasantries like "Perfect!", "Great!", "Awesome!", "Sure!", "Absolutely!", or similar. Start with the substance — what you did, what you found, or what you need. Be concise and informative. Do NOT repeat what you said in previous steps — each response should add new information only.
Think out loud as you work: before major tool calls, briefly state your intent; after major tool calls, briefly report what changed and your next step.

When summarizing your work at the end, describe decisions in plain language. The internal DEC-xxx markers are parsed by the system automatically — your summary should restate decisions in readable form.

## Critical rules
- NEVER start long-running processes (dev servers, watch modes, npm start, npm run dev, nodemon, tsc --watch, webpack serve, etc.). These block execution indefinitely.
- NEVER run interactive commands that wait for user input.
- Only run commands that complete and exit.
- If you need to verify a server works, check that the code compiles or run a quick test — do NOT start the actual server.

## How you deliver work
**You MUST use tools (edit_file, write_file, multi_edit_file, patch) to make every code change.** Describing what you would change in prose is NOT work — only tool calls that modify files on disk count. If you finish without having called any file-writing tool, you have failed the task.

After using tools to make changes, add these metadata markers in your text output so the system can track what happened:
- ::decision:: for decisions that affect other parts of the system
- ::file_created::path for files you created
- ::file_modified::path for files you modified
These markers are metadata ONLY — they do not replace actually using tools.

## Diagnostics Enforcement
Run diagnostics on touched files only when the workspace and language server support them for this repo. If LSP is unavailable or not applicable to the stack, do not invent diagnostics workarounds; use the repo's actual verification commands instead.
${needsDockerInstructions(story, userTask) ? DOCKER_INSTRUCTIONS : ""}${EXTERNAL_TOOLS}${revisionFeedback ? `\n\n## Revision requested\n${revisionFeedback}` : ""}`;

  return {
    systemPrompt,
    prompt: story.description,
  };
}

/* -------------------------------------------------------------------------- */
/*  fitWorkerPromptToContext                                                   */
/* -------------------------------------------------------------------------- */

export function fitWorkerPromptToContext(args: {
  personaSystemPrompt: string;
  projectInstructions: string;
  userTask: string;
  story: Story;
  contextBlock: string;
  revisionFeedback: string;
  workingDir: string;
  personaTools: ToolSet;
  contextWindow: number;
  aggressive?: boolean;
  overflowTokens?: number;
}): { systemPrompt: string; prompt: string; trimmedSections: string[]; estimatedTokens: number; budgetTokens: number } {
  const {
    personaSystemPrompt,
    projectInstructions,
    story,
    workingDir,
    personaTools,
    contextWindow,
    aggressive = false,
    overflowTokens = 0,
  } = args;
  let userTask = args.userTask;
  let contextBlock = args.contextBlock;
  let implementationNotes = story.implementationNotes || "";
  let revisionFeedback = args.revisionFeedback;
  const trimmedSections: string[] = [];
  const toolTokens = estimateToolSchemaTokens(personaTools);
  const budgetTokens = Math.floor(contextWindow * (aggressive ? 0.72 : 0.84));

  const build = () => buildWorkerPromptSections({
    personaSystemPrompt,
    projectInstructions,
    userTask,
    story: { ...story, implementationNotes },
    contextBlock,
    revisionFeedback,
    workingDir,
  });

  let built = build();
  let estimatedTokens = estimateContextTokens(
    [
      { content: built.systemPrompt },
      { content: built.prompt },
    ],
    0,
  ) + toolTokens;

  const shrinkers: Array<{
    name: string;
    get: () => string;
    set: (value: string) => void;
    minKeepChars: number;
  }> = [
    {
      name: "prior story context",
      get: () => contextBlock,
      set: (value) => { contextBlock = value; },
      minKeepChars: aggressive ? 1_000 : 2_000,
    },
    {
      name: "implementation guidance",
      get: () => implementationNotes,
      set: (value) => { implementationNotes = value; },
      minKeepChars: aggressive ? 1_000 : 2_000,
    },
    {
      name: "revision feedback",
      get: () => revisionFeedback,
      set: (value) => { revisionFeedback = value; },
      minKeepChars: 800,
    },
    {
      name: "ticket requirements",
      get: () => userTask,
      set: (value) => { userTask = value; },
      minKeepChars: aggressive ? 2_000 : 4_000,
    },
  ];

  for (const shrinker of shrinkers) {
    if (estimatedTokens <= budgetTokens) break;
    const current = shrinker.get();
    if (!current) continue;
    const removable = current.length - shrinker.minKeepChars;
    if (removable <= 0) continue;
    const overflowChars = Math.max(1_500, Math.ceil((estimatedTokens - budgetTokens) * 4.2));
    const reduceBy = Math.min(removable, Math.max(overflowChars, Math.ceil(current.length * (aggressive ? 0.45 : 0.25))));
    const nextMaxChars = Math.max(shrinker.minKeepChars, current.length - reduceBy);
    const next = truncateForPrompt(current, nextMaxChars, shrinker.name);
    if (next !== current) {
      shrinker.set(next);
      trimmedSections.push(shrinker.name);
      built = build();
      estimatedTokens = estimateContextTokens(
        [
          { content: built.systemPrompt },
          { content: built.prompt },
        ],
        0,
      ) + toolTokens;
    }
  }

  let forcedOverflowChars = overflowTokens > 0 ? Math.ceil(overflowTokens * 4.5) + 8_000 : 0;
  for (const shrinker of shrinkers) {
    if (forcedOverflowChars <= 0) break;
    const current = shrinker.get();
    if (!current) continue;
    const removable = current.length - shrinker.minKeepChars;
    if (removable <= 0) continue;
    const reduceBy = Math.min(removable, forcedOverflowChars);
    const next = truncateForPrompt(current, Math.max(shrinker.minKeepChars, current.length - reduceBy), shrinker.name);
    if (next !== current) {
      shrinker.set(next);
      trimmedSections.push(shrinker.name);
      built = build();
      estimatedTokens = estimateContextTokens(
        [
          { content: built.systemPrompt },
          { content: built.prompt },
        ],
        0,
      ) + toolTokens;
      forcedOverflowChars -= reduceBy;
    }
  }

  return {
    systemPrompt: built.systemPrompt,
    prompt: built.prompt,
    trimmedSections: [...new Set(trimmedSections)],
    estimatedTokens,
    budgetTokens,
  };
}

/* -------------------------------------------------------------------------- */
/*  checkToolPermission                                                       */
/* -------------------------------------------------------------------------- */

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
  // Dangerous commands ALWAYS prompt — even in trust/bypass mode.
  // Trust mode skips normal permission prompts but not safety gates.
  if (toolName === "bash") {
    const cmd = String(toolInput.command || "");
    const danger = isDangerous(cmd);
    if (danger) {
      logger.info("Dangerous prompt shown (orchestrator)", { tool: toolName, danger });
      output.error(`DANGEROUS: ${danger}`);
      output.error(`Command: ${cmd}`);
      const result = await output.confirm("This is a dangerous operation. Are you sure?");
      const allowed = typeof result === "object" ? result.allowed : result;
      logger.info("Dangerous prompt resolved (orchestrator)", { tool: toolName, allowed, result: JSON.stringify(result) });
      return allowed;
    }
  }

  // Bypass mode — skips normal prompts but NOT dangerous command gates above
  const isTrustedEarly = typeof trustAll === "function" ? trustAll() : trustAll;
  const isBypass = isTrustedEarly || sessionAllow.has("*");

  // Dangerous file path check for write operations
  if (toolName === "write_file" || toolName === "edit_file" || toolName === "patch" || toolName === "multi_edit_file") {
    const filePath = extractToolFilePath(toolName, toolInput);
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
      // "Yes, don't ask again" — save to project-level settings.local.json
      // (matches Claude Code behavior and single-agent path in useAgent.ts)
      try {
        const { toolInputToRule, splitCompoundCommand } = await import("../safety.js");
        const { loadLocalSettings, saveLocalSettings } = await import("../config.js");
        const lSettings = loadLocalSettings() || {};
        lSettings.allow = lSettings.allow || [];
        const rules = toolName === "bash" && toolInput.command
          ? splitCompoundCommand(String(toolInput.command)).map((cmd) => toolInputToRule(toolName, { command: cmd }))
          : [toolInputToRule(toolName, toolInput)];
        for (const rule of rules) {
          if (rule && !lSettings.allow.includes(rule)) {
            lSettings.allow.push(rule);
          }
        }
        saveLocalSettings(lSettings);
      } catch {
        // Fall back to session-only
      }
      sessionAllow.add(toolName);
    }
    return result.allowed;
  }

  // Simple boolean — allow once, no persistence
  return result;
}

/* -------------------------------------------------------------------------- */
/*  extractCheckpointTargets                                                  */
/* -------------------------------------------------------------------------- */

export function extractCheckpointTargets(toolName: string, toolInput: Record<string, unknown>, workingDir: string): Array<{ path: string; tool: "write_file" | "edit_file" | "multi_edit_file" | "patch" }> {
  if (toolName === "patch" && typeof toolInput.patch_text === "string") {
    const rows = toolInput.patch_text.replace(/\r\n/g, "\n").split("\n");
    const targets: Array<{ path: string; tool: "patch" }> = [];
    for (let i = 0; i < rows.length; i++) {
      if (!rows[i].startsWith("--- ")) continue;
      const plus = rows[i + 1];
      if (!plus || !plus.startsWith("+++ ")) continue;
      const oldRaw = rows[i].replace(/^---\s+/, "").trim().replace(/^[ab]\//, "");
      const newRaw = plus.replace(/^\+\+\+\s+/, "").trim().replace(/^[ab]\//, "");
      const candidate = oldRaw === "/dev/null" ? newRaw : (newRaw === "/dev/null" ? oldRaw : newRaw);
      if (!candidate || candidate === "/dev/null") continue;
      const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(workingDir, candidate);
      if (!targets.some((t) => t.path === resolved)) targets.push({ path: resolved, tool: "patch" });
    }
    return targets;
  }

  if ((toolName === "write_file" || toolName === "edit_file" || toolName === "multi_edit_file")
      && (typeof toolInput.path === "string" || typeof toolInput.file_path === "string")) {
    const raw = String(toolInput.path || toolInput.file_path);
    const resolved = path.isAbsolute(raw) ? raw : path.resolve(workingDir, raw);
    return [{ path: resolved, tool: toolName }];
  }

  return [];
}

/* -------------------------------------------------------------------------- */
/*  formatToolCallDisplay                                                     */
/* -------------------------------------------------------------------------- */

/** Format a tool call for display — short and to the point. */
export function formatToolCallDisplay(toolName: string, toolInput: Record<string, unknown>): string {
  const toolFilePath = extractToolFilePath(toolName, toolInput);
  if (toolFilePath) return toolFilePath;
  if (toolInput.command) {
    const cmd = String(toolInput.command);
    return cmd.length > 80 ? cmd.slice(0, 77) + "..." : cmd;
  }
  return "";
}

/* -------------------------------------------------------------------------- */
/*  Story contract / definition-of-done                                       */
/* -------------------------------------------------------------------------- */

export function getStoryDefinitionOfDone(story: Story): {
  requiredFiles: string[];
  requiredTests: string[];
  requiredCommands: string[];
} {
  return {
    requiredFiles: uniqueStrings(story.requiredFiles ?? []),
    requiredTests: uniqueStrings([...(story.requiredTests ?? []), ...deriveAutoRequiredTests(story)]),
    requiredCommands: uniqueStrings(story.requiredCommands ?? []),
  };
}

export function findExcludedTestFallback(workingDir: string, requiredTest: string): string | null {
  const basename = path.basename(requiredTest);
  const direct = path.join(workingDir, "src/__tests__/e2e", basename);
  if (fs.existsSync(direct)) return toPosixPath(path.relative(workingDir, direct));

  const e2eAlt = basename.replace(/\.test(\.[^.]+)$/, ".e2e.test$1");
  const alt = path.join(workingDir, "src/__tests__/e2e", e2eAlt);
  if (fs.existsSync(alt)) return toPosixPath(path.relative(workingDir, alt));

  return null;
}

export function validateStoryContractArtifacts(story: Story, workingDir: string): StoryContractIssue[] {
  const contract = getStoryDefinitionOfDone(story);
  const issues: StoryContractIssue[] = [];

  for (const file of contract.requiredFiles) {
    const fullPath = path.isAbsolute(file) ? file : path.join(workingDir, file);
    if (!fs.existsSync(fullPath)) {
      issues.push({
        code: "missing_required_file",
        storyId: story.id,
        title: story.title,
        path: file,
        message: `Required file is missing: ${file}`,
      });
    }
  }

  for (const testFile of contract.requiredTests) {
    if (isExcludedTestPath(testFile)) {
      issues.push({
        code: "test_only_in_excluded_suite",
        storyId: story.id,
        title: story.title,
        path: testFile,
        message: `Required test is under an excluded suite: ${testFile}`,
      });
      continue;
    }

    const fullPath = path.isAbsolute(testFile) ? testFile : path.join(workingDir, testFile);
    if (!fs.existsSync(fullPath)) {
      const excludedFallback = findExcludedTestFallback(workingDir, testFile);
      issues.push({
        code: excludedFallback ? "test_only_in_excluded_suite" : "missing_required_test",
        storyId: story.id,
        title: story.title,
        path: excludedFallback || testFile,
        message: excludedFallback
          ? `Expected normal regression test ${testFile}, but only found excluded-suite coverage at ${excludedFallback}`
          : `Required test is missing: ${testFile}`,
      });
    }
  }

  return issues;
}

export function formatContractIssuesForPrompt(issues: StoryContractIssue[]): string {
  return issues.map((issue) => `- [${issue.code}] ${issue.message}`).join("\n");
}

export function emitFailureCode(output: OrchestrationOutput, code: FailureCode, detail: string): void {
  output.log("system", `::failure_code::${code}`);
  output.error(`[${code}] ${detail}`);
}

export interface StoryOwnershipAssessment {
  outOfScope: string[];
  ratio: number;
  severity: "none" | "warn" | "block";
}

export function assessStoryFileOwnership(
  touchedFiles: string[],
  story: Story,
  workingDir: string,
): StoryOwnershipAssessment {
  if (
    touchedFiles.length === 0 ||
    !(story.targetFiles?.length || story.requiredFiles?.length || story.requiredTests?.length)
  ) {
    return { outOfScope: [], ratio: 0, severity: "none" };
  }

  const allowedFiles = new Set([
    ...(story.targetFiles || []),
    ...(story.requiredFiles || []),
    ...(story.requiredTests || []),
  ]);

  const normalize = (filePath: string) => {
    const rel = path.isAbsolute(filePath) ? path.relative(workingDir, filePath) : filePath;
    return rel.replace(/\\/g, "/");
  };

  const allowedNormalized = new Set([...allowedFiles].map(normalize));
  const outOfScope = touchedFiles
    .map(normalize)
    .filter((filePath) => !allowedNormalized.has(filePath));

  if (outOfScope.length === 0) {
    return { outOfScope: [], ratio: 0, severity: "none" };
  }

  const ratio = outOfScope.length / touchedFiles.length;
  if (ratio > 0.5 && outOfScope.length > 3) {
    return { outOfScope, ratio, severity: "block" };
  }
  return { outOfScope, ratio, severity: "warn" };
}

/* -------------------------------------------------------------------------- */
/*  runDiagnosticsOnTouchedFiles                                              */
/* -------------------------------------------------------------------------- */

/** Run LSP diagnostics on touched files. Returns error count (0 = clean, -1 = no LSP). */
export async function runDiagnosticsOnTouchedFiles(
  touchedFiles: string[],
  workingDir: string,
  log: (msg: string) => void,
): Promise<{ errorCount: number; section: string }> {
  if (touchedFiles.length === 0) return { errorCount: 0, section: "" };

  // Filter out tsconfig-excluded files (test files produce false-positive diagnostics)
  const excludes = lspTool.loadTsconfigExcludes(workingDir);
  const unique = [...new Set(touchedFiles)].filter((f) => {
    const rel = path.isAbsolute(f) ? path.relative(workingDir, f) : f;
    return !excludes.some((re) => re.test(rel));
  });
  if (unique.length === 0) return { errorCount: 0, section: "" };

  log(`Running diagnostics on ${unique.length} touched file(s)...`);
  let totalErrors = 0;
  let lspAvailable = true;
  const lines: string[] = [];
  for (const filePath of unique) {
    try {
      const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(workingDir, filePath);
      if (!fs.existsSync(resolvedPath)) { log(`⚠ File not found: ${filePath}`); continue; }
      const r = await lspTool.execute({ action: "diagnostics", file: resolvedPath, format: "json" }, workingDir);
      if (r.success && r.content) {
        try {
          const parsed = JSON.parse(r.content);
          if (parsed.lsp_available === false) { lspAvailable = false; continue; }
          const errors = parsed.summary?.errors ?? parsed.diagnostics?.filter((d: { severity: string }) => d.severity === "error").length ?? 0;
          totalErrors += errors;
          const status = errors > 0 ? `✗ ${filePath}: ${errors} error(s)` : `✓ ${filePath}: clean`;
          log(status);
          lines.push(status);
          // Include first few error details for reviewer context
          if (errors > 0 && parsed.diagnostics) {
            for (const d of parsed.diagnostics.slice(0, 5)) {
              lines.push(`    ${d.line}:${d.col} ${d.message}`);
            }
            if (parsed.diagnostics.length > 5) lines.push(`    ... and ${parsed.diagnostics.length - 5} more`);
          }
        } catch {
          log(`✓ ${filePath}: ${r.content}`);
        }
      } else {
        log(`✗ ${filePath}: ${r.error}`);
      }
    } catch (err) {
      log(`✗ ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!lspAvailable && totalErrors === 0) return { errorCount: -1, section: "" };

  // Build a section for the reviewer
  const section = totalErrors > 0
    ? `\n\n## LSP Diagnostics — ${totalErrors} ERROR(S)\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n\nThese type errors were found in touched files. Factor them into your review — request revision if they indicate real bugs.`
    : lines.length > 0
      ? `\n\n## LSP Diagnostics — CLEAN\n\n${lines.map(l => `- ${l}`).join("\n")}`
      : "";

  return { errorCount: totalErrors, section };
}

/* -------------------------------------------------------------------------- */
/*  executeStories                                                            */
/* -------------------------------------------------------------------------- */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyToolDef = any;

export interface ExecuteStoriesParams {
  sorted: Story[];
  completedStoryIds: string[];
  config: CliConfig;
  output: OrchestrationOutput;
  trustAll: boolean | (() => boolean);
  sandboxed: boolean | "os";
  userTask: string;
  context: SharedContext;
  sessionAllow: Set<string>;
  workingDir: string;
  costTracker: CostTracker;
  featureBranch: string | null;
  mainBranch: string;
  abortSignal?: AbortSignal;
  liveViewServer?: import("../live-view-server.js").LiveViewServer;
  ticketOps: { postComment(comment: string): Promise<void> } | null;
  /** Run manifest ID — used for memory provenance tracking */
  runId?: string;

  // Callbacks from the orchestrator
  waitWhilePaused: () => Promise<boolean>;
  pauseForBalanceIssue: (scope: string) => Promise<boolean>;
  logRetryHint: () => void;
}

export interface ExecuteStoriesResult {
  completedStoryIds: string[];
  failedStories: Set<string>;
  skippedStories: Set<string>;
  retryable: boolean;
  context: SharedContext;
  /** True if the loop exited early (user cancel, abort, or balance issue). */
  earlyExit: boolean;
}

export async function executeStories(params: ExecuteStoriesParams): Promise<ExecuteStoriesResult> {
  const {
    sorted,
    completedStoryIds,
    config,
    output,
    trustAll,
    sandboxed,
    userTask,
    context,
    sessionAllow,
    workingDir,
    costTracker,
    featureBranch,
    mainBranch,
    abortSignal,
    liveViewServer,
    ticketOps,
    waitWhilePaused,
    pauseForBalanceIssue,
    logRetryHint,
  } = params;

  const failedStories = new Set<string>();
  const skippedStories = new Set<string>();
  let retryable = true;

  for (let i = 0; i < sorted.length; i++) {
    if (await waitWhilePaused()) {
      return { completedStoryIds, failedStories, skippedStories, retryable, context, earlyExit: true };
    }

    // Check if user cancelled (ESC) before starting next story
    if (abortSignal?.aborted) {
      output.coordinatorLog("Build cancelled.");
      logger.info("Build cancelled by user before story start", { storyIndex: i });
      logRetryHint();
      return { completedStoryIds, failedStories, skippedStories, retryable, context, earlyExit: true };
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
      const envVar = getApiKeyEnvVar(provider);
      if (envVar && !process.env[envVar]) process.env[envVar] = apiKey;
    }

    output.log("system", `--- Story ${i + 1}/${sorted.length} ---`);
    output.log(story.persona, `Starting ${story.title} (\x1b[38;5;208m${provider}/${modelName}\x1b[0m, ${formatContext(getModelContext(modelName, contextLength))} context)`);
    logger.info(`Story ${i + 1}/${sorted.length} started`, { persona: story.persona, title: story.title, provider, model: modelName });

    // Set provenance context for memory tool — so agent-created memories track their origin
    if (params.runId) process.env.WM_RUN_ID = params.runId;
    process.env.WM_STORY_ID = story.id;
    process.env.WM_PERSONA = story.persona;

    // Emit live view events
    if (liveViewServer) {
      liveViewServer.emitStoryStart(i + 1, story.title, story.persona, sorted.length);
    }

    output.status(`${story.persona}: ${story.title.slice(0, 60)}`);

    const model = createModel(provider as AIProvider, modelName, host, contextLength, apiKey);

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
    const startedDockerCompose = new Set<string>(); // tracks cwd where compose was started
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
            for (const target of extractCheckpointTargets(toolName, input, workingDir)) {
              checkpoint(target.path, target.tool);
            }
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

    // Deferred tool loading — cap MCP tools to prevent context overflow on local models.
    // If MCP tools exceed 20, keep only the first 20 and log the rest as deferred.
    const mcpNames = Object.keys(personaTools).filter(n => n.startsWith("mcp__"));
    if (mcpNames.length > 20) {
      const deferred = mcpNames.slice(20);
      for (const name of deferred) {
        delete personaTools[name];
      }
      logger.info("Deferred excess MCP tools in orchestrator", { total: mcpNames.length, deferred: deferred.length, kept: 20 });
      output.log("system", `${deferred.length} MCP tools deferred to fit context (${mcpNames.length} total, 20 kept)`);
    }

    // Add skill tool — lets story workers invoke custom skills mid-execution
    personaTools["skill"] = {
      description: "Invoke a custom skill by name. Skills are reusable workflows from .workermill/skills/.",
      inputSchema: z.object({
        name: z.string().describe("The skill name to invoke"),
        args: z.string().optional().describe("Optional arguments"),
      }),
      execute: async ({ name: skillName, args }: { name: string; args?: string }) => {
        const { loadCustomCommands } = await import("../custom-commands.js");
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

    let revisionFeedback = "";
    let storyRateLimitRetries = 0;
    let contextOverflowRetries = 0;
    let contextOverflowSlackTokens = 0;
    const retryErrorSignatureCounts = new Map<string, number>();

    // Snapshot workspace before story execution — restore on retry so each
    // attempt starts clean instead of inheriting half-broken state.
    let preStoryHash = "";
    let preStoryUntrackedFiles: string[] = [];
    try {
      preStoryHash = execSync("git rev-parse HEAD 2>/dev/null", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
      preStoryUntrackedFiles = execSync("git ls-files --others --exclude-standard 2>/dev/null", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim().split("\n").filter(Boolean);
    } catch { /* not a git repo or no commits yet */ }

    for (let revision = 0; revision <= 2; revision++) {

    // On retry, restore workspace to pre-story state
    if (revision > 0 && preStoryHash) {
      try {
        // Restore tracked files to pre-story state
        execSync(`git checkout ${preStoryHash} -- . 2>/dev/null`, { cwd: workingDir, stdio: "pipe" });
        // Remove files created by the failed attempt (not in pre-story untracked set)
        const currentUntracked = execSync("git ls-files --others --exclude-standard 2>/dev/null", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim().split("\n").filter(Boolean);
        const preSet = new Set(preStoryUntrackedFiles);
        for (const file of currentUntracked) {
          if (!preSet.has(file)) {
            try { fs.unlinkSync(path.join(workingDir, file)); } catch { /* best effort */ }
          }
        }
        logger.info("Workspace restored before retry", { story: story.id, revision, restoredTo: preStoryHash.slice(0, 8) });
      } catch (restoreErr) {
        logger.warn("Workspace restore failed — retrying on dirty state", { error: restoreErr instanceof Error ? restoreErr.message : String(restoreErr) });
      }
    }

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
    const contextWindow = getModelContext(modelName, contextLength);
    const fittedPrompt = fitWorkerPromptToContext({
      personaSystemPrompt: persona.systemPrompt,
      projectInstructions,
      userTask,
      story,
      contextBlock,
      revisionFeedback,
      workingDir,
      personaTools: personaTools as ToolSet,
      contextWindow,
      aggressive: contextOverflowRetries > 0,
      overflowTokens: contextOverflowSlackTokens,
    });
    const systemPrompt = fittedPrompt.systemPrompt;
    if (fittedPrompt.trimmedSections.length > 0) {
      output.log(
        "system",
        `Trimmed ${fittedPrompt.trimmedSections.join(", ")} to fit ${formatContext(contextWindow)} context (${Math.round(fittedPrompt.estimatedTokens / 1000)}K/${Math.round(fittedPrompt.budgetTokens / 1000)}K prompt budget)`,
      );
      logger.info("Worker prompt trimmed for context", {
        story: story.id,
        persona: story.persona,
        provider,
        model: modelName,
        contextWindow,
        estimatedTokens: fittedPrompt.estimatedTokens,
        budgetTokens: fittedPrompt.budgetTokens,
        trimmedSections: fittedPrompt.trimmedSections,
        aggressive: contextOverflowRetries > 0,
      });
    }

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

      // Captures representative expert text for ticket comments.
      let expertSummary = "";
      let lastSyntheticThinkingSig = "";
      const reasoningLength = { value: 0 };

      // Track tool calls for structured ticket update
      const storyActions: Array<{ tool: string; detail: string }> = [];

      const storyStartMs = Date.now();
      const stream = streamText({
        model,
        abortSignal: combinedAbort.signal,
        system: systemPrompt,
        prompt: fittedPrompt.prompt,
        tools: personaTools as ToolSet,
        stopWhen: stepCountIs(100),
        timeout: { chunkMs: 120_000 },
        ...buildReasoningOptions(provider, modelName),
        ...buildOllamaOptions(provider as AIProvider, contextLength),
        onStepFinish({ text, toolCalls, reasoningText }) {
          emitReasoningDelta((line) => output.log(story.persona, line), reasoningText, reasoningLength);
          if (toolCalls && toolCalls.length > 0) {
            // Track actions for ticket update
            for (const tc of toolCalls) {
              const name = tc.toolName;
              const input = tc.input as Record<string, unknown>;
              const filePath = extractToolFilePath(name, input);
              if (name === "write_file" && filePath) {
                storyActions.push({ tool: "created", detail: filePath });
                if (liveViewServer) liveViewServer.emitFileChange(story.persona, i + 1, story.title, filePath, "created");
              } else if ((name === "edit_file" || name === "multi_edit_file" || name === "patch") && filePath) {
                storyActions.push({ tool: "edited", detail: filePath });
                if (liveViewServer) liveViewServer.emitFileChange(story.persona, i + 1, story.title, filePath, "edited");
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
            if ((!text || !text.trim()) && toolCalls.length > 0) {
              const first = toolCalls[0];
              const detail = formatToolCallDisplay(first.toolName, first.input as Record<string, unknown>);
              const sig = `${first.toolName}:${detail}`;
              if (sig !== lastSyntheticThinkingSig) {
                output.log(story.persona, `${first.toolName}${detail ? ` ${detail}` : ""}`);
                lastSyntheticThinkingSig = sig;
              }
            }
          }

          if (text) {
            // Keep a representative sample for ticket comments.
            if (!expertSummary) expertSummary = text.slice(0, 2000);
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
          output.status(`${story.persona}: working...`);
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
        return { completedStoryIds, failedStories, skippedStories, retryable, context, earlyExit: true };
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

      const extractedMemories = extractMemoryMarkers(text).filter((m) => isHighConfidenceMemory(m.content));
      for (const memory of extractedMemories) {
        addMemory(memory.type, memory.content, workingDir, undefined, undefined, {
          source: "agent",
          confidence: "high",
          runId: params.runId,
          storyId: story.id,
          persona: story.persona,
        });
      }

      context.filesCreated.push(...extractDeclaredFileMarkers(text, "file_created"));
      context.filesModified.push(...extractDeclaredFileMarkers(text, "file_modified"));

      // Track cost
      const inTokens = usage?.inputTokens || 0;
      const outTokens = usage?.outputTokens || 0;
      costTracker.addUsage(persona.name, provider, modelName, inTokens, outTokens);
      output.updateCost?.(costTracker.getTotalCost());
      output.updateUsageSummary?.(costTracker.getUsageSummary());

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
        emitFailureCode(output, "worker_no_output", `Story ${i + 1} failed: model produced no output after 3 attempts`);
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

      {
        const contractIssues = validateStoryContractArtifacts(story, workingDir);
        if (contractIssues.length > 0) {
          logger.info("Story contract validation failed", {
            story: story.id,
            persona: story.persona,
            issues: contractIssues.map((issue) => ({ code: issue.code, path: issue.path, command: issue.command })),
          });
          if (revision < 2) {
            output.log(story.persona, `${contractIssues.length} definition-of-done issue(s) detected — retrying`);
            revisionFeedback = `\n\n## Definition Of Done Failures\n${formatContractIssuesForPrompt(contractIssues)}\n\nFix every blocking item above before finishing this story.`;
            continue;
          }

          for (const issue of contractIssues) {
            emitFailureCode(output, issue.code, `Story ${i + 1}: ${issue.message}`);
          }
          failedStories.add(story.id);
          break;
        }
      }

      // Detect stories that still produced no real file changes on disk.
      // This catches both pure narration and failed/no-op write tool attempts.
      {
        const fileActions = storyActions.filter(a => a.tool === "created" || a.tool === "edited");
        const canCheckGitChanges = isGitRepo(workingDir);
        let hasDiskChanges = false;
        if (canCheckGitChanges) {
          try {
            const diffOut = execSync("git diff HEAD --name-only", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
            const untrackedOut = execSync("git ls-files --others --exclude-standard", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
            hasDiskChanges = diffOut.length > 0 || untrackedOut.length > 0;
          } catch { /* best effort */ }
        }

        if (outTokens > 0 && canCheckGitChanges && !hasDiskChanges) {
          logger.info("Story produced output but no file changes on disk", {
            persona: story.persona,
            outTokens,
            fileActionCount: fileActions.length,
          });

          if (revision < 2) {
            output.log(story.persona, "No file changes detected — retrying with stronger guidance");
            const guidance = fileActions.length === 0
              ? "You described what to do but did NOT actually use tools to write code."
              : "You called file-edit tools, but they did not produce any persisted file changes.";
            revisionFeedback = `\n\n## No Changes Written\n${guidance} Your previous response left zero tracked or untracked file changes on disk.\n\n**You MUST use the edit_file, write_file, or multi_edit_file tools to make real edits.** Describing changes with ::file_modified:: markers is NOT the same as making them. Actually write the code now and ensure files are changed on disk.`;
            continue;
          }

          const reason = fileActions.length === 0
            ? "model narrated changes but never wrote code"
            : "model called write tools but produced no persisted file changes";
          output.error(`Story ${i + 1} failed: ${reason} after 3 attempts`);
          failedStories.add(story.id);
          break;
        }
      }

      // --- File ownership enforcement ---
      // Compare files touched by this story against its declared scope.
      // Small adjacent edits are tolerated with a warning; major drift blocks
      // the attempt and retries on a clean restored workspace.
      {
        const touchedFiles = storyActions
          .filter(a => a.tool === "created" || a.tool === "edited")
          .map(a => a.detail);
        const ownership = assessStoryFileOwnership(touchedFiles, story, workingDir);

        if (ownership.severity === "block") {
          const detail = `Story ${i + 1} edited ${ownership.outOfScope.length} file(s) outside its declared scope: ${ownership.outOfScope.slice(0, 5).join(", ")}${ownership.outOfScope.length > 5 ? ` +${ownership.outOfScope.length - 5} more` : ""}`;
          logger.warn("Story file ownership drift", {
            story: story.id,
            outOfScope: ownership.outOfScope,
            ratio: Math.round(ownership.ratio * 100),
          });

          if (revision < 2) {
            output.log("system", `⚠ ${detail} — retrying with stronger scope guidance`);
            revisionFeedback = `\n\n## Scope Violation\nYour previous attempt edited files outside this story's declared scope.\n\nOut-of-scope edits:\n${ownership.outOfScope.map((file) => `- ${file}`).join("\n")}\n\nYou MUST constrain this story to its declared files unless a change is explicitly required to wire into an existing integration point. Retry with a narrower edit set.`;
            continue;
          }

          emitFailureCode(output, "out_of_scope_edit", detail);
          output.error(`Story ${i + 1} failed: edited too many files outside its declared scope after 3 attempts`);
          failedStories.add(story.id);
          break;
        }

        if (ownership.severity === "warn") {
          if (config.review?.strict) {
            // Strict mode: any out-of-scope edit is blocking
            const detail = `[strict] Story ${i + 1} edited ${ownership.outOfScope.length} file(s) outside scope: ${ownership.outOfScope.join(", ")}`;
            output.log("system", `⚠ ${detail}`);
            if (revision < 2) {
              revisionFeedback = `\n\n## Scope Violation (strict mode)\nOut-of-scope edits:\n${ownership.outOfScope.map((file) => `- ${file}`).join("\n")}\n\nStrict mode requires all edits to be within declared scope. Fix and retry.`;
              continue;
            }
            emitFailureCode(output, "out_of_scope_edit", detail);
            failedStories.add(story.id);
            break;
          }
          logger.info("Story edited files outside declared scope", { story: story.id, outOfScope: ownership.outOfScope });
        }
      }

      // --- Diagnostics enforcement ---
      const diagResult = await runDiagnosticsOnTouchedFiles(
        [...context.filesCreated, ...context.filesModified],
        workingDir,
        (msg) => output.log(story.persona, msg),
      );
      const diagnosticErrors = diagResult.errorCount;

      // Check abort before completing
      if (abortSignal?.aborted) {
        output.coordinatorLog("Build cancelled.");
        logRetryHint();
        return { completedStoryIds, failedStories, skippedStories, retryable, context, earlyExit: true };
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
          `### ${story.persona} (${provider}/${modelName}) — ${story.title} (${i + 1}/${sorted.length})\n\n${updateParts.join("\n")}`
        ).catch(() => {});
      }

      // Persist progress so /retry works across terminal restarts
      if (featureBranch) {
        saveShipRun({ workingDir, featureBranch, mainBranch, userTask, stories: sorted, completedStoryIds, updatedAt: "" });
      }

      // Commit story changes — creates a checkpoint on the feature branch
      // Gate: don't commit if LSP found errors (diagnosticErrors === -1 means no LSP, allow commit)
      if (featureBranch && diagnosticErrors <= 0) {
        const hash = commitStoryChanges(workingDir, i + 1, story.title, story.persona);
        if (hash) output.coordinatorLog(`Committed story ${i + 1}: ${hash}`);
      } else if (diagnosticErrors > 0) {
        output.coordinatorLog(`Story ${i + 1} has ${diagnosticErrors} diagnostic error(s) — commit skipped, will be caught in review`);
      }

      const storyElapsedForLiveView = (Date.now() - storyStartMs) / 1000;
      if (liveViewServer) liveViewServer.emitStoryComplete(i + 1, storyElapsedForLiveView);

          break; // Story succeeded, exit revision loop
    } catch (err) {
      output.statusDone();

      // If user cancelled (ESC), exit immediately — don't retry or classify
      if (abortSignal?.aborted) {
        output.coordinatorLog("Build cancelled.");
        logger.info("Build cancelled by user during story execution", { story: i + 1, persona: story.persona });
        logRetryHint();
        return { completedStoryIds, failedStories, skippedStories, retryable, context, earlyExit: true };
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Story ${i + 1} error`, { persona: story.persona, error: errMsg, revision });

      if (isBalanceOrQuotaError(errMsg)) {
        const shouldStop = await pauseForBalanceIssue(`Story ${i + 1}`);
        if (shouldStop) {
          return { completedStoryIds, failedStories, skippedStories, retryable, context, earlyExit: true };
        }
        // Retry same revision after user tops up or switches provider.
        continue;
      }

      const promptOverflow = parsePromptLengthError(err);
      if (promptOverflow && contextOverflowRetries < 1) {
        contextOverflowRetries++;
        contextOverflowSlackTokens = Math.max(0, promptOverflow.actualTokens - promptOverflow.limitTokens);
        output.log(
          "system",
          `Prompt exceeded model context (${formatContext(promptOverflow.actualTokens)} > ${formatContext(promptOverflow.limitTokens)}) — retrying with tighter prompt budget`,
        );
        logger.info("Retrying story after prompt-length overflow", {
          story: i + 1,
          persona: story.persona,
          provider,
          model: modelName,
          actualTokens: promptOverflow.actualTokens,
          limitTokens: promptOverflow.limitTokens,
        });
        continue;
      }

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
      const signature = `${errorClass.category}:${normalizeErrorSignature(errMsg)}`;
      const seenCount = (retryErrorSignatureCounts.get(signature) || 0) + 1;
      retryErrorSignatureCounts.set(signature, seenCount);

      // Transient errors — retry as-is
      if (errorClass.category === "transient" && revision < 2) {
        if (seenCount >= 2) {
          output.error(`Story ${i + 1} kept failing with the same transient error — stopping retries to avoid token waste.`);
          logger.info("Retry stopped on repeated transient error", { story: i + 1, signature });
          failedStories.add(story.id);
          break;
        }
        output.log(story.persona, `Transient error: ${errMsg} — retrying...`);
        logger.info(`Story ${i + 1} retrying (transient)`, { revision });
        continue;
      }

      // Fixable errors (typescript, lint, test, build) — retry with fix context
      if (errorClass.fixable && revision < 2) {
        if (seenCount >= 2) {
          output.error(`Story ${i + 1} repeated the same ${errorClass.category} error — stopping retries to avoid token waste.`);
          logger.info("Retry stopped on repeated fixable error", { story: i + 1, signature, category: errorClass.category });
          failedStories.add(story.id);
          break;
        }
        output.log(story.persona, `${errorClass.category} error detected — retrying with fix context (${revision + 1}/3)`);
        logger.info(`Story ${i + 1} retrying (fixable ${errorClass.category})`, { revision });
        const errorForPrompt = truncateForPrompt(errMsg, 2_500, "error details");
        revisionFeedback = `\n\n## Error During Execution — Fix This\n\nCategory: ${errorClass.category}\n\n${errorForPrompt}\n\n**${errorClass.fixHint}**`;
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

  return { completedStoryIds, failedStories, skippedStories, retryable, context, earlyExit: false };
}
