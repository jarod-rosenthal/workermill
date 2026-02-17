/**
 * Plan Validator for Remote Agent
 *
 * Validates execution plans locally before posting to the cloud API.
 * Implements the same guardrails as the server-side planning pipeline:
 *   1. File cap: max targetFiles per story, synced from server (prevents scope explosion)
 *   2. Critic validation: LLM scores the plan, rejects below threshold
 *
 * This ensures remote agent plans get the same quality gates as cloud plans,
 * even though the planning prompt runs locally via Claude CLI.
 */

import { spawn } from "child_process";
import chalk from "chalk";
import { generateText, type AIProvider } from "./providers.js";
import { api } from "./api.js";

// ============================================================================
// SERVER-SIDE CRITIC CONFIG (fetched at runtime, cached per session)
// ============================================================================

interface CriticConfig {
  promptTemplate: string;
  approvalThreshold: number;
  maxTargetFiles: number;
}

let cachedCriticConfig: CriticConfig | null = null;

/**
 * Fetch critic prompt and thresholds from the server.
 * Cached per agent session to avoid repeated API calls.
 * Returns null if the API is unreachable — caller decides how to proceed.
 */
export async function getCriticConfig(apiMaxTargetFiles?: number): Promise<CriticConfig | null> {
  if (cachedCriticConfig) return cachedCriticConfig;

  try {
    const params: Record<string, string> = {};
    if (apiMaxTargetFiles !== undefined) {
      params.maxTargetFiles = String(apiMaxTargetFiles);
    }
    const { data } = await api.get("/api/agent/critic-prompt", { params });
    cachedCriticConfig = {
      promptTemplate: data.promptTemplate,
      approvalThreshold: data.approvalThreshold ?? 85,
      maxTargetFiles: data.maxTargetFiles ?? apiMaxTargetFiles ?? 5,
    };
    // Sync module-level thresholds so applyFileCap and formatCriticFeedback use server values
    AUTO_APPROVAL_THRESHOLD = cachedCriticConfig.approvalThreshold;
    MAX_TARGET_FILES = cachedCriticConfig.maxTargetFiles;
    return cachedCriticConfig;
  } catch {
    console.warn("Failed to fetch critic config from API");
    return null;
  }
}

// ============================================================================
// TYPES (mirrors server-side planning-agent-local.ts)
// ============================================================================

export interface PlannedStory {
  id: string;
  title: string;
  description: string;
  persona: string;
  priority: number;
  estimatedEffort: "small" | "medium" | "large";
  dependencies: string[];
  acceptanceCriteria?: string[];
  targetFiles?: string[];
  scope?: string;
}

export interface ExecutionPlan {
  summary: string;
  stories: PlannedStory[];
  risks: string[];
  assumptions: string[];
}

export interface CriticResult {
  approved: boolean;
  score: number;
  risks: string[];
  suggestions?: string[];
  storyFeedback?: Array<{
    storyId: string;
    feedback: string;
    suggestedChanges?: string[];
  }>;
}

// ============================================================================
// CONSTANTS
// ============================================================================

// Defaults — overridden by server config when available
let MAX_TARGET_FILES = 5;
let AUTO_APPROVAL_THRESHOLD = 85;

// ============================================================================
// PLAN PARSING
// ============================================================================

/**
 * Parse execution plan JSON from raw Claude CLI output.
 * Mirrors server-side parseExecutionPlan() in planning-agent-local.ts.
 */
export function parseExecutionPlan(output: string): ExecutionPlan {
  // Strategy 1: Find ```json ... ``` block using bracket-matching instead of regex.
  // The lazy regex ([\s\S]*?) fails when JSON string values contain ``` (e.g., code
  // blocks in story descriptions from PRDs with CI/CD YAML examples).
  const jsonFenceStart = output.indexOf("```json");
  if (jsonFenceStart !== -1) {
    // Find the opening { after ```json
    const searchFrom = jsonFenceStart + 7; // length of "```json"
    const braceStart = output.indexOf("{", searchFrom);
    if (braceStart !== -1) {
      const extracted = extractBalancedJson(output, braceStart);
      if (extracted) {
        return JSON.parse(extracted);
      }
    }
  }

  // Strategy 2: Find raw JSON with "stories" key using bracket-matching
  const storiesIdx = output.indexOf('"stories"');
  if (storiesIdx !== -1) {
    // Walk backwards to find the opening {
    const before = output.substring(0, storiesIdx);
    const braceStart = before.lastIndexOf("{");
    if (braceStart !== -1) {
      const extracted = extractBalancedJson(output, braceStart);
      if (extracted) {
        return JSON.parse(extracted);
      }
    }
  }

  throw new Error("Could not find JSON execution plan in output");
}

/**
 * Extract a balanced JSON object from a string starting at the given position.
 * Properly handles nested braces, strings with escaped characters, and code
 * blocks embedded in JSON string values (which contain triple backticks).
 */
function extractBalancedJson(text: string, start: number): string | null {
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
      if (inString) escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.substring(start, i + 1);
      }
    }
  }

  return null; // Unbalanced
}

// ============================================================================
// FILE CAP
// ============================================================================

/**
 * Apply file cap to all stories. Truncates targetFiles > MAX_TARGET_FILES.
 * Returns details about truncated stories for logging.
 */
export function applyFileCap(
  plan: ExecutionPlan,
): { truncatedCount: number; details: string[] } {
  let truncatedCount = 0;
  const details: string[] = [];

  for (const story of plan.stories) {
    if (!story.targetFiles || !Array.isArray(story.targetFiles)) {
      story.targetFiles = [];
    } else if (story.targetFiles.length > MAX_TARGET_FILES) {
      const dropped = story.targetFiles.slice(MAX_TARGET_FILES);
      details.push(
        `${story.id}: ${story.targetFiles.length} files → ${MAX_TARGET_FILES} (dropped: ${dropped.join(", ")})`,
      );
      story.targetFiles = story.targetFiles.slice(0, MAX_TARGET_FILES);
      truncatedCount++;
    }
  }

  return { truncatedCount, details };
}

// ============================================================================
// STORY CAP
// ============================================================================

/**
 * Apply story cap to the plan. Truncates stories beyond maxStories.
 * Returns details about dropped stories for logging.
 */
export function applyStoryCap(
  plan: ExecutionPlan,
  maxStories: number,
): { droppedCount: number; details: string[] } {
  if (plan.stories.length <= maxStories) {
    return { droppedCount: 0, details: [] };
  }

  const droppedCount = plan.stories.length - maxStories;
  const dropped = plan.stories.slice(maxStories);
  const details = dropped.map(
    (s) => `${s.id}: "${s.title}" (${s.persona})`,
  );

  plan.stories = plan.stories.slice(0, maxStories);

  // Fix dependencies that reference dropped stories
  const validIds = new Set(plan.stories.map((s) => s.id));
  for (const story of plan.stories) {
    story.dependencies = story.dependencies.filter((dep) => validIds.has(dep));
  }

  return { droppedCount, details };
}

// ============================================================================
// FILE OVERLAP VALIDATION
// ============================================================================

/**
 * Resolve file overlaps by assigning each shared file to exactly one story.
 * When multiple stories list the same targetFile, the first story keeps it
 * and it's removed from subsequent stories. This prevents parallel merge
 * conflicts during consolidation — same auto-fix pattern as applyFileCap.
 *
 * Returns details about resolved overlaps for logging.
 */
export function resolveFileOverlaps(
  plan: ExecutionPlan,
): { resolvedCount: number; details: string[] } {
  const fileOwner = new Map<string, string>(); // file → first story that claims it
  let resolvedCount = 0;
  const details: string[] = [];

  for (const story of plan.stories) {
    if (!story.targetFiles || story.targetFiles.length === 0) continue;

    const kept: string[] = [];
    const removed: string[] = [];

    for (const file of story.targetFiles) {
      const owner = fileOwner.get(file);
      if (owner) {
        // File already claimed by an earlier story — remove from this one
        removed.push(file);
      } else {
        fileOwner.set(file, story.id);
        kept.push(file);
      }
    }

    if (removed.length > 0) {
      story.targetFiles = kept;
      resolvedCount += removed.length;
      details.push(
        `${story.id}: removed ${removed.join(", ")} (owned by ${removed.map((f) => fileOwner.get(f)).join(", ")})`,
      );
    }
  }

  return { resolvedCount, details };
}

// ============================================================================
// PLAN SERIALIZATION
// ============================================================================

/**
 * Re-serialize plan as a JSON code block for posting to the API.
 * The server-side parseExecutionPlan() expects ```json ... ``` blocks.
 */
export function serializePlan(plan: ExecutionPlan): string {
  return "```json\n" + JSON.stringify(plan, null, 2) + "\n```";
}

// ============================================================================
// CRITIC
// ============================================================================

/**
 * Build the critic prompt with PRD and plan substituted.
 * Requires getCriticConfig() to have been called first (caller responsibility).
 * Returns null if critic config was never fetched.
 */
export function buildCriticPrompt(
  prd: string,
  plan: ExecutionPlan,
): string | null {
  if (!cachedCriticConfig) return null;

  const planJson = JSON.stringify(plan, null, 2);
  return cachedCriticConfig.promptTemplate.replace("{{PRD}}", prd).replace("{{PLAN}}", planJson);
}

/**
 * Parse critic JSON response from raw Claude CLI output.
 * Uses bracket-matching (extractBalancedJson) instead of lazy regex to handle
 * backtick sequences in reasoning text that break the /```json([\s\S]*?)```/ pattern.
 */
export function parseCriticResponse(text: string): CriticResult {
  // Strategy 1: Find ```json fence and extract balanced JSON after it
  const jsonFenceStart = text.indexOf("```json");
  if (jsonFenceStart !== -1) {
    const braceStart = text.indexOf("{", jsonFenceStart + 7);
    if (braceStart !== -1) {
      const extracted = extractBalancedJson(text, braceStart);
      if (extracted) {
        return parseCriticJson(extracted);
      }
    }
  }

  // Strategy 2: Find plain ``` fence and extract balanced JSON after it
  if (text.includes("```")) {
    const fenceStart = text.indexOf("```");
    const braceStart = text.indexOf("{", fenceStart + 3);
    if (braceStart !== -1) {
      const extracted = extractBalancedJson(text, braceStart);
      if (extracted) {
        return parseCriticJson(extracted);
      }
    }
  }

  // Strategy 3: Find raw JSON object from first {
  const braceStart = text.indexOf("{");
  if (braceStart !== -1) {
    const extracted = extractBalancedJson(text, braceStart);
    if (extracted) {
      return parseCriticJson(extracted);
    }
  }

  throw new Error("No JSON found in critic response");
}

function parseCriticJson(jsonText: string): CriticResult {
  const result = JSON.parse(jsonText) as {
    approved: boolean;
    score: number;
    risks: string[];
    suggestions?: string[];
    storyFeedback?: Array<{
      storyId: string;
      feedback: string;
      suggestedChanges?: string[];
    }>;
  };

  return {
    approved: result.approved,
    score: Math.max(0, Math.min(100, Math.round(result.score))),
    risks: result.risks || [],
    suggestions: result.suggestions,
    storyFeedback: Array.isArray(result.storyFeedback)
      ? result.storyFeedback
      : undefined,
  };
}

/**
 * Run the critic via Claude CLI (lightweight — no tools, just reasoning).
 * Returns the raw text output.
 */
export function runCriticCli(
  claudePath: string,
  model: string,
  prompt: string,
  env: Record<string, string | undefined>,
  taskId?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      claudePath,
      [
        "--print",
        "--model",
        model,
        "--permission-mode",
        "bypassPermissions",
      ],
      {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    proc.stdin.write(prompt);
    proc.stdin.end();

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      // Stream critic reasoning to dashboard in real-time
      const lines = chunk.split("\n").filter((l: string) => l.trim());
      for (const line of lines) {
        const trimmed =
          line.trim().length > 200
            ? line.trim().substring(0, 200) + "…"
            : line.trim();
        if (trimmed) {
          if (taskId) {
            postLog(taskId, `${PREFIX} [critic] ${trimmed}`, "output");
          }
          console.log(
            `${ts()} ${chalk.dim("🔍")} ${chalk.dim(trimmed)}`,
          );
        }
      }
    });
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error("Critic CLI timed out after 20 minutes"));
    }, 1_200_000);

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(
          new Error(
            `Critic CLI failed (exit ${code}): ${stderr.substring(0, 300)}`,
          ),
        );
      } else {
        resolve(stdout);
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Format critic feedback for appending to the planner prompt on re-run.
 */
export function formatCriticFeedback(critic: CriticResult): string {
  const lines: string[] = [
    "",
    "## CRITIC FEEDBACK — Your previous plan was REJECTED",
    "",
    `Score: ${critic.score}/100 (need >= ${AUTO_APPROVAL_THRESHOLD} to pass)`,
    "",
  ];

  if (critic.risks.length > 0) {
    lines.push("### Risks Identified:");
    for (const risk of critic.risks) {
      lines.push(`- ${risk}`);
    }
    lines.push("");
  }

  if (critic.suggestions && critic.suggestions.length > 0) {
    lines.push("### Required Changes:");
    for (const suggestion of critic.suggestions) {
      lines.push(`- ${suggestion}`);
    }
    lines.push("");
  }

  if (critic.storyFeedback && critic.storyFeedback.length > 0) {
    lines.push("### Per-Story Feedback:");
    for (const fb of critic.storyFeedback) {
      lines.push(`- **${fb.storyId}**: ${fb.feedback}`);
      if (fb.suggestedChanges) {
        for (const change of fb.suggestedChanges) {
          lines.push(`  - ${change}`);
        }
      }
    }
    lines.push("");
  }

  lines.push(
    `**You MUST address ALL feedback above.** Each story must target at most ${MAX_TARGET_FILES} files.`,
    "Stories MUST NOT overlap on targetFiles.",
    "",
    "**CRITICAL — OUTPUT FORMAT:** You MUST output a revised plan as a ```json code block containing the full JSON object with `summary`, `stories`, `risks`, and `assumptions` fields. Do NOT just describe what you would change — output the COMPLETE revised JSON plan. If you do not output a ```json block, the plan will fail to parse and the task will fail.",
    "",
    "**DO NOT re-explore the repository.** You already explored it in the previous attempt. Go directly to outputting the revised ```json plan. Every tool call wastes output budget — prioritize emitting the JSON plan.",
  );

  return lines.join("\n");
}

/**
 * Format critic feedback as a refinement prompt for the planner.
 * Used when the critic APPROVED the plan (score >= threshold) but has
 * suggestions worth incorporating. Unlike rejection feedback, this is
 * collaborative — the planner should consider suggestions, not blindly apply them.
 */
export function formatRefinementFeedback(critic: CriticResult): string {
  const lines: string[] = [
    "",
    "## REVIEWER NOTES — Your plan was APPROVED, but the reviewer has suggestions",
    "",
    `Score: ${critic.score}/100 (approved)`,
    "",
    "The reviewer approved your plan but identified opportunities for improvement.",
    "Review each suggestion and incorporate the ones that genuinely improve the plan.",
    "You may reject suggestions that would reduce quality or don't apply.",
    "",
  ];

  if (critic.risks.length > 0) {
    lines.push("### Risks Identified:");
    for (const risk of critic.risks) {
      lines.push(`- ${risk}`);
    }
    lines.push("");
  }

  if (critic.suggestions && critic.suggestions.length > 0) {
    lines.push("### Suggested Improvements:");
    for (const suggestion of critic.suggestions) {
      lines.push(`- ${suggestion}`);
    }
    lines.push("");
  }

  if (critic.storyFeedback && critic.storyFeedback.length > 0) {
    lines.push("### Per-Story Notes:");
    for (const fb of critic.storyFeedback) {
      lines.push(`- **${fb.storyId}**: ${fb.feedback}`);
      if (fb.suggestedChanges) {
        for (const change of fb.suggestedChanges) {
          lines.push(`  - ${change}`);
        }
      }
    }
    lines.push("");
  }

  lines.push(
    `Each story must target at most ${MAX_TARGET_FILES} files. Stories MUST NOT overlap on targetFiles.`,
    "",
    "**CRITICAL — OUTPUT FORMAT:** Output the refined plan as a ```json code block with the COMPLETE JSON object (`summary`, `stories`, `risks`, `assumptions`). Do NOT describe changes — output the full JSON.",
    "",
    "**DO NOT re-explore the repository.** Go directly to outputting the refined ```json plan.",
  );

  return lines.join("\n");
}

/** Consistent prefix matching planner dashboard format */
const PREFIX = "[🗺️ planning_agent 🤖]";

/** Timestamp prefix for console logs */
function ts(): string {
  return chalk.dim(new Date().toLocaleTimeString());
}

/**
 * Post a log message to the cloud dashboard for real-time visibility.
 */
async function postLog(
  taskId: string,
  message: string,
  type: string = "system",
  severity: string = "info",
): Promise<void> {
  try {
    await api.post("/api/control-center/logs", {
      taskId,
      type,
      message,
      severity,
    });
  } catch {
    // Fire and forget — don't block critic on log failures
  }
}

/**
 * Run critic validation on a parsed plan.
 * Routes to Claude CLI (Anthropic) or HTTP API (other providers).
 * Returns the critic result, or null if critic fails (non-blocking).
 */
export async function runCriticValidation(
  claudePath: string,
  model: string,
  prd: string,
  plan: ExecutionPlan,
  env: Record<string, string | undefined>,
  taskLabel: string,
  provider?: AIProvider,
  providerApiKey?: string,
  taskId?: string,
): Promise<CriticResult | null> {
  const criticPrompt = buildCriticPrompt(prd, plan);
  if (!criticPrompt) {
    console.warn(
      `${ts()} ${taskLabel} ${chalk.yellow("⚠")} Critic config not available — skipping validation`,
    );
    return null;
  }
  const effectiveProvider = provider || "anthropic";

  console.log(
    `${ts()} ${taskLabel} ${chalk.dim(`Running critic validation (${effectiveProvider})...`)}`,
  );
  if (taskId) {
    postLog(taskId, `${PREFIX} Running critic validation (${effectiveProvider})...`);
  }

  try {
    let rawCriticOutput: string;

    if (effectiveProvider === "anthropic") {
      rawCriticOutput = await runCriticCli(claudePath, model, criticPrompt, env, taskId);
    } else {
      if (!providerApiKey) {
        throw new Error(`No API key for critic provider "${effectiveProvider}"`);
      }
      rawCriticOutput = await generateText(
        effectiveProvider,
        model,
        criticPrompt,
        providerApiKey,
        { maxTokens: 4096, temperature: 0.3, timeoutMs: 1_200_000 },
      );
    }

    const result = parseCriticResponse(rawCriticOutput);
    const statusIcon =
      result.score >= AUTO_APPROVAL_THRESHOLD
        ? chalk.green("✓")
        : chalk.red("✗");
    console.log(
      `${ts()} ${taskLabel} ${statusIcon} Critic score: ${result.score}/100 (threshold: ${AUTO_APPROVAL_THRESHOLD})`,
    );
    return result;
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(
      `${ts()} ${taskLabel} ${chalk.yellow("⚠")} Critic failed: ${errMsg.substring(0, 100)}`,
    );
    return null;
  }
}

export { AUTO_APPROVAL_THRESHOLD };
