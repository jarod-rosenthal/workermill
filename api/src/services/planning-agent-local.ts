/**
 * @deprecated DEPRECATED: Use planning-agent.ts with ClaudeCliBackend (llm-backend.ts).
 * This file is preserved for rollback. Remove after 2 successful production deployments
 * using the unified path.
 *
 * Local Planning Agent Adapter
 *
 * Supports multiple providers for local development:
 * - Anthropic: Uses Claude CLI with OAuth (no API key needed)
 * - OpenAI, Google, Ollama: Uses AI SDK with API keys from env
 *
 * Configure via environment variables:
 * - PLANNING_PROVIDER: "anthropic" (default), "openai", "google", "ollama"
 * - PLANNING_MODEL: Model name (default: "sonnet" for Claude CLI, provider-specific otherwise)
 *
 * For non-Anthropic providers, set the appropriate API key:
 * - OPENAI_API_KEY, GOOGLE_API_KEY, OLLAMA_BASE_URL
 */

import { spawn } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOllama } from "ollama-ai-provider";
import { logger } from "../utils/logger.js";
import {
  validatePlan,
  autoFixForwardDependencies,
  autoFixPhaseOrdering,
} from "./planning-validation.js";
import {
  PlanningTheme,
  PlannedStoryV2,
  ThemeCategory,
  THEME_CATEGORY_ORDER,
} from "./planning-types.js";

/**
 * Refresh Claude OAuth token if expired or expiring soon.
 * Returns true if token is valid (either already valid or successfully refreshed).
 */
async function ensureValidOAuthToken(): Promise<boolean> {
  const credsPath = join(homedir(), ".claude", ".credentials.json");

  logger.info("Checking OAuth token validity", {
    credsPath,
    homedir: homedir(),
    currentEnvToken: process.env.CLAUDE_CODE_OAUTH_TOKEN?.slice(0, 20) + "...",
  });

  if (!existsSync(credsPath)) {
    logger.warn("Claude credentials file not found - run 'claude auth login'");
    return false;
  }

  try {
    const creds = JSON.parse(readFileSync(credsPath, "utf-8"));
    const oauth = creds.claudeAiOauth;

    if (!oauth?.accessToken || !oauth?.expiresAt) {
      logger.warn("Invalid Claude credentials format");
      return false;
    }

    const currentTime = Date.now();
    const thirtyMinutes = 30 * 60 * 1000;

    // Token still valid for more than 30 minutes — proactive refresh to prevent
    // expiry during long-running Docker containers that receive the token at spawn time
    if (currentTime < oauth.expiresAt - thirtyMinutes) {
      const hoursLeft = Math.floor((oauth.expiresAt - currentTime) / 3600000);
      logger.info("OAuth token valid", {
        hoursLeft,
        expiresAt: new Date(oauth.expiresAt).toISOString(),
        tokenPreview: oauth.accessToken?.slice(0, 20) + "...",
      });
      return true;
    }

    // Need to refresh
    logger.info("OAuth token expired or expiring soon, refreshing...");

    if (!oauth.refreshToken) {
      logger.error("No refresh token available - run 'claude auth login'");
      return false;
    }

    // Call Anthropic OAuth refresh endpoint
    const response = await fetch("https://console.anthropic.com/v1/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: oauth.refreshToken,
        client_id: "claude-code",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error("Failed to refresh OAuth token", { status: response.status, error });
      return false;
    }

    const data = await response.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (!data.access_token) {
      logger.error("No access token in refresh response");
      return false;
    }

    // Update credentials file
    const expiresIn = data.expires_in || 28800; // Default 8 hours
    const newExpiresAt = Date.now() + (expiresIn * 1000);
    creds.claudeAiOauth = {
      ...oauth,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || oauth.refreshToken,
      expiresAt: newExpiresAt,
    };

    writeFileSync(credsPath, JSON.stringify(creds), "utf-8");

    // Update the in-memory environment variable so Docker containers get the fresh token
    process.env.CLAUDE_CODE_OAUTH_TOKEN = data.access_token;

    logger.info("OAuth token refreshed successfully", {
      expiresInHours: Math.floor(expiresIn / 3600),
    });

    return true;
  } catch (err) {
    logger.error("Error checking/refreshing OAuth token", { error: err });
    return false;
  }
}

/**
 * Progress callback for milestone messages (written to database log).
 */
export type PlanningProgressCallback = (message: string) => void;

/**
 * Planning phase for real-time progress tracking (in-memory only, via SSE).
 */
export type PlanningPhase =
  | "initializing"
  | "reading_repo"
  | "analyzing"
  | "generating_plan"
  | "validating"
  | "complete";

/**
 * Real-time progress event emitted every few seconds during planning.
 */
export interface PlanningProgressDetail {
  phase: PlanningPhase;
  elapsedSeconds: number;
  detail: string;
  charsGenerated: number;
  toolCallCount: number;
}

/**
 * Callback for frequent progress updates (not persisted).
 */
export type PlanningProgressDetailCallback = (event: PlanningProgressDetail) => void;

/**
 * Token usage from the planning agent.
 */
export interface PlanningUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalCostUsd: number;
}

/**
 * Story interface for planning output.
 */
export interface PlannedStory {
  id: string;
  title: string;
  description: string;
  persona: string;
  priority: number;
  estimatedEffort: "small" | "medium" | "large";
  dependencies: string[];
  acceptanceCriteria: string[];
  targetFiles?: string[];
  scope?: string;
}

/**
 * Execution plan output from planning agent.
 */
export interface ExecutionPlan {
  summary: string;
  stories: PlannedStory[];
  risks: string[];
  assumptions: string[];
}

/**
 * Input for the planning agent.
 */
export interface PlanningInput {
  taskId: string;
  title: string;
  description: string;
  jiraIssueKey?: string;
  labels?: string[];
  attachments?: Array<{ filename: string; content: string }>;
  stackTemplate?: string;
  maxParallelExperts?: number;
  maxStories?: number;
}

/**
 * Get planning configuration from environment.
 */
function getPlanningConfig(): { provider: string; model: string } {
  const provider = process.env.PLANNING_PROVIDER || "anthropic";

  // Default models per provider
  const defaultModels: Record<string, string> = {
    anthropic: "sonnet",
    openai: "gpt-4o",
    google: "gemini-2.0-flash",
    ollama: "qwen2.5-coder:32b",
  };

  const model = process.env.PLANNING_MODEL || defaultModels[provider] || "";

  return { provider, model };
}

/**
 * Extended execution plan with V2 data for the coordinator.
 */
export interface ValidatedExecutionPlan extends ExecutionPlan {
  storiesV2: PlannedStoryV2[];
  mutexGroups: Record<string, number[]>;
  validationApplied: boolean;
  usage?: PlanningUsage;
}

/**
 * Run the planning agent locally.
 * Routes to Claude CLI for Anthropic, AI SDK for other providers.
 * Applies validation and auto-fixes to ensure proper dependency ordering.
 */
export async function runLocalPlanningAgent(
  input: PlanningInput,
  onProgress?: PlanningProgressCallback,
  onPlanningProgress?: PlanningProgressDetailCallback,
): Promise<ValidatedExecutionPlan> {
  const { provider, model } = getPlanningConfig();
  const prompt = buildPlanningPrompt(input);

  logger.info("Running local planning agent", {
    taskId: input.taskId,
    title: input.title,
    provider,
    model,
    promptLength: prompt.length,
  });

  // Get raw plan from LLM
  let rawPlan: ExecutionPlan;
  if (provider === "anthropic") {
    // Ensure OAuth token is valid before calling Claude CLI
    const tokenValid = await ensureValidOAuthToken();
    if (!tokenValid) {
      throw new Error("OAuth token invalid or expired. Run 'claude auth login' to re-authenticate.");
    }
    rawPlan = await runWithClaudeCli(input, prompt, model, onProgress, onPlanningProgress);
  } else {
    rawPlan = await runWithAiSdk(input, prompt, provider, model);
  }

  // Convert to V2 format for validation
  const { themes, stories, mutexGroups } = convertToV2Format(rawPlan);

  logger.info("Converted plan to V2 format", {
    taskId: input.taskId,
    storyCount: stories.length,
    themeCount: themes.length,
    mutexGroupCount: Object.keys(mutexGroups).length,
  });

  // Validate and auto-fix
  const validated = validateAndFixPlan(themes, stories, input.taskId);

  // Log dependency chain for debugging
  const depChain = validated.stories.map(s => ({
    index: s.index,
    title: s.title.substring(0, 30),
    deps: s.dependencies,
    phase: s.phase,
  }));
  logger.info("Validated story dependencies", {
    taskId: input.taskId,
    stories: depChain,
  });

  // Convert back to ExecutionPlan format with V2 data attached
  const finalPlan = convertBackToExecutionPlan(rawPlan, validated.stories, mutexGroups);

  // Propagate usage from the raw plan (set by runWithClaudeCli)
  const planWithUsage = rawPlan as ExecutionPlan & { usage?: PlanningUsage };

  return {
    ...finalPlan,
    validationApplied: true,
    usage: planWithUsage.usage,
  };
}

/**
 * Run planning with Claude CLI (Anthropic only).
 * Uses OAuth authentication from Claude CLI.
 */
async function runWithClaudeCli(
  input: PlanningInput,
  prompt: string,
  model: string,
  onProgress?: PlanningProgressCallback,
  onPlanningProgress?: PlanningProgressDetailCallback,
): Promise<ExecutionPlan & { usage?: PlanningUsage }> {
  const claudePath = process.env.CLAUDE_CLI_PATH || "/home/user/.local/bin/claude";

  logger.info("Using Claude CLI for planning", {
    taskId: input.taskId,
    model,
    claudePath,
  });

  return new Promise((resolve, reject) => {
    // Let Claude CLI manage its own auth via ~/.claude/.credentials.json
    // Do NOT pass CLAUDE_CODE_OAUTH_TOKEN — it bypasses CLI's built-in token refresh,
    // causing 401 errors when the access token expires mid-run.
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDE_CODE_OAUTH_TOKEN;

    // Use stream-json to get real-time streaming output instead of buffering everything
    // --verbose is required for stream-json with --print
    // --permission-mode bypassPermissions: planning agent runs non-interactively,
    //   needs to read files (docs, PRDs) and access GitHub without approval prompts
    const claude = spawn(
      claudePath,
      [
        "--print",
        "--verbose",
        "--output-format", "stream-json",
        "--model", model,
        "--permission-mode", "bypassPermissions",
        prompt,
      ],
      {
        env: cleanEnv,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let fullText = "";
    let stderr = "";
    let resultText = "";
    let charsReceived = 0;
    const startTime = Date.now();
    let usage: PlanningUsage | undefined;

    // Buffered text streaming — flush complete lines to dashboard every 1s.
    // LLM deltas are tiny fragments; we accumulate until we see '\n', then
    // a 1s interval flushes all complete lines via onProgress.
    let textBuffer = "";

    function flushTextBuffer(final = false): void {
      if (!textBuffer || !onProgress) return;
      const parts = textBuffer.split("\n");
      const incomplete = final ? "" : (parts.pop() || "");
      for (const line of parts) {
        if (line.trim()) {
          onProgress(line);
        }
      }
      textBuffer = incomplete;
    }

    // Phase detection state
    let currentPhase: PlanningPhase = "initializing";
    let toolCallCount = 0;
    let firstTextSeen = false;
    let milestoneSent = { started: false, reading: false, analyzing: false, generating: false };

    // Emit initial milestone
    onProgress?.("Planning agent started");
    milestoneSent.started = true;

    // Emit initial progress
    onPlanningProgress?.({
      phase: "initializing",
      elapsedSeconds: 0,
      detail: "Starting planning agent...",
      charsGenerated: 0,
      toolCallCount: 0,
    });

    // Time-based phase progression (Claude CLI --print doesn't stream intermediate events)
    function getTimeBasedPhase(elapsed: number): PlanningPhase {
      if (currentPhase === "validating" || currentPhase === "complete") return currentPhase;
      if (elapsed < 5) return "initializing";
      if (elapsed < 15) return "reading_repo";
      if (elapsed < 30) return "analyzing";
      return "generating_plan";
    }

    // Build a human-readable status line for the current phase
    function phaseStatusLine(phase: PlanningPhase, elapsed: number): string {
      switch (phase) {
        case "initializing": return "Starting planning agent...";
        case "reading_repo": return "Reading repository structure...";
        case "analyzing": return "Analyzing requirements...";
        case "generating_plan": return `Generating execution plan... (${elapsed}s)`;
        case "validating": return "Validating plan...";
        case "complete": return "Planning complete";
      }
    }

    // Flush buffered LLM text to dashboard every 1s (complete lines only)
    const textFlushInterval = setInterval(() => flushTextBuffer(), 1_000);

    // Progress emission timer — sends SSE updates every 2 seconds (never to database)
    const progressInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const phase = getTimeBasedPhase(elapsed);
      currentPhase = phase;
      onPlanningProgress?.({
        phase,
        elapsedSeconds: elapsed,
        detail: phaseStatusLine(phase, elapsed),
        charsGenerated: charsReceived,
        toolCallCount,
      });
    }, 2_000);

    // Phase-transition log — writes to DB (visible in terminal) on each phase change + every 90s during generating_plan.
    // This is the PRIMARY feedback mechanism since it uses the proven DB→SSE→terminal log path.
    let lastLoggedPhase: PlanningPhase | null = "initializing";
    let lastGeneratingLogAt = 0;
    const phaseLogInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const phase = getTimeBasedPhase(elapsed);
      // Log phase transitions
      if (phase !== lastLoggedPhase) {
        lastLoggedPhase = phase;
        onProgress?.(phaseStatusLine(phase, elapsed));
        if (phase === "generating_plan") lastGeneratingLogAt = elapsed;
      }
      // During generating_plan, log progress every 90s
      if (phase === "generating_plan" && elapsed - lastGeneratingLogAt >= 90) {
        lastGeneratingLogAt = elapsed;
        onProgress?.(`Still generating plan... (${elapsed}s elapsed)`);
      }
    }, 5_000);

    // Parse streaming JSON lines from Claude CLI
    let lineBuffer = "";

    claude.stdout.on("data", (data: Buffer) => {
      lineBuffer += data.toString();

      // Process complete lines
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || ""; // Keep incomplete last line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const event = JSON.parse(trimmed);

          // Extract text from stream events
          // Claude CLI stream-json emits events with type field
          if (event.type === "content_block_delta" && event.delta?.text) {
            fullText += event.delta.text;
            charsReceived += event.delta.text.length;
            textBuffer += event.delta.text;

            // Phase detection: first text after tool calls → analyzing
            if (!firstTextSeen) {
              firstTextSeen = true;
              if (toolCallCount > 0) {
                currentPhase = "analyzing";
                if (!milestoneSent.analyzing) {
                  onProgress?.("Analyzing requirements...");
                  milestoneSent.analyzing = true;
                }
              }
            }

            // Phase detection: substantial text → generating_plan
            if (charsReceived > 500 && currentPhase !== "generating_plan") {
              currentPhase = "generating_plan";
              if (!milestoneSent.generating) {
                onProgress?.("Generating execution plan...");
                milestoneSent.generating = true;
              }
            }
          } else if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
            // Phase detection: tool_use → reading_repo
            toolCallCount++;
            if (currentPhase === "initializing" || currentPhase === "reading_repo") {
              currentPhase = "reading_repo";
              if (!milestoneSent.reading) {
                onProgress?.("Reading repository...");
                milestoneSent.reading = true;
              }
            }
          } else if (event.type === "assistant" && event.message?.content) {
            // Alternative format: assistant message with content
            const text = typeof event.message.content === "string"
              ? event.message.content
              : "";
            if (text) {
              fullText += text;
              charsReceived += text.length;
            }
          } else if (event.type === "result" && event.result) {
            // Final result event contains the complete text and usage data
            resultText = typeof event.result === "string" ? event.result : "";
            // Parse token usage from result event
            if (event.usage || event.total_cost_usd !== undefined) {
              usage = {
                inputTokens: event.usage?.input_tokens || 0,
                outputTokens: event.usage?.output_tokens || 0,
                cacheCreationInputTokens: event.usage?.cache_creation_input_tokens || 0,
                cacheReadInputTokens: event.usage?.cache_read_input_tokens || 0,
                totalCostUsd: event.total_cost_usd || 0,
              };
            }
          }
        } catch {
          // Not valid JSON - might be raw text output, accumulate it
          fullText += trimmed + "\n";
          charsReceived += trimmed.length;
        }
      }
    });

    claude.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    claude.on("close", (code) => {
      clearInterval(progressInterval);
      clearInterval(phaseLogInterval);
      clearInterval(textFlushInterval);
      flushTextBuffer(true);

      // Emit validating phase
      currentPhase = "validating";
      const elapsedAtClose = Math.round((Date.now() - startTime) / 1000);
      onPlanningProgress?.({
        phase: "validating",
        elapsedSeconds: elapsedAtClose,
        detail: "Validating plan...",
        charsGenerated: charsReceived,
        toolCallCount,
      });

      // Process any remaining buffered line
      if (lineBuffer.trim()) {
        try {
          const event = JSON.parse(lineBuffer.trim());
          if (event.type === "result" && event.result) {
            resultText = typeof event.result === "string" ? event.result : "";
            if (event.usage || event.total_cost_usd !== undefined) {
              usage = {
                inputTokens: event.usage?.input_tokens || 0,
                outputTokens: event.usage?.output_tokens || 0,
                cacheCreationInputTokens: event.usage?.cache_creation_input_tokens || 0,
                cacheReadInputTokens: event.usage?.cache_read_input_tokens || 0,
                totalCostUsd: event.total_cost_usd || 0,
              };
            }
          }
        } catch {
          fullText += lineBuffer;
        }
      }

      if (code !== 0) {
        logger.error("Planning agent (Claude CLI) failed", {
          taskId: input.taskId,
          code,
          stderr: stderr.substring(0, 500),
          stdout: fullText.substring(0, 500),
        });
        reject(new Error(`Planning agent exited with code ${code}: ${stderr || fullText}`.substring(0, 300)));
        return;
      }

      // Prefer the result event text, fall back to accumulated text
      const outputText = resultText || fullText;
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      try {
        const plan = parseExecutionPlan(outputText);
        logger.info("Planning agent (Claude CLI) completed", {
          taskId: input.taskId,
          storyCount: plan.stories.length,
          durationSec: elapsed,
          charsGenerated: charsReceived,
          usage,
        });
        const costStr = usage ? ` ($${usage.totalCostUsd.toFixed(2)})` : "";
        onProgress?.(
          `Planning complete: ${plan.stories.length} stories generated in ${elapsed}s${costStr}`
        );
        onPlanningProgress?.({
          phase: "complete",
          elapsedSeconds: elapsed,
          detail: `Planning complete: ${plan.stories.length} stories${costStr}`,
          charsGenerated: charsReceived,
          toolCallCount,
        });
        resolve({ ...plan, usage });
      } catch (e) {
        logger.error("Failed to parse planning output", {
          taskId: input.taskId,
          error: e instanceof Error ? e.message : String(e),
          outputPreview: outputText.substring(0, 500),
        });
        reject(e);
      }
    });

    claude.on("error", (err) => {
      clearInterval(progressInterval);
      clearInterval(textFlushInterval);
      flushTextBuffer(true);

      logger.error("Planning agent process error", {
        taskId: input.taskId,
        error: err.message,
      });
      reject(err);
    });
  });
}

/**
 * Run planning with AI SDK (OpenAI, Google, Ollama).
 */
async function runWithAiSdk(
  input: PlanningInput,
  prompt: string,
  provider: string,
  modelName: string
): Promise<ExecutionPlan> {
  logger.info("Using AI SDK for planning", {
    taskId: input.taskId,
    provider,
    model: modelName,
  });

  // Create model based on provider
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let model: any;
  switch (provider) {
    case "openai": {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OPENAI_API_KEY not set");
      const client = createOpenAI({ apiKey });
      model = client(modelName);
      break;
    }
    case "google":
    case "gemini": {
      const apiKey = process.env.GOOGLE_API_KEY;
      if (!apiKey) throw new Error("GOOGLE_API_KEY not set");
      const client = createGoogleGenerativeAI({ apiKey });
      model = client(modelName);
      break;
    }
    case "ollama": {
      const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
      const ollama = createOllama({ baseURL: baseUrl });
      model = ollama(modelName);
      break;
    }
    default:
      throw new Error(`Unknown provider: ${provider}. Supported: anthropic, openai, google, ollama`);
  }

  try {
    const response = await generateText({
      model,
      prompt,
      maxOutputTokens: 8192,
    });

    const plan = parseExecutionPlan(response.text);
    logger.info("Planning agent (AI SDK) completed", {
      taskId: input.taskId,
      provider,
      storyCount: plan.stories.length,
      tokensUsed: response.usage?.totalTokens,
    });
    return plan;
  } catch (e) {
    logger.error("Planning agent (AI SDK) failed", {
      taskId: input.taskId,
      provider,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

/**
 * Build the planning prompt from input.
 */
export function buildPlanningPrompt(input: PlanningInput): string {
  let prompt = `You are a technical planning agent. Your job is to analyze a task and break it down into executable stories.

## Task Details

**Title:** ${input.title}

**Description:**
${input.description}

${input.jiraIssueKey ? `**Jira Issue:** ${input.jiraIssueKey}` : ""}
${input.labels?.length ? `**Labels:** ${input.labels.join(", ")}` : ""}

`;

  if (input.stackTemplate) {
    prompt += `## Stack Template Constraint\nYou MUST use the **${input.stackTemplate}** technology stack. Design all stories around this stack.\n\n`;
  }

  if (input.attachments?.length) {
    prompt += "## Attachments\n\n";
    for (const att of input.attachments) {
      prompt += `### ${att.filename}\n\`\`\`\n${att.content}\n\`\`\`\n\n`;
    }
  }

  prompt += `## Instructions

Analyze this task and create an execution plan with stories.

For each story:
1. Assign a unique ID (e.g., "story-1", "story-2")
2. Write a clear title
3. Write a detailed description of what needs to be done
4. Assign a persona: frontend_developer, backend_developer, devops_engineer, qa_engineer, security_engineer, or tech_writer
5. Set priority (1 = highest)
6. Estimate effort: small (< 1 hour), medium (1-4 hours), large (4+ hours)
7. List dependencies (IDs of stories that must complete first)
8. Write acceptance criteria
9. List target files that will be created or modified

## Response Format

Respond with a JSON object in this exact format:

\`\`\`json
{
  "summary": "Brief summary of the overall plan",
  "stories": [
    {
      "id": "story-1",
      "title": "Set up project foundation",
      "description": "Initialize project structure and core dependencies",
      "persona": "backend_developer",
      "priority": 1,
      "estimatedEffort": "small",
      "dependencies": [],
      "acceptanceCriteria": ["Project structure created", "Dependencies installed"],
      "targetFiles": ["package.json", "tsconfig.json", "src/index.ts"]
    },
    {
      "id": "story-2",
      "title": "Implement core feature",
      "description": "Build the main functionality on top of the foundation",
      "persona": "backend_developer",
      "priority": 2,
      "estimatedEffort": "medium",
      "dependencies": ["story-1"],
      "acceptanceCriteria": ["Feature implemented", "Unit tests pass"],
      "targetFiles": ["src/services/feature.ts", "src/services/feature.test.ts"]
    },
    {
      "id": "story-3",
      "title": "Add frontend integration",
      "description": "Connect the frontend to the backend API",
      "persona": "frontend_developer",
      "priority": 3,
      "estimatedEffort": "medium",
      "dependencies": ["story-2"],
      "acceptanceCriteria": ["UI connected to API", "User flows work"],
      "targetFiles": ["src/components/Feature.tsx", "src/hooks/useFeature.ts"]
    }
  ],
  "risks": ["Risk 1", "Risk 2"],
  "assumptions": ["Assumption 1"]
}
\`\`\`

Important:
- ALWAYS include dependencies - most stories depend on earlier stories
- Story 1 typically has no dependencies (foundation/setup)
- Later stories should reference IDs of stories they depend on
- Order stories by priority and dependencies
- Ensure no circular dependencies
- Be specific in acceptance criteria
- Identify real risks, not generic ones
${input.maxStories ? `- **TARGET: 3-${input.maxStories} stories (aim for ~${Math.round(input.maxStories * 0.7)}). Do NOT exceed ${input.maxStories} stories.** Each story should be meaningful work, not trivial tasks. Prefer fewer, well-scoped stories over many small ones.` : ""}
- Maximum ${input.maxParallelExperts ?? 4} experts run in parallel. Each unique persona occupies one expert slot. Design your dependency graph to maximize throughput within this limit — avoid using more unique personas than the parallel cap unless sequencing makes it efficient.
- Tasks requiring deployment, provisioning, or command execution (terraform apply, migrations, deploy scripts) should have separate stories with:
  - Clear commands to run in the acceptance criteria (e.g., "Run \`terraform apply\` in infrastructure/, verify exit code 0")
  - devops_engineer persona when infrastructure is involved
  - Writing code and deploying/running it should be separate stories — don't combine both in one story
`;

  return prompt;
}

/**
 * Parse execution plan from Claude output.
 */
export function parseExecutionPlan(output: string): ExecutionPlan {
  // Strategy 1: Find ```json ... ``` block using bracket-matching instead of regex.
  // The lazy regex ([\s\S]*?) fails when JSON string values contain ``` (e.g., code
  // blocks in story descriptions from PRDs with CI/CD YAML examples).
  const jsonFenceStart = output.indexOf("```json");
  if (jsonFenceStart !== -1) {
    const searchFrom = jsonFenceStart + 7;
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

  return null;
}

/**
 * Convert raw plan stories to V2 format with numeric indices.
 * Creates synthetic themes based on personas for validation.
 */
export function convertToV2Format(plan: ExecutionPlan): {
  themes: PlanningTheme[];
  stories: PlannedStoryV2[];
  mutexGroups: Record<string, number[]>;
} {
  // Build ID to index mapping
  const idToIndex = new Map<string, number>();
  plan.stories.forEach((story, index) => {
    idToIndex.set(story.id, index);
  });

  // Infer phase from persona
  function inferPhase(persona: string, index: number): ThemeCategory {
    if (index === 0) return "foundation";
    if (persona === "tech_writer") return "foundation";
    if (persona === "qa_engineer") return "testing";
    if (persona === "devops_engineer") return "integration";
    if (persona === "security_engineer") return "integration";
    return "core";
  }

  // Convert stories to V2 format
  const storiesV2: PlannedStoryV2[] = plan.stories.map((story, index) => {
    // Convert string dependency IDs to numeric indices
    const numericDeps = story.dependencies
      .map(depId => idToIndex.get(depId))
      .filter((idx): idx is number => idx !== undefined && idx < index);

    const phase = inferPhase(story.persona, index);

    return {
      index,
      title: story.title,
      persona: story.persona,
      scope: story.scope || story.description,
      acceptanceCriteria: story.acceptanceCriteria,
      dependencies: numericDeps,
      estimatedComplexity: story.estimatedEffort,
      storyPoints: story.estimatedEffort === "small" ? 1 : story.estimatedEffort === "medium" ? 2 : 3,
      targetFiles: story.targetFiles || [],
      themeId: `T-${story.persona}`,
      phase,
      canonicalOrder: index,
    };
  });

  // Create synthetic themes from unique personas
  const personaSet = new Set(plan.stories.map(s => s.persona));
  const themes: PlanningTheme[] = Array.from(personaSet).map(persona => {
    const storiesForPersona = storiesV2.filter(s => s.persona === persona);
    const phase = storiesForPersona[0]?.phase || "core";
    return {
      id: `T-${persona}`,
      name: `${persona.replace(/_/g, " ")} tasks`,
      category: phase,
      description: `Tasks assigned to ${persona}`,
      suggestedPersonas: [persona],
      estimatedStoryCount: storiesForPersona.length,
      dependencies: [],
    };
  });

  // Build mutex groups from target files
  // Stories touching the same files should not run in parallel
  const mutexGroups: Record<string, number[]> = {};
  storiesV2.forEach(story => {
    if (story.targetFiles && story.targetFiles.length > 0) {
      // Group by directory (first path component)
      const dirs = new Set<string>();
      story.targetFiles.forEach(file => {
        const parts = file.split("/");
        if (parts.length > 1) {
          dirs.add(`dir:${parts[0]}`);
        }
        // Also add specific file mutex for exact file matches
        dirs.add(`file:${file}`);
      });
      dirs.forEach(dir => {
        if (!mutexGroups[dir]) {
          mutexGroups[dir] = [];
        }
        mutexGroups[dir].push(story.index);
      });
    }
  });

  // Filter out mutex groups with only 1 story (no conflict possible)
  const filteredMutexGroups: Record<string, number[]> = {};
  Object.entries(mutexGroups).forEach(([key, indices]) => {
    if (indices.length > 1) {
      filteredMutexGroups[key] = indices;
    }
  });

  return { themes, stories: storiesV2, mutexGroups: filteredMutexGroups };
}

/**
 * Validate and auto-fix the execution plan.
 * Returns the fixed plan with proper ordering and dependencies.
 */
export function validateAndFixPlan(
  themes: PlanningTheme[],
  stories: PlannedStoryV2[],
  taskId: string
): { themes: PlanningTheme[]; stories: PlannedStoryV2[] } {
  // Run validation with auto-fix enabled
  const validationResult = validatePlan(themes, stories, true);

  if (validationResult.autoFixesApplied > 0) {
    logger.info("Auto-fixed planning issues", {
      taskId,
      fixesApplied: validationResult.autoFixesApplied,
      results: validationResult.results
        .filter(r => r.autoFixed)
        .map(r => r.ruleName),
    });
  }

  if (validationResult.criticalIssues.length > 0) {
    logger.warn("Plan has critical issues that could not be auto-fixed", {
      taskId,
      issues: validationResult.criticalIssues,
    });
  }

  // Return the potentially modified stories
  // Note: validatePlan modifies in place when auto-fixing
  return { themes, stories };
}

/**
 * Convert validated V2 plan back to ExecutionPlan format for compatibility.
 */
export function convertBackToExecutionPlan(
  originalPlan: ExecutionPlan,
  storiesV2: PlannedStoryV2[],
  mutexGroups: Record<string, number[]>
): ExecutionPlan & { storiesV2: PlannedStoryV2[]; mutexGroups: Record<string, number[]> } {
  // Sort by canonical order
  const sortedStories = [...storiesV2].sort((a, b) => a.canonicalOrder - b.canonicalOrder);

  // Convert back to original format but preserve V2 data
  const stories: PlannedStory[] = sortedStories.map((s, idx) => ({
    id: `story-${idx + 1}`,
    title: s.title,
    description: s.scope,
    persona: s.persona,
    priority: idx + 1,
    estimatedEffort: s.estimatedComplexity as "small" | "medium" | "large",
    dependencies: s.dependencies.map(d => `story-${d + 1}`),
    acceptanceCriteria: s.acceptanceCriteria,
    targetFiles: s.targetFiles,
    scope: s.scope,
  }));

  return {
    ...originalPlan,
    stories,
    storiesV2: sortedStories,
    mutexGroups,
  };
}

/**
 * Check if we should use local planning agent.
 * In local mode, we use Claude CLI which handles its own authentication.
 */
export function shouldUseLocalPlanning(): boolean {
  return process.env.EXECUTION_MODE === "local";
}
