import type { ToolSet } from "ai";
import fs from "fs";
import path from "path";
import { isDangerous, isDangerousFile, READ_TOOLS, checkPermissionRules } from "../safety.js";
import { checkpoint } from "../checkpoints.js";
import * as logger from "../logger.js";
import { estimateContextTokens } from "../compaction.js";

import type { Story, OrchestrationOutput, FailureCode, StoryContractIssue, SharedContext } from "./types.js";
import {
  truncateForPrompt,
  estimateToolSchemaTokens,
  extractToolFilePath,
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

/* -------------------------------------------------------------------------- */
/*  needsDockerInstructions                                                   */
/* -------------------------------------------------------------------------- */

export function needsDockerInstructions(story: Story, userTask: string): boolean {
  const text = `${story.description} ${story.implementationNotes ?? ""} ${userTask} ${(story.targetFiles ?? []).join(" ")}`;
  return SERVICE_KEYWORDS.test(text);
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
