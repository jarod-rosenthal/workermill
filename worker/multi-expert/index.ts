/**
 * Multi-Provider Coordinator Entry Point
 *
 * Multi-agent collaboration service using Vercel AI SDK.
 * Spawns multiple expert subagents that collaborate on a task,
 * each potentially using a different AI provider based on providerRouting.
 *
 * This is triggered when a task has the 'multi-expert' label and MULTI_EXPERT_MODE=true.
 */

import "dotenv/config";
import { spawn } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { access } from "fs/promises";
import axios, { AxiosInstance } from "axios";
import { CoordinationClient } from "./coordination-client.js";
import { JiraClient } from "./jira-client.js";
import { withRetry } from "../lib/dist/api-retry.js";
// AI SDK reviewer (all providers including Anthropic)
import { InlineReviewerAiSdk, type InlineReviewerConfig } from "./inline-reviewer.js";

/**
 * Provider routing configuration.
 */
interface ProviderRouting {
  [persona: string]: {
    provider: string;
    model: string;
  };
}

/**
 * Multi-Provider configuration from environment.
 */
interface MultiExpertConfig {
  parentTaskId: string;
  apiBaseUrl: string;
  orgApiKey: string;
  anthropicApiKey: string;
  githubToken: string;
  githubReviewerToken?: string;
  targetRepo: string;
  model?: string;
  managerModel?: string;  // Manager model - used as default for experts when no routing
  jiraIssueKey?: string;
  providerRouting?: ProviderRouting;
  googleApiKey?: string;
  openaiApiKey?: string;
  ollamaHost?: string;
  skipManagerReview?: boolean;
}

/**
 * Story from coordination feed.
 */
interface Story {
  id: string;
  parentTaskId: string;
  storyIndex: number;
  persona: string;
  title: string;
  description: string;
  dependencies: number[];
  jiraIssueKey?: string;
}

// Persona emojis for visibility (matches Epic format)
const PERSONA_EMOJIS: Record<string, string> = {
  frontend_developer: "🎨",
  backend_developer: "⚙️",
  devops_engineer: "🔧",
  security_engineer: "🔒",
  qa_engineer: "🧪",
  tech_writer: "📝",
  project_manager: "📋",
  api_developer: "🔌",
  database_administrator: "🗄️",
  ml_engineer: "🧠",
  data_engineer: "📊",
  mobile_developer_ios: "📱",
  mobile_developer_android: "🤖",
  tech_lead: "👨‍💼",
};

// Provider icons for log visibility (consistent with Settings.tsx and ai-sdk-executor.js)
const PROVIDER_ICONS: Record<string, string> = {
  anthropic: "🤖",
  openai: "🔷",
  google: "🔵",
  gemini: "🔵",
  ollama: "🏠",
};

/**
 * Load configuration from environment variables.
 */
function loadConfig(): MultiExpertConfig {
  const required = [
    "PARENT_TASK_ID",
    "API_BASE_URL",
    "ORG_API_KEY",
    "ANTHROPIC_API_KEY",
    "GITHUB_TOKEN",
    "TARGET_REPO",
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error("Missing required environment variables: " + missing.join(", "));
  }

  // Parse provider routing from JSON environment variable
  let providerRouting: ProviderRouting | undefined = undefined;
  if (process.env.PROVIDER_ROUTING) {
    try {
      providerRouting = JSON.parse(process.env.PROVIDER_ROUTING);
    } catch {
      console.warn("[Multi-Provider] Failed to parse PROVIDER_ROUTING, ignoring");
    }
  }

  return {
    parentTaskId: process.env.PARENT_TASK_ID!,
    apiBaseUrl: process.env.API_BASE_URL!,
    orgApiKey: process.env.ORG_API_KEY!,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
    githubToken: process.env.GITHUB_TOKEN!,
    githubReviewerToken: process.env.GITHUB_REVIEWER_TOKEN,
    targetRepo: process.env.TARGET_REPO!,
    model: process.env.WORKER_MODEL || process.env.MODEL,  // Worker model for story execution
    managerModel: process.env.MANAGER_MODEL,  // Manager model - used as default for experts when no routing
    jiraIssueKey: process.env.JIRA_ISSUE_KEY || process.env.TICKET_KEY || "",
    providerRouting,
    googleApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    ollamaHost: process.env.OLLAMA_HOST,
    skipManagerReview: process.env.SKIP_MANAGER_REVIEW === "true",
  };
}

// Default models per provider
const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o",
  google: "gemini-2.0-flash",
  gemini: "gemini-2.0-flash",
  ollama: "qwen2.5-coder:32b",
};

/**
 * Infer provider from model name.
 */
function inferProviderFromModel(model: string): string {
  const modelLower = model.toLowerCase();
  if (modelLower.includes("claude") || modelLower.includes("anthropic")) {
    return "anthropic";
  }
  if (modelLower.includes("gpt") || modelLower.includes("o1") || modelLower.includes("o3")) {
    return "openai";
  }
  if (modelLower.includes("gemini")) {
    return "google";
  }
  if (modelLower.includes("qwen") || modelLower.includes("deepseek") || modelLower.includes("llama") || modelLower.includes("codestral")) {
    return "ollama";
  }
  // Default to anthropic if can't infer
  return "anthropic";
}

/**
 * Get provider and model for a persona from routing or defaults.
 * Fallback priority: providerRouting > managerModel > workerModel > Anthropic default
 */
function getProviderForPersona(
  persona: string,
  config: MultiExpertConfig
): { provider: string; model: string } {
  // 1. Check explicit per-persona routing
  const routing = config.providerRouting?.[persona];
  if (routing) {
    return { provider: routing.provider, model: routing.model };
  }
  // 2. Inherit from manager model (gemini-2.5-pro, etc.)
  if (config.managerModel) {
    const provider = inferProviderFromModel(config.managerModel);
    return { provider, model: config.managerModel };
  }
  // 3. Use task's workerModel
  if (config.model) {
    const provider = inferProviderFromModel(config.model);
    return { provider, model: config.model };
  }
  // 4. Fall back to Anthropic default
  return {
    provider: "anthropic",
    model: PROVIDER_DEFAULT_MODELS.anthropic,
  };
}

/**
 * Get log prefix for visibility (matches Epic format).
 * Format: [🧪 qa_engineer 🔵] for persona + provider visibility
 */
function getLogPrefix(persona: string, provider?: string): string {
  const emoji = PERSONA_EMOJIS[persona] || "🤖";
  const providerIcon = provider ? (PROVIDER_ICONS[provider] || "🤖") : "";
  return provider ? `[${emoji} ${persona} ${providerIcon}]` : `[${emoji} ${persona}]`;
}

/**
 * Check if CLAUDE.md exists in the repository.
 */
async function hasClaudeMd(repoPath: string): Promise<boolean> {
  try {
    await access(`${repoPath}/CLAUDE.md`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build instructions for generating CLAUDE.md if it doesn't exist.
 */
function buildClaudeMdInstructions(): string {
  return `***REMOVED******REMOVED*** 🚀 IMPORTANT: Generate CLAUDE.md First

This repository does not have a CLAUDE.md file. Before starting your main task, you MUST:

1. **Analyze the codebase structure** - Look at the project's directories, package.json/pyproject.toml, README.md, and key source files
2. **Create a CLAUDE.md file** in the repository root with:
   - Project overview and purpose
   - Build/run commands (how to install, test, build, deploy)
   - Code architecture overview
   - Key files and their purposes
   - Any important patterns or conventions used
   - Environment setup requirements

3. **Commit the CLAUDE.md** with message: "chore: Add CLAUDE.md for AI assistant context"

This file helps AI assistants (including yourself) understand the codebase better.

**Template structure:**
\`\`\`markdown
***REMOVED*** Project Name

Brief description of what this project does.

***REMOVED******REMOVED*** Quick Reference

| Task | Command |
|------|---------|
| Install | \`npm install\` |
| Run | \`npm run dev\` |
| Test | \`npm test\` |
| Build | \`npm run build\` |

***REMOVED******REMOVED*** Architecture

Describe the main components and how they interact.

***REMOVED******REMOVED*** Key Files

- \`src/index.ts\` - Main entry point
- \`src/routes/\` - API routes
- etc.

***REMOVED******REMOVED*** Important Patterns

Note any conventions, patterns, or gotchas that are important to understand.
\`\`\`

**After creating CLAUDE.md, proceed with your main task.**

---

`;
}

/**
 * Multi-Provider Coordinator
 */
/**
 * Token usage tracking for cost reporting.
 */
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

class MultiExpertCoordinator {
  private config: MultiExpertConfig;
  private api: AxiosInstance;
  private coordination: CoordinationClient;
  private jira: JiraClient;
  private repoPath: string = "/workspace/repo";
  private running: boolean = false;
  // Track completed stories locally during this run (don't rely on old context messages)
  private completedStoryIndices: Set<number> = new Set();
  // Track pending blocking consultations that need answers before proceeding
  // Key: consultation ID, Value: { id, targetPersona, question }
  private pendingBlockingConsultations: Map<string, { id: string; targetPersona: string; question: string }> = new Map();
  // Track cumulative token usage across all stories for cost reporting
  private tokenUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  // Track what's already been reported to avoid double-counting
  private reportedTokenUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  private lastPartialReportTime: number = 0;
  private static readonly PARTIAL_REPORT_INTERVAL = 30000; // 30 seconds

  // Inline review tracking (after all stories complete)
  private currentPrUrl: string | undefined;
  private currentPrNumber: number | undefined;
  private revisionCount: number = 0;
  private maxRevisions: number = 3;
  private lastReviewFeedback: string | undefined;

  constructor(config: MultiExpertConfig) {
    this.config = config;
    this.api = axios.create({
      baseURL: config.apiBaseUrl,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.orgApiKey,
      },
      timeout: 30000,
    });

    // Initialize coordination client for real-time communication
    this.coordination = new CoordinationClient({
      parentTaskId: config.parentTaskId,
      apiBaseUrl: config.apiBaseUrl,
      orgApiKey: config.orgApiKey,
    });

    // Initialize Jira client for ticket updates
    this.jira = new JiraClient(config.jiraIssueKey);
  }

  /**
   * Post a log message to the WorkerMill dashboard.
   * Adds prefix for coordinator messages. For executor output, use postRawLog().
   */
  private async postLog(message: string, persona?: string, provider?: string): Promise<void> {
    const prefix = persona ? getLogPrefix(persona, provider) : "[Multi-Provider]";
    console.log(`${prefix} ${message}`);

    try {
      await this.api.post("/api/control-center/logs", {
        taskId: this.config.parentTaskId,
        type: "output",
        message: `${prefix} ${message}`,
        severity: "info",
      });
    } catch {
      // Fire and forget
    }
  }

  /**
   * Post a log message with provider info for consistent formatting.
   */
  private async postLogWithProvider(message: string, persona: string, provider: string): Promise<void> {
    return this.postLog(message, persona, provider);
  }

  /**
   * Post raw log output (from executor) without adding prefix.
   * Executor already adds its own prefix.
   */
  private async postRawLog(message: string): Promise<void> {
    // Don't console.log here - stdout handler already logged it
    try {
      await this.api.post("/api/control-center/logs", {
        taskId: this.config.parentTaskId,
        type: "output",
        message,
        severity: "info",
      });
    } catch {
      // Fire and forget
    }
  }

  /**
   * Report partial token usage to the WorkerMill API.
   * Only reports the delta (tokens not yet reported) to avoid double-counting.
   * Uses additive mode since each story is a separate executor session.
   */
  private async reportPartialTokenUsage(): Promise<void> {
    // Calculate delta (only report new tokens since last report)
    const deltaInput = this.tokenUsage.inputTokens - this.reportedTokenUsage.inputTokens;
    const deltaOutput = this.tokenUsage.outputTokens - this.reportedTokenUsage.outputTokens;

    // Skip if no new tokens to report
    if (deltaInput === 0 && deltaOutput === 0) {
      return;
    }

    try {
      await this.api.post(`/api/tasks/${this.config.parentTaskId}/usage/partial`, {
        inputTokens: deltaInput,
        outputTokens: deltaOutput,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        // Use additive mode since we're reporting deltas
        mode: "add",
      });

      // Update reported totals
      this.reportedTokenUsage.inputTokens = this.tokenUsage.inputTokens;
      this.reportedTokenUsage.outputTokens = this.tokenUsage.outputTokens;

      console.log(`[Multi-Provider] Reported token usage delta: input=${deltaInput}, output=${deltaOutput} (cumulative: input=${this.tokenUsage.inputTokens}, output=${this.tokenUsage.outputTokens})`);
    } catch (err) {
      // Log but don't throw - token reporting is best-effort
      console.error("[Multi-Provider] Partial token report failed:", err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Parse token markers from executor output.
   * Returns true if tokens were extracted.
   */
  private parseTokenMarkers(line: string): boolean {
    let foundTokens = false;

    // Parse input tokens marker: ::input_tokens::123
    const inputMatch = line.match(/::input_tokens::(\d+)/);
    if (inputMatch) {
      const tokens = parseInt(inputMatch[1], 10);
      this.tokenUsage.inputTokens += tokens;
      foundTokens = true;
    }

    // Parse output tokens marker: ::output_tokens::456
    const outputMatch = line.match(/::output_tokens::(\d+)/);
    if (outputMatch) {
      const tokens = parseInt(outputMatch[1], 10);
      this.tokenUsage.outputTokens += tokens;
      foundTokens = true;
    }

    return foundTokens;
  }

  /**
   * Parse PR markers from executor output.
   * Detects ::pr_url:: and ::pr_number:: markers for inline review.
   */
  private parsePrMarkers(line: string): void {
    // Parse PR URL marker: ::pr_url::https://github.com/owner/repo/pull/123
    const prUrlMatch = line.match(/::pr_url::(.+)/);
    if (prUrlMatch) {
      this.currentPrUrl = prUrlMatch[1].trim();
      console.log(`[Multi-Provider] Detected PR URL: ${this.currentPrUrl}`);
    }

    // Parse PR number marker: ::pr_number::123
    const prNumberMatch = line.match(/::pr_number::(\d+)/);
    if (prNumberMatch) {
      this.currentPrNumber = parseInt(prNumberMatch[1], 10);
      console.log(`[Multi-Provider] Detected PR number: ${this.currentPrNumber}`);
    }

    // Also detect PR URL from gh pr create output or consolidated PR
    // Example: https://github.com/owner/repo/pull/123
    if (!this.currentPrUrl) {
      const ghPrMatch = line.match(/https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/(\d+)/);
      if (ghPrMatch) {
        this.currentPrUrl = ghPrMatch[0];
        this.currentPrNumber = parseInt(ghPrMatch[1], 10);
        console.log(`[Multi-Provider] Detected PR from output: ${this.currentPrUrl}`);
      }
    }
  }

  /**
   * Clone the target repository.
   */
  private async cloneRepo(): Promise<void> {
    await this.postLog(`Cloning repository: ${this.config.targetRepo}`);

    return new Promise((resolve, reject) => {
      const cloneUrl = `https://x-access-token:${this.config.githubToken}@github.com/${this.config.targetRepo}.git`;
      const child = spawn("git", ["clone", cloneUrl, this.repoPath], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Git clone failed with code ${code}`));
        }
      });

      child.on("error", reject);
    });
  }

  /**
   * Create a consolidated PR after all stories complete.
   * Pushes the branch and creates a PR using GitHub CLI.
   */
  private async createConsolidatedPR(): Promise<void> {
    if (!this.config.jiraIssueKey) {
      await this.postLog("No Jira issue key, skipping PR creation");
      return;
    }

    const branchName = `feature/${this.config.jiraIssueKey.toLowerCase()}`;
    await this.postLog(`Creating PR on branch: ${branchName}`);

    try {
      // Create and checkout branch
      const { execSync } = await import("child_process");

      // Check if we have any commits to push
      const status = execSync("git status --porcelain", { cwd: this.repoPath, encoding: "utf-8" });
      const hasUncommitted = status.trim().length > 0;

      if (hasUncommitted) {
        await this.postLog("Committing any remaining changes...");
        execSync("git add -A", { cwd: this.repoPath });
        execSync('git commit -m "feat: Complete multi-expert implementation" --allow-empty', { cwd: this.repoPath });
      }

      // Create branch if not already on it
      try {
        execSync(`git checkout -b ${branchName}`, { cwd: this.repoPath, encoding: "utf-8" });
      } catch {
        // Branch might already exist, try switching to it
        try {
          execSync(`git checkout ${branchName}`, { cwd: this.repoPath, encoding: "utf-8" });
        } catch {
          // Already on this branch, continue
        }
      }

      // Push branch to origin
      await this.postLog("Pushing branch to origin...");
      execSync(`git push -u origin ${branchName} --force`, { cwd: this.repoPath, encoding: "utf-8" });

      // Create PR using GitHub CLI
      const prTitle = `${this.config.jiraIssueKey}: Multi-Provider Implementation`;
      const prBody = `***REMOVED******REMOVED*** Summary\nImplementation completed by WorkerMill Multi-Provider mode.\n\nJira: ${this.config.jiraIssueKey}`;

      await this.postLog("Creating pull request...");
      const prOutput = execSync(
        `gh pr create --base main --head ${branchName} --title "${prTitle}" --body "${prBody}"`,
        { cwd: this.repoPath, encoding: "utf-8" }
      );

      // Extract PR URL from output
      const prUrlMatch = prOutput.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);
      if (prUrlMatch) {
        this.currentPrUrl = prUrlMatch[0];
        const prNumberMatch = this.currentPrUrl.match(/\/pull\/(\d+)/);
        if (prNumberMatch) {
          this.currentPrNumber = parseInt(prNumberMatch[1], 10);
        }
        await this.postLog(`PR created: ${this.currentPrUrl}`);
        console.log(`::pr_url::${this.currentPrUrl}`);
        if (this.currentPrNumber) {
          console.log(`::pr_number::${this.currentPrNumber}`);
        }
      } else {
        await this.postLog("PR created but could not extract URL from output");
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await this.postLog(`Failed to create PR: ${error}`);
      console.error("[Multi-Provider] PR creation error:", error);
    }
  }

  /**
   * Fetch stories from the parent task's execution plan.
   * Stories come from planJson.steps or executionPlanV2.steps.
   */
  private async fetchStories(): Promise<Story[]> {
    try {
      // Get the parent task to read execution plan
      console.log(`[Multi-Provider] Fetching task: ${this.config.parentTaskId}`);
      const taskResponse = await withRetry(
        () => this.api.get(`/api/tasks/${this.config.parentTaskId}`),
        { logger: (msg) => console.log(msg) }
      );
      const task = taskResponse.data;

      console.log(`[Multi-Provider] Task response keys: ${Object.keys(task || {}).join(", ")}`);
      console.log(`[Multi-Provider] Has executionPlanV2: ${!!task?.executionPlanV2}`);
      console.log(`[Multi-Provider] Has planJson: ${!!task?.planJson}`);

      // Get steps from execution plan
      const plan = task.executionPlanV2 || task.planJson;
      if (!plan?.steps || !Array.isArray(plan.steps)) {
        console.log("[Multi-Provider] No execution plan found in task");
        console.log(`[Multi-Provider] plan value: ${JSON.stringify(plan).slice(0, 200)}`);
        return [];
      }

      console.log(`[Multi-Provider] Plan has ${plan.steps.length} steps`);

      // Use local tracking of completed stories (during this run only)
      // Don't use coordination context - it may have stale completion messages from failed retries
      console.log(`[Multi-Provider] Completed story indices (this run): ${[...this.completedStoryIndices].join(", ") || "none"}`);

      // Transform plan steps into Story objects, filtering out completed ones
      const stories: Story[] = [];
      for (const step of plan.steps) {
        const storyIndex = step.index as number;

        // Skip already completed stories (in this run)
        if (this.completedStoryIndices.has(storyIndex)) {
          console.log(`[Multi-Provider] Skipping completed story ${storyIndex}`);
          continue;
        }

        stories.push({
          id: `story-${storyIndex}`, // Generate ID from index
          parentTaskId: this.config.parentTaskId,
          storyIndex,
          persona: step.persona || "backend_developer",
          title: step.title || `Story ${storyIndex}`,
          description: step.description || "",
          dependencies: step.dependencies || [],
          jiraIssueKey: this.config.jiraIssueKey,
        });
      }

      console.log(`[Multi-Provider] Found ${stories.length} pending stories from execution plan`);
      return stories;
    } catch (error) {
      console.error("[Multi-Provider] Failed to fetch stories:", error);
      return [];
    }
  }

  /**
   * Fetch ALL stories from the execution plan (without filtering completed ones).
   * Used for building the expert roster showing all team members.
   */
  private async fetchAllStories(): Promise<Story[]> {
    try {
      const taskResponse = await withRetry(
        () => this.api.get(`/api/tasks/${this.config.parentTaskId}`),
        { logger: (msg) => console.log(msg) }
      );
      const task = taskResponse.data;

      const plan = task.executionPlanV2 || task.planJson;
      if (!plan?.steps || !Array.isArray(plan.steps)) {
        return [];
      }

      // Return ALL stories without filtering (for roster display)
      return plan.steps.map((step: { index?: number; persona?: string; title?: string; description?: string; dependencies?: number[] }) => ({
        id: `story-${step.index}`,
        parentTaskId: this.config.parentTaskId,
        storyIndex: step.index as number,
        persona: step.persona || "backend_developer",
        title: step.title || `Story ${step.index}`,
        description: step.description || "",
        dependencies: step.dependencies || [],
        jiraIssueKey: this.config.jiraIssueKey,
      }));
    } catch (error) {
      console.error("[Multi-Provider] Failed to fetch all stories:", error);
      return [];
    }
  }

  /**
   * Claim a story for execution.
   * Since we process stories sequentially and track completion via coordination client,
   * claiming always succeeds (no external coordination needed).
   */
  private async claimStory(storyId: string, persona: string): Promise<boolean> {
    // Stories are processed sequentially, no race condition to worry about
    // Completion is tracked via coordination context messages
    return true;
  }

  /**
   * Detect and post decisions from executor output.
   * Pattern: DEC-xxx: description
   */
  private detectAndPostDecisions(line: string, story: Story): void {
    const decisionPattern = /DEC-(\d+|[A-Z]+):\s*(.+?)(?:$)/gi;
    const matches = line.matchAll(decisionPattern);

    for (const match of matches) {
      const decisionId = `DEC-${match[1]}`;
      const decisionContent = match[2].trim();

      if (decisionContent.length > 10) {
        // Post asynchronously, don't block
        this.coordination.postDecision(
          decisionId,
          decisionContent,
          story.persona,
          {
            storyIndex: story.storyIndex,
            rationale: `Story ${story.storyIndex}: ${story.title}`,
          }
        ).catch(() => {});
      }
    }
  }

  /**
   * Detect and post questions from executor output.
   * Pattern: Q-xxx: question text
   */
  private detectAndPostQuestions(line: string, story: Story): void {
    const questionPattern = /Q-(\d+|[A-Z]+):\s*(.+?)(?:$)/gi;
    const matches = line.matchAll(questionPattern);

    for (const match of matches) {
      const questionId = `Q-${match[1]}`;
      const questionContent = match[2].trim();

      // Questions should have a ? and be reasonably long
      if (questionContent.length > 10 && questionContent.includes("?")) {
        this.coordination.postQuestion(
          questionId,
          questionContent,
          story.persona,
          story.storyIndex
        ).catch(() => {});
      }
    }
  }

  /**
   * Detect and post targeted consultations from executor output.
   * Patterns:
   * - CONSULT-SECURITY: Is this auth approach secure?
   * - CONSULT-BACKEND-BLOCKING: What's the API endpoint format? (waits for answer)
   *
   * Blocking consultations are tracked and will be polled for answers after story execution.
   */
  private detectAndPostConsultations(line: string, story: Story): void {
    // Pattern: CONSULT-{PERSONA}[-BLOCKING]: question
    // Examples:
    // - CONSULT-SECURITY: Is bcrypt still recommended?
    // - CONSULT-BACKEND-BLOCKING: What's the database schema?
    const consultPattern = /CONSULT-([A-Z_]+)(-BLOCKING)?:\s*(.+?)(?:$)/gi;
    const matches = line.matchAll(consultPattern);

    for (const match of matches) {
      const targetPersonaRaw = match[1].toLowerCase();
      const isBlocking = match[2] !== undefined;
      const questionContent = match[3].trim();

      // Convert persona name format (e.g., SECURITY -> security_engineer)
      const targetPersona = this.normalizePersonaName(targetPersonaRaw);

      // Must have meaningful content
      if (questionContent.length < 10) {
        continue;
      }

      // Post consultation asynchronously
      this.coordination.postConsultation(
        targetPersona,
        questionContent,
        story.persona,
        story.storyIndex,
        isBlocking
      ).then((result) => {
        if (result && isBlocking) {
          // Track blocking consultation for later polling
          this.pendingBlockingConsultations.set(result.id, {
            id: result.id,
            targetPersona,
            question: questionContent,
          });

          this.postLog(
            `🔔 Blocking consultation sent to ${targetPersona}: "${questionContent.substring(0, 50)}..."`,
            story.persona
          ).catch(() => {});
        }
      }).catch(() => {});
    }
  }

  /**
   * Detect and post answers to sibling questions/consultations from executor output.
   * Patterns:
   * - ANSWER-BACKEND: Here's the API endpoint format...
   * - ANSWER-Q-001: The recommended approach is...
   * - RE: [backend_developer] Use JWT with RS256...
   *
   * This allows experts to naturally answer consultations directed at them.
   */
  private async detectAndPostAnswers(line: string, story: Story): Promise<void> {
    // Pattern 1: ANSWER-{PERSONA or Q-ID}: response
    // Examples:
    // - ANSWER-BACKEND: The API endpoint is /api/v1/users
    // - ANSWER-Q-001: Use bcrypt with cost factor 12
    const answerPattern = /ANSWER-([A-Z0-9_-]+):\s*(.+?)(?:$)/gi;
    const matches = line.matchAll(answerPattern);

    for (const match of matches) {
      const targetRef = match[1].toUpperCase();
      const answerContent = match[2].trim();

      if (answerContent.length < 10) {
        continue;
      }

      // Find the unanswered question/consultation this is responding to
      const unanswered = await this.coordination.getUnansweredQuestions();

      let targetQuestion: import("./coordination-client.js").ContextMessage | undefined;

      // Check if answering a specific question ID (Q-001)
      if (targetRef.startsWith("Q-")) {
        targetQuestion = unanswered.find(
          (q) => q.content.includes(targetRef) || (q.metadata?.questionId as string)?.includes(targetRef)
        );
      } else {
        // Check if answering a consultation from a specific persona
        const targetPersona = this.normalizePersonaName(targetRef);
        targetQuestion = unanswered.find(
          (q) =>
            q.messageType === "consultation" &&
            q.persona === targetPersona &&
            q.metadata?.targetPersona === story.persona
        );

        // Also check for questions from that persona
        if (!targetQuestion) {
          targetQuestion = unanswered.find(
            (q) => q.messageType === "question" && q.persona === targetPersona
          );
        }
      }

      if (targetQuestion) {
        const result = await this.coordination.answerQuestion(
          targetQuestion.id,
          answerContent,
          story.persona,
          this.config.parentTaskId
        );

        if (result) {
          await this.postLog(
            `💬 Answered ${targetQuestion.persona}'s question: "${answerContent.substring(0, 60)}..."`,
            story.persona
          );
        }
      }
    }

    // Pattern 2: RE: [persona] response (more natural reply format)
    // Example: RE: [backend_developer] Use RS256 for JWT signing
    const replyPattern = /RE:\s*\[([^\]]+)\]\s*(.+?)(?:$)/gi;
    const replyMatches = line.matchAll(replyPattern);

    for (const match of replyMatches) {
      const targetPersonaRaw = match[1];
      const answerContent = match[2].trim();

      if (answerContent.length < 10) {
        continue;
      }

      const targetPersona = this.normalizePersonaName(targetPersonaRaw);
      const unanswered = await this.coordination.getUnansweredQuestions();

      // Find most recent question/consultation from that persona targeting this expert
      const targetQuestion = unanswered.find(
        (q) =>
          q.persona === targetPersona &&
          (q.metadata?.targetPersona === story.persona || q.messageType === "question")
      );

      if (targetQuestion) {
        const result = await this.coordination.answerQuestion(
          targetQuestion.id,
          answerContent,
          story.persona,
          this.config.parentTaskId
        );

        if (result) {
          await this.postLog(
            `💬 Replied to ${targetPersona}: "${answerContent.substring(0, 60)}..."`,
            story.persona
          );
        }
      }
    }
  }

  /**
   * Normalize persona name variations to standard format.
   * Examples:
   * - SECURITY -> security_engineer
   * - BACKEND -> backend_developer
   * - FRONTEND -> frontend_developer
   */
  private normalizePersonaName(raw: string): string {
    const mappings: Record<string, string> = {
      security: "security_engineer",
      backend: "backend_developer",
      frontend: "frontend_developer",
      devops: "devops_engineer",
      qa: "qa_engineer",
      writer: "tech_writer",
      pm: "project_manager",
      manager: "project_manager",
      api: "api_developer",
      database: "database_administrator",
      dba: "database_administrator",
      ml: "ml_engineer",
      data: "data_engineer",
      ios: "mobile_developer_ios",
      android: "mobile_developer_android",
    };

    const normalized = raw.toLowerCase().replace(/_/g, "");
    return mappings[normalized] || raw.toLowerCase();
  }

  /**
   * Build enriched prompt with sibling context, expert roster, Q&A, and consultations.
   */
  private async buildPrompt(story: Story, allStories?: Story[]): Promise<string> {
    // Get constraints
    const constraints = await this.coordination.getConstraints();
    const constraintsText = constraints
      .map((c) => `- ${c.content}`)
      .join("\n");

    // Get sibling decisions
    const decisions = await this.coordination.getSiblingDecisions();
    const decisionsText = decisions
      .map((d) => `- [${d.persona}] ${d.content}`)
      .join("\n");

    // Get file changes from siblings
    const fileChanges = await this.coordination.getSiblingFileChanges();
    const fileChangesText = fileChanges
      .map((f) => {
        const filePath = (f.metadata?.filePath as string) || "";
        return `- [${f.persona}] ${f.messageType}: ${filePath}`;
      })
      .join("\n");

    // Build Expert Roster (Phase 4)
    const rosterText = this.buildExpertRoster(story, allStories);

    // Get recent Q&A history for context
    const recentQandA = await this.coordination.getRecentQandA(15);
    const qandAText = this.formatQandAHistory(recentQandA);

    // Get pending consultations targeting this expert
    const pendingConsultations = await this.coordination.getConsultationsForPersona(story.persona);
    const consultationsText = this.formatPendingConsultations(pendingConsultations);

    // Check if CLAUDE.md exists and build instructions if missing
    const claudeMdExists = await hasClaudeMd(this.repoPath);
    const claudeMdSection = claudeMdExists ? "" : buildClaudeMdInstructions();
    if (!claudeMdExists) {
      console.log(`[Multi-Provider] CLAUDE.md not found in ${this.repoPath} - will instruct agent to create one`);
      await this.postLog("CLAUDE.md not found - will instruct agent to create one", story.persona);
    }

    return `***REMOVED*** Story ${story.storyIndex}: ${story.title}
${claudeMdSection}
***REMOVED******REMOVED*** Description
${story.description}

***REMOVED******REMOVED*** Expert Team (for consultations)
${rosterText}

To consult an expert, output: CONSULT-{PERSONA}: Your question?
For blocking consultation (waits for answer): CONSULT-{PERSONA}-BLOCKING: Your question?

***REMOVED******REMOVED*** Constraints
${constraintsText || "None specified"}

***REMOVED******REMOVED*** Sibling Decisions
${decisionsText || "No decisions yet"}

***REMOVED******REMOVED*** Files Modified by Siblings
${fileChangesText || "No file changes yet"}

${qandAText ? `***REMOVED******REMOVED*** Recent Team Q&A\n${qandAText}\n` : ""}
${consultationsText ? `***REMOVED******REMOVED*** CONSULTATIONS AWAITING YOUR RESPONSE\n${consultationsText}\n\n**Please answer these questions as part of your work.**\n` : ""}
***REMOVED******REMOVED*** Your Task
Implement this story following the constraints and coordinating with sibling decisions.

***REMOVED******REMOVED******REMOVED*** CRITICAL: You MUST actually write code
This is an agentic environment. You have tools to create and edit files.
**DO NOT just describe what you would do - ACTUALLY DO IT by calling tools.**

***REMOVED******REMOVED******REMOVED*** Implementation Steps (execute ALL of these):
1. **EXPLORE**: Use glob to find relevant files, use read_file to understand them
2. **IMPLEMENT**: Use write_file to CREATE new files or edit_file to MODIFY existing ones
3. **VERIFY**: Use read_file to confirm your changes were applied correctly
4. **COMMIT**: Use bash to run: git add -A && git commit -m "feat: your message"

***REMOVED******REMOVED******REMOVED*** What constitutes completion:
- If you need to CREATE a file: you MUST call write_file with the content
- If you need to MODIFY a file: you MUST call edit_file with the changes
- After changes: you MUST commit with git
- Only output ::result:: markers AFTER you have made actual code changes

***REMOVED******REMOVED******REMOVED*** Communication:
- Post a decision for architectural choices: DEC-001: description
- Post a question if you need input: Q-001: question?
- Consult a specific expert: CONSULT-SECURITY: Is this approach secure?
- Blocking consultation (wait for answer): CONSULT-BACKEND-BLOCKING: What's the schema?
- Answer a sibling's question: ANSWER-BACKEND: Here's the endpoint format...
- Reply to a question ID: ANSWER-Q-001: Use bcrypt with cost 12
- Natural reply format: RE: [backend_developer] Use RS256 for JWT signing

***REMOVED******REMOVED******REMOVED*** Repository
The repository is cloned at: ${this.repoPath}

**START NOW: First, explore the codebase structure with glob and read_file, then implement your changes.**`;
  }

  /**
   * Build expert roster showing team members and their status.
   */
  private buildExpertRoster(currentStory: Story, allStories?: Story[]): string {
    if (!allStories || allStories.length === 0) {
      return `- ${currentStory.persona} (Story ${currentStory.storyIndex}): running ← you`;
    }

    const lines: string[] = [];
    const emoji = PERSONA_EMOJIS[currentStory.persona] || "🤖";

    for (const s of allStories) {
      const isCurrentStory = s.storyIndex === currentStory.storyIndex;
      const isCompleted = this.completedStoryIndices.has(s.storyIndex);
      const personaEmoji = PERSONA_EMOJIS[s.persona] || "🤖";

      let status: string;
      if (isCompleted) {
        status = "completed ✅";
      } else if (isCurrentStory) {
        status = "running ← you";
      } else {
        status = "pending";
      }

      lines.push(`- ${personaEmoji} ${s.persona} (Story ${s.storyIndex}): ${status}`);
    }

    return lines.join("\n");
  }

  /**
   * Format Q&A history for prompt inclusion.
   */
  private formatQandAHistory(messages: import("./coordination-client.js").ContextMessage[]): string {
    if (messages.length === 0) return "";

    const lines: string[] = [];

    for (const msg of messages) {
      const emoji = PERSONA_EMOJIS[msg.persona] || "🤖";

      if (msg.messageType === "question") {
        lines.push(`- [${emoji} ${msg.persona}] Q: ${msg.content}`);
      } else if (msg.messageType === "answer") {
        lines.push(`- [${emoji} ${msg.persona}] A: ${msg.content}`);
      } else if (msg.messageType === "consultation") {
        const target = msg.metadata?.targetPersona as string || "unknown";
        lines.push(`- [${emoji} ${msg.persona}] → ${target}: ${msg.content}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Format pending consultations that need this expert's response.
   */
  private formatPendingConsultations(consultations: import("./coordination-client.js").ContextMessage[]): string {
    if (consultations.length === 0) return "";

    const lines: string[] = [];

    for (const c of consultations) {
      const emoji = PERSONA_EMOJIS[c.persona] || "🤖";
      const blocking = c.metadata?.blocking ? " [BLOCKING]" : "";
      lines.push(`- [${emoji} ${c.persona}]${blocking} asks you: ${c.content}`);
    }

    return lines.join("\n");
  }

  /**
   * Execute a story using the AI SDK executor.
   * @param story - The story to execute
   * @param allStories - All stories for building the expert roster
   */
  private async executeStory(story: Story, allStories?: Story[]): Promise<{ success: boolean; error?: string }> {
    const { provider, model } = getProviderForPersona(story.persona, this.config);
    const prefix = getLogPrefix(story.persona, provider);
    const startTime = Date.now();

    await this.postLogWithProvider(`Starting Story ${story.storyIndex}: ${story.title}`, story.persona, provider);
    await this.postLogWithProvider(`Provider: ${provider} | Model: ${model}`, story.persona, provider);

    // Post progress to coordination feed (real-time visibility)
    await this.coordination.postProgress(
      `Starting Story ${story.storyIndex}: ${story.title}`,
      story.persona,
      story.storyIndex
    );

    // Post story start to Jira
    await this.jira.storyStarted(story.storyIndex, story.title, story.persona, provider, model);

    // Build enriched prompt with sibling context and expert roster
    const prompt = await this.buildPrompt(story, allStories);

    // Write prompt to temp file
    const promptFile = `/tmp/multi-expert-prompt-${Date.now()}.txt`;
    writeFileSync(promptFile, prompt);

    return new Promise((resolve) => {
      // Build environment with API keys
      // AGENT_WORKING_DIR tells the executor where to run file operations
      const env: Record<string, string> = {
        ...process.env as Record<string, string>,
        AGENT_WORKING_DIR: this.repoPath,
        AGENT_MAX_STEPS: "100",
        AGENT_VERBOSE: "false",  // Cleaner output
      };

      // Pass reviewer token for PR approvals (avoids self-approval restriction)
      if (this.config.githubReviewerToken) {
        env.GITHUB_REVIEWER_TOKEN = this.config.githubReviewerToken;
      }

      // Set provider-specific API key
      if (provider === "anthropic") {
        env.ANTHROPIC_API_KEY = this.config.anthropicApiKey;
      } else if (provider === "google" || provider === "gemini") {
        // AI SDK expects GOOGLE_GENERATIVE_AI_API_KEY
        env.GOOGLE_GENERATIVE_AI_API_KEY = this.config.googleApiKey || "";
        env.GOOGLE_API_KEY = this.config.googleApiKey || "";
      } else if (provider === "openai") {
        env.OPENAI_API_KEY = this.config.openaiApiKey || "";
      } else if (provider === "ollama") {
        env.OLLAMA_HOST = this.config.ollamaHost || "http://localhost:11434";
      }

      const args = [
        "/app/agents/ai-sdk-executor.js",
        "--provider", provider,
        "--model", model,
        "--persona", story.persona,
        "--prompt-file", promptFile,
      ];

      // Run from /app so node can find AI SDK in /app/node_modules
      // The AGENT_WORKING_DIR env var tells the executor where to run file operations
      const child = spawn("node", args, {
        cwd: "/app",
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      child.stdout.on("data", (data) => {
        const text = data.toString();
        for (const line of text.split("\n")) {
          if (line.trim()) {
            console.log(line);
            // Forward executor output to dashboard (no prefix - executor already added it)
            this.postRawLog(line).catch(() => {});

            // Parse token markers from executor output for cost reporting
            const hadTokens = this.parseTokenMarkers(line);

            // Parse PR markers for inline review
            this.parsePrMarkers(line);

            // Report partial tokens periodically (every 30 seconds)
            const now = Date.now();
            if (hadTokens && now - this.lastPartialReportTime >= MultiExpertCoordinator.PARTIAL_REPORT_INTERVAL) {
              this.lastPartialReportTime = now;
              this.reportPartialTokenUsage().catch(() => {});
            }

            // Detect and post decisions/questions/consultations/answers from executor output
            this.detectAndPostDecisions(line, story);
            this.detectAndPostQuestions(line, story);
            this.detectAndPostConsultations(line, story);
            this.detectAndPostAnswers(line, story).catch(() => {});
          }
        }
      });

      child.stderr.on("data", (data) => {
        const stderrText = data.toString().trim();
        if (stderrText) {
          // Only log actual errors, not warnings/info
          if (stderrText.includes("Error") || stderrText.includes("error:")) {
            console.error(`${prefix} ${stderrText}`);
            this.postLog(stderrText, story.persona).catch(() => {});
          }
        }
      });

      child.on("close", async (code) => {
        try {
          unlinkSync(promptFile);
        } catch {
          // Ignore cleanup errors
        }

        const success = code === 0;
        const error = success ? undefined : `AI SDK executor exited with code ${code}`;

        // Post completion to coordination feed
        if (success) {
          await this.coordination.postCompletion(
            story.storyIndex,
            story.title,
            story.persona,
            { filesModified: [] } // TODO: Extract from executor output
          );
          await this.jira.storyCompleted(story.storyIndex, story.title, story.persona);
        } else {
          await this.coordination.postBlocker(
            `Story ${story.storyIndex} failed: ${error}`,
            story.persona,
            story.storyIndex
          );
          await this.jira.storyFailed(story.storyIndex, story.title, story.persona, error || "Unknown error");
        }

        if (success) {
          resolve({ success: true });
        } else {
          resolve({ success: false, error });
        }
      });

      child.on("error", async (err) => {
        const error = `Failed to spawn AI SDK executor: ${err.message}`;
        await this.coordination.postBlocker(error, story.persona, story.storyIndex);
        await this.jira.storyFailed(story.storyIndex, story.title, story.persona, error);
        resolve({ success: false, error });
      });
    });
  }

  /**
   * Mark a story as completed by posting a completion context message.
   */
  private async completeStory(storyId: string, storyIndex: number, persona: string, success: boolean, error?: string): Promise<void> {
    try {
      const content = success
        ? `Story ${storyIndex} completed successfully`
        : `Story ${storyIndex} failed: ${error}`;

      await this.api.post("/api/coordination/context", {
        parentTaskId: this.config.parentTaskId,
        taskId: this.config.parentTaskId, // Use parent task ID since we don't have a separate task
        persona,
        messageType: "completion",
        content,
        metadata: {
          storyId,
          storyIndex,
          success,
          error: error || null,
          completedAt: new Date().toISOString(),
        },
      });
    } catch {
      console.error("[Multi-Provider] Failed to mark story as complete");
    }
  }

  /**
   * Start the coordinator.
   */
  async start(): Promise<void> {
    console.log("[Multi-Provider] Starting coordinator");
    console.log(`[Multi-Provider] Target: ${this.config.targetRepo}`);

    if (this.config.providerRouting) {
      const routingEntries = Object.entries(this.config.providerRouting);
      console.log(`[Multi-Provider] Provider routing: ${routingEntries.length} persona(s) configured`);
    }

    this.running = true;

    // Transition Jira ticket to In Progress
    await this.jira.transitionTo("In Progress");

    // Clone the repository
    await this.cloneRepo();
    await this.postLog("Repository cloned successfully");

    // Main execution loop
    let completedStories = 0;
    let failedStories = 0;
    let noProgressIterations = 0;
    const MAX_NO_PROGRESS_ITERATIONS = 10;

    // Fetch all stories once for roster building (before filtering)
    const allStoriesForRoster = await this.fetchAllStories();

    while (this.running) {
      // Fetch available (pending) stories
      const stories = await this.fetchStories();

      if (stories.length === 0) {
        await this.postLog("No more stories to execute");
        break;
      }

      // Use local tracking for dependency checking (not coordination API which may have stale data)
      // Filter to stories whose dependencies are all satisfied
      const readyStories = stories.filter((story) => {
        if (!story.dependencies || story.dependencies.length === 0) {
          return true; // No dependencies - ready to execute
        }
        // Check if all dependencies are completed (in this run)
        const depsResolved = story.dependencies.every((depIndex) => this.completedStoryIndices.has(depIndex));
        if (!depsResolved) {
          const pending = story.dependencies.filter((d) => !this.completedStoryIndices.has(d));
          console.log(`[Multi-Provider] Story ${story.storyIndex} blocked by dependencies: [${pending.join(", ")}]`);
        }
        return depsResolved;
      });

      if (readyStories.length === 0) {
        noProgressIterations++;
        if (noProgressIterations >= MAX_NO_PROGRESS_ITERATIONS) {
          await this.postLog(`No progress for ${MAX_NO_PROGRESS_ITERATIONS} iterations - possible circular dependency or all stories blocked`);
          break;
        }
        await this.postLog(`Waiting for dependencies to resolve (${stories.length} stories pending)...`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }

      // Reset no-progress counter since we have work to do
      noProgressIterations = 0;

      // Process one story at a time
      for (const story of readyStories) {
        if (!this.running) break;

        // Try to claim the story
        const claimed = await this.claimStory(story.id, story.persona);
        if (!claimed) {
          continue;
        }

        // Execute the story (pass all stories for roster display)
        const result = await this.executeStory(story, allStoriesForRoster);

        // Phase 5: Poll for answers to blocking consultations
        if (this.pendingBlockingConsultations.size > 0) {
          await this.postLog(
            `⏳ Waiting for ${this.pendingBlockingConsultations.size} blocking consultation answer(s)...`,
            story.persona
          );

          const questionIds = [...this.pendingBlockingConsultations.values()].map((c) => c.id);
          const answers = await this.coordination.pollForAnswers(
            questionIds,
            120000, // 2 minute timeout
            5000    // Poll every 5 seconds
          );

          // Log received answers
          for (const [qId, answer] of answers) {
            const consultation = [...this.pendingBlockingConsultations.values()].find((c) => c.id === qId);
            if (consultation) {
              await this.postLog(
                `✅ Received answer from ${answer.persona}: "${answer.content.substring(0, 100)}..."`,
                story.persona
              );
            }
          }

          // Log any unanswered consultations
          const unanswered = [...this.pendingBlockingConsultations.values()].filter(
            (c) => !answers.has(c.id)
          );
          if (unanswered.length > 0) {
            await this.postLog(
              `⚠️ ${unanswered.length} consultation(s) timed out without answer`,
              story.persona
            );
          }

          // Clear tracking
          this.pendingBlockingConsultations.clear();
        }

        // Mark as complete (both in coordination API and locally)
        await this.completeStory(story.id, story.storyIndex, story.persona, result.success, result.error);

        // Track locally so we don't re-fetch this story in the same run
        this.completedStoryIndices.add(story.storyIndex);

        if (result.success) {
          completedStories++;
          await this.postLog(`Story ${story.storyIndex} completed!`, story.persona);
        } else {
          failedStories++;
          await this.postLog(`Story ${story.storyIndex} failed: ${result.error}`, story.persona);
        }
      }

      // Small delay between iterations
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Report final status
    await this.postLog(`Execution complete: ${completedStories} succeeded, ${failedStories} failed`);

    // Report final token usage (captures tokens from all stories)
    console.log(`[Multi-Provider] Final token usage: input=${this.tokenUsage.inputTokens}, output=${this.tokenUsage.outputTokens}`);
    try {
      await this.reportPartialTokenUsage();
      console.log("[Multi-Provider] Token usage reported successfully");
    } catch (err) {
      console.error("[Multi-Provider] Failed to report final token usage:", err);
    }

    // Post final summary to Jira
    await this.jira.postFinalSummary(completedStories, failedStories);

    // Classify errors post-hoc before reporting final result
    // This marks all but the last error as "recoverable" for better UX
    const exitCode = failedStories > 0 ? 1 : 0;
    try {
      await this.api.post(
        `/api/control-center/logs/${this.config.parentTaskId}/classify-errors`,
        { exitCode }
      );
      console.log(`[Multi-Provider] Classified error logs (exitCode: ${exitCode})`);
    } catch (classifyErr) {
      // Non-fatal - log but continue
      console.warn("[Multi-Provider] Failed to classify errors:", classifyErr);
    }

    // If there were failures, skip review and output failed result
    if (failedStories > 0) {
      console.log("::result::failed");
      return;
    }

    // Create PR if stories completed successfully
    if (completedStories > 0 && !this.currentPrUrl) {
      await this.createConsolidatedPR();
    }

    // Run inline review if enabled and PR exists
    if (!this.config.skipManagerReview && this.currentPrUrl && this.currentPrNumber) {
      const reviewResult = await this.runInlineReview();

      // Output revision count for dashboard visibility
      if (this.revisionCount > 0) {
        console.log(`::revision_count::${this.revisionCount}`);
      }

      if (reviewResult === "approved") {
        console.log("::result::approved");
        if (this.currentPrUrl) {
          console.log(`::pr_url::${this.currentPrUrl}`);
        }
      } else if (reviewResult === "rejected") {
        console.log("::result::failed");
      } else {
        // revision_needed or review failed - request human review
        console.log("::result::review_requested");
        if (this.currentPrUrl) {
          console.log(`::pr_url::${this.currentPrUrl}`);
        }
      }
    } else {
      // No review configured or no PR - request human review
      console.log("::result::review_requested");
      if (this.currentPrUrl) {
        console.log(`::pr_url::${this.currentPrUrl}`);
      }
    }
  }

  /**
   * Run inline Tech Lead review.
   * Uses Agent SDK for Anthropic, AI SDK for other providers.
   * Returns the final review decision.
   */
  private async runInlineReview(): Promise<"approved" | "revision_needed" | "rejected"> {
    if (!this.currentPrUrl || !this.currentPrNumber) {
      await this.postLog("No PR detected, skipping inline review");
      return "revision_needed";
    }

    await this.postLog("Starting inline Tech Lead review phase");

    // Get provider for tech_lead from routing (or use default which is Anthropic)
    const { provider, model } = getProviderForPersona("tech_lead", this.config);
    await this.postLog(`Tech Lead review using ${provider}/${model}`);

    // Run review (with revision loop)
    // Multi-expert mode uses AI SDK for ALL providers (including Anthropic) for consistency
    while (this.revisionCount < this.maxRevisions) {
      const result = await this.runAiSdkReview(provider, model);

      if (!result.success) {
        await this.postLog(`Review failed: ${result.error}`, "tech_lead");
        return "revision_needed"; // Let human review handle it
      }

      await this.postLog(`Review decision: ${result.decision} (score: ${result.codeQualityScore})`, "tech_lead");

      if (result.decision === "approved") {
        await this.postLog("PR approved by Tech Lead!");
        await this.jira.addComment(`Tech Lead approved PR with score ${result.codeQualityScore}/10`);
        return "approved";
      }

      if (result.decision === "rejected") {
        await this.postLog("PR rejected by Tech Lead - fundamental issues detected");
        await this.jira.addComment(`Tech Lead rejected PR: ${result.feedback}`);
        return "rejected";
      }

      // revision_needed - track feedback for next attempt
      this.revisionCount++;
      this.lastReviewFeedback = result.feedback;
      await this.postLog(`Revision ${this.revisionCount}/${this.maxRevisions} needed: ${result.feedback}`);

      if (this.revisionCount >= this.maxRevisions) {
        await this.postLog("Max revisions reached, escalating to human review");
        return "revision_needed";
      }

      // TODO: In the future, we could trigger revision stories here
      // For now, we escalate to human review after max revisions
      await this.postLog("Revision requested - escalating to human review");
      return "revision_needed";
    }

    return "revision_needed";
  }

  /**
   * Run review using AI SDK (all providers including Anthropic).
   */
  private async runAiSdkReview(provider: string, model: string): Promise<{ success: boolean; decision: "approved" | "revision_needed" | "rejected"; feedback: string; codeQualityScore: number; error?: string }> {
    const reviewerConfig: InlineReviewerConfig = {
      parentTaskId: this.config.parentTaskId,
      apiBaseUrl: this.config.apiBaseUrl,
      orgApiKey: this.config.orgApiKey,
      githubToken: this.config.githubToken,
      githubReviewerToken: this.config.githubReviewerToken,
      jiraIssueKey: this.config.jiraIssueKey,
      provider,
      model,
      anthropicApiKey: this.config.anthropicApiKey,
      googleApiKey: this.config.googleApiKey,
      openaiApiKey: this.config.openaiApiKey,
      ollamaHost: this.config.ollamaHost,
    };

    const reviewer = new InlineReviewerAiSdk(reviewerConfig, this.repoPath);
    return await reviewer.review(
      this.currentPrUrl!,
      this.currentPrNumber!,
      this.revisionCount,
      this.lastReviewFeedback
    );
  }

  /**
   * Stop the coordinator.
   */
  stop(): void {
    this.running = false;
    console.log("[Multi-Provider] Stopping coordinator...");
  }
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  console.log("[Multi-Provider] Multi-Provider AI Collaboration Service");

  try {
    const config = loadConfig();
    const coordinator = new MultiExpertCoordinator(config);

    // Handle graceful shutdown
    const shutdown = () => {
      console.log("\n[Multi-Provider] Received shutdown signal");
      coordinator.stop();
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Start the coordinator
    await coordinator.start();

    console.log("[Multi-Provider] Session ended");
    process.exit(0);
  } catch (error) {
    console.error("[Multi-Provider] Fatal error:", error);
    process.exit(1);
  }
}

// Run
main();
