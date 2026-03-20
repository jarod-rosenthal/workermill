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
import * as https from "https";
import axios, { AxiosInstance } from "axios";
import { createCoordinationApi } from "../lib/api-client.js";
import { getTicketLabel } from "../epic/types.js";
import { CoordinationClient } from "./coordination-client.js";
import { JiraClient } from "./jira-client.js";
import { withRetry } from "../lib/dist/api-retry.js";
// AI SDK reviewer (all providers including Anthropic)
import { InlineReviewerAiSdk, type InlineReviewerConfig } from "./inline-reviewer.js";
// Quality verification (shared with Epic mode - import from compiled dist)
import {
  runQualityVerification,
  postQualityMetrics,
  type QualityMetrics,
} from "../epic/quality-runner.js";
import type { EvaluateQualityResponse } from "../epic/decision-client.js";
import { createAIClient, type AIClient, type AIClientConfig } from "../epic/ai-client-types.js";
import { DecisionClient, createDecisionClient, type WorkerConfigResponse } from "../epic/decision-client.js";
// GitOps for worktree-based parallel execution (shared with Epic mode)
import { GitOps, type StoryBranchResult } from "../epic/git-ops.js";

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
  ticketSystem?: "jira" | "linear" | "github" | "internal";
  providerRouting?: ProviderRouting;
  googleApiKey?: string;
  openaiApiKey?: string;
  ollamaHost?: string;
  skipManagerReview?: boolean;
  /** If true, use unified AIClient interface instead of direct executor spawning */
  useUnifiedClient?: boolean;
  /** Override repo path (set by remote-bootstrap when repo is already cloned) */
  repoPath?: string;
  maxReviewRevisions: number;
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

// Persona and provider icons are loaded from the Decision API at runtime
// via getWorkerConfig() in the coordinator's start() method.

/**
 * Get basic expert configuration for a persona (for unified AIClient usage).
 */
function getExpertConfigForPersona(persona: string): { systemPrompt: string } | null {
  // Basic persona descriptions for system prompts
  const personaPrompts: Record<string, string> = {
    frontend_developer: "You are an expert frontend developer specializing in React, TypeScript, CSS, and modern web development.",
    backend_developer: "You are an expert backend developer specializing in APIs, databases, and server-side logic.",
    devops_engineer: "You are an expert DevOps engineer specializing in CI/CD, infrastructure, and deployment automation.",
    security_engineer: "You are an expert security engineer specializing in vulnerability assessment and secure coding practices.",
    qa_engineer: "You are an expert QA engineer specializing in testing strategies, test automation, and quality assurance.",
    tech_writer: "You are an expert technical writer specializing in documentation, API docs, and developer guides.",
    architect: "You are an Architect. You specialize in system decomposition, task planning, and architecture design.",
    data_ml_engineer: "You are a Data & ML Engineer. You specialize in data pipelines, ETL, machine learning, and MLOps.",
    mobile_developer: "You are a Mobile Developer. You specialize in iOS and Android native development.",
    tech_lead: "You are an expert tech lead specializing in code review, architecture decisions, and team coordination.",
  };

  const systemPrompt = personaPrompts[persona];
  return systemPrompt ? { systemPrompt } : null;
}

/**
 * Load configuration from environment variables.
 */
function loadConfig(): MultiExpertConfig {
  const required = [
    "PARENT_TASK_ID",
    "API_BASE_URL",
    "ORG_API_KEY",
    "GITHUB_TOKEN",
    "TARGET_REPO",
    "MAX_REVIEW_REVISIONS",
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
    githubToken: process.env.SCM_TOKEN || process.env.GITHUB_TOKEN!,
    githubReviewerToken: process.env.GITHUB_REVIEWER_TOKEN,
    targetRepo: process.env.TARGET_REPO!,
    model: process.env.WORKER_MODEL || process.env.MODEL,  // Worker model for story execution
    managerModel: process.env.MANAGER_MODEL,  // Manager model - used as default for experts when no routing
    jiraIssueKey: process.env.JIRA_ISSUE_KEY || process.env.TICKET_KEY || "",
    ticketSystem: (process.env.TICKET_SYSTEM as "jira" | "linear" | "github" | "internal") || "jira",
    providerRouting,
    googleApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    ollamaHost: process.env.OLLAMA_HOST,
    skipManagerReview: process.env.SKIP_MANAGER_REVIEW === "true",
    maxReviewRevisions: parseInt(process.env.MAX_REVIEW_REVISIONS || "0", 10),
  };
}

// Default models per provider removed — provider routing is now handled
// by the Decision API via routeProvider().

// inferProviderFromModel() removed — provider routing is now handled
// by the Decision API via routeProvider().

// getProviderForPersona() removed — provider routing is now handled
// by the Decision API via this.decisionClient.routeProvider().

// getLogPrefix() moved to class method on MultiExpertCoordinator
// to access instance-level icon maps loaded from Decision API.

/**
 * Build the correct Authorization header for Bitbucket API calls.
 *
 * Bitbucket API tokens require Basic auth with email:token.
 * Git clone uses x-bitbucket-api-token-auth:{token} — but REST API calls
 * MUST use the account email, not the git username.
 * App passwords were deprecated Sept 2025.
 */
function getBitbucketAuthHeader(token: string): string {
  const bitbucketEmail = process.env.BITBUCKET_EMAIL;

  if (!bitbucketEmail) {
    console.error("[Bitbucket] WARNING: BITBUCKET_EMAIL not set — Bitbucket REST API requires Basic auth with email:token.");
  }

  const credentials = Buffer.from(`${bitbucketEmail || ""}:${token}`).toString("base64");
  return `Basic ${credentials}`;
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

/**
 * Prior work context from existing branch/PR.
 * Used to inform AI agents about work done in previous retry attempts.
 */
interface PriorWorkContext {
  branchName: string;
  branchExists: boolean;
  commits: Array<{
    sha: string;
    message: string;
    filesChanged: number;
  }>;
  prNumber?: number;
  prUrl?: string;
  prState?: string;
  prReviewComments?: Array<{
    author: string;
    body: string;
    path?: string;
  }>;
}

export class MultiExpertCoordinator {
  private config: MultiExpertConfig;
  private api: AxiosInstance;
  private coordination: CoordinationClient;
  private jira: JiraClient;
  private repoPath: string;
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
  // Track per-story token usage (streaming mode emits cumulative tokens, not deltas)
  // Key: story index, Value: latest cumulative tokens for that story
  private storyTokenUsage: Map<number, TokenUsage> = new Map();
  private currentStoryIndex: number = -1;

  // Inline review tracking (after all stories complete)
  private currentPrUrl: string | undefined;
  private currentPrNumber: number | undefined;
  private revisionCount: number = 0;
  private maxRevisions: number;
  private lastReviewFeedback: string | undefined;
  // Jira requirements for tech_lead review (populated from task data)
  private jiraRequirements: string | undefined;
  // Task summary for PR title (populated from task data)
  private taskSummary: string | undefined;
  // User feedback from Talk to Worker (command polling)
  private userFeedback: string | null = null;
  // Quality metrics (captured before PR creation, same as Epic mode)
  private qualityMetrics: QualityMetrics | undefined;
  private qualityGateResult: EvaluateQualityResponse | undefined;
  // Prior work context from existing branch (for retry scenarios)
  private priorWorkContext: PriorWorkContext | undefined;
  // Directive cache for effectiveness tracking
  private directiveCache: Map<string, {
    readme: string | null;
    readmeMeta: { id: string; version: number } | null;
    common: Record<string, string>;
    commonMeta: Record<string, { id: string; version: number }>;
  } | null> = new Map();
  // Unified AIClient for feature-flagged execution (multi-provider)
  private aiClientCache: Map<string, AIClient> = new Map();
  // Decision client for API-driven routing and config
  private decisionClient: DecisionClient;
  // Persona/provider icons loaded from Decision API
  private personaIcons: Record<string, string> = {};
  private providerIcons: Record<string, string> = {};
  // GitOps for worktree-based parallel execution (initialized in start() when in remote mode)
  private gitOps: GitOps | null = null;
  // Expert state tracking for parallel execution (mirrors Epic coordinator pattern)
  private expertStates: Map<string, { persona: string; status: "idle" | "working" | "completed" | "blocked"; currentStoryIndex?: number }> = new Map();
  // Max parallel experts (from env or default)
  private maxParallelExperts: number = parseInt(process.env.MAX_PARALLEL_EXPERTS || "10", 10);
  // Server-side prompt templates (loaded from Decision API)
  private serverPromptTemplates?: import("../epic/decision-client.js").WorkerConfigResponse["promptTemplates"];
  // Track active worktrees for cleanup
  private activeWorktrees: Map<number, string> = new Map();

  /**
   * Get files modified by a story, using git diff against main.
   * Uses worktree path if available (parallel mode), otherwise main repo.
   */
  private async getStoryFilesModified(storyIndex: number): Promise<string[]> {
    if (!this.gitOps) return [];
    try {
      const worktreePath = this.activeWorktrees.get(storyIndex);
      const files = worktreePath
        ? await this.gitOps.getFilesChangedVsMainInWorktree(worktreePath)
        : await this.gitOps.getFilesChangedVsMain();
      const maxFiles = 100;
      return files.length > maxFiles
        ? [...files.slice(0, maxFiles), `... and ${files.length - maxFiles} more files`]
        : files;
    } catch {
      return [];
    }
  }
  // Track story branch names for consolidated PR
  private storyBranchNames: Map<number, string> = new Map();
  // Track failed story indices
  private failedStoryIndices: Set<number> = new Set();

  constructor(config: MultiExpertConfig) {
    this.config = config;
    this.maxRevisions = config.maxReviewRevisions;
    this.repoPath = config.repoPath || process.env.REPO_PATH || "/workspace/repo";
    this.api = createCoordinationApi(config);

    // Initialize coordination client for real-time communication
    this.coordination = new CoordinationClient({
      parentTaskId: config.parentTaskId,
      apiBaseUrl: config.apiBaseUrl,
      orgApiKey: config.orgApiKey,
    });

    // Initialize Jira client for ticket updates
    this.jira = new JiraClient(config.jiraIssueKey);

    // Initialize decision client for API-driven routing and config
    this.decisionClient = createDecisionClient({
      apiBaseUrl: config.apiBaseUrl,
      orgApiKey: config.orgApiKey,
      logger: (msg) => console.log(msg),
    });
  }

  /**
   * Get log prefix for visibility (matches Epic format).
   * Format: [emoji persona providerIcon] for persona + provider visibility
   */
  private getLogPrefix(persona: string, provider?: string): string {
    const emoji = this.personaIcons[persona] || "🤖";
    const providerIcon = provider ? (this.providerIcons[provider] || "🤖") : "";
    return provider ? `[${emoji}${persona}${providerIcon}]` : `[${emoji}${persona}]`;
  }

  /**
   * Get list of available providers based on configured API keys.
   */
  private getAvailableProviders(): string[] {
    const providers: string[] = ["anthropic"]; // always available
    if (this.config.openaiApiKey) providers.push("openai");
    if (this.config.googleApiKey) providers.push("google");
    if (this.config.ollamaHost) providers.push("ollama");
    return providers;
  }

  /**
   * Get executor spawn configuration for ai-sdk-executor subprocess.
   * Binary mode: re-invoke self with __WORKERMILL_MODE=ai-sdk-executor
   * Docker mode: use node directly with /app/agents/ai-sdk-executor.js
   */
  private getExecutorSpawnConfig(): { command: string; args: string[]; cwd: string } {
    if (process.env.__WORKERMILL_MODE) {
      // Binary mode — re-invoke the compiled binary
      return { command: process.execPath, args: [], cwd: process.cwd() };
    }
    // Docker mode — use node directly (existing behavior)
    return { command: "node", args: ["/app/agents/ai-sdk-executor.js"], cwd: "/app" };
  }

  /**
   * Get or create an AIClient for the specified provider.
   * Clients are cached to avoid recreating them for each story.
   */
  private getAIClient(provider: string): AIClient {
    // Check cache first
    let client = this.aiClientCache.get(provider);
    if (client) {
      return client;
    }

    // Create new client for this provider
    const aiProvider = provider as "anthropic" | "openai" | "google" | "gemini" | "ollama";
    const clientConfig: AIClientConfig = {
      provider: aiProvider,
      apiKeys: {
        anthropic: this.config.anthropicApiKey,
        openai: this.config.openaiApiKey,
        google: this.config.googleApiKey,
        ollamaHost: this.config.ollamaHost,
      },
      apiConfig: {
        baseUrl: this.config.apiBaseUrl,
        orgApiKey: this.config.orgApiKey,
      },
      // For non-Anthropic providers, use AI SDK (not Agent SDK)
      useAgentSdk: provider === "anthropic",
      githubToken: this.config.githubToken,
    };

    client = createAIClient(clientConfig);
    this.aiClientCache.set(provider, client);
    return client;
  }

  /**
   * Poll for pending commands from the dashboard (pause/resume/message).
   * Commands allow the user to interact with the worker in real-time.
   */
  private async pollForCommands(): Promise<void> {
    try {
      const response = await this.api.get(
        `/api/coordination/commands/${this.config.parentTaskId}/pending`
      );

      const commands = response.data?.commands || [];

      for (const cmd of commands) {
        console.log(`[Multi-Provider] Received command: ${cmd.type} - ${cmd.content || "(no content)"}`);

        if (cmd.type === "pause") {
          // Acknowledge pause and wait for resume
          await this.acknowledgeCommand(cmd.id);
          console.log("[Multi-Provider] Paused - waiting for resume...");
          await this.waitForResume();
        } else if (cmd.type === "message" || cmd.type === "resume") {
          // Store message as user feedback for next story
          if (cmd.content) {
            this.userFeedback = cmd.content;
            console.log(`[Multi-Provider] User feedback received: ${cmd.content}`);
          }
          await this.acknowledgeCommand(cmd.id);
        } else if (cmd.type === "question") {
          // Dashboard asking worker a question - log it
          console.log(`[Multi-Provider] Question from user: ${cmd.content}`);
          await this.acknowledgeCommand(cmd.id);
        }
      }
    } catch (error) {
      // Non-fatal - just log and continue
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return;
      }
      console.warn("[Multi-Provider] Command polling failed:", error instanceof Error ? error.message : error);
    }
  }

  /**
   * Acknowledge a command to mark it as received.
   */
  private async acknowledgeCommand(commandId: string): Promise<void> {
    try {
      await this.api.post(`/api/coordination/commands/${commandId}/acknowledge`, {});
    } catch (error) {
      console.warn("[Multi-Provider] Failed to acknowledge command:", error instanceof Error ? error.message : error);
    }
  }

  /**
   * Wait for a resume command from the dashboard.
   * Polls every 2 seconds until a resume is received.
   */
  private async waitForResume(): Promise<void> {
    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      try {
        const response = await this.api.get(
          `/api/coordination/commands/${this.config.parentTaskId}/pending`
        );

        const commands = response.data?.commands || [];
        const resumeCmd = commands.find((c: { type: string }) => c.type === "resume");

        if (resumeCmd) {
          if (resumeCmd.content) {
            this.userFeedback = resumeCmd.content;
            console.log(`[Multi-Provider] Resumed with feedback: ${resumeCmd.content}`);
          } else {
            console.log("[Multi-Provider] Resumed without feedback");
          }
          await this.acknowledgeCommand(resumeCmd.id);
          return;
        }

        // Also check for other commands while paused
        for (const cmd of commands) {
          if (cmd.type === "message") {
            this.userFeedback = cmd.content;
            console.log(`[Multi-Provider] Message while paused: ${cmd.content}`);
            await this.acknowledgeCommand(cmd.id);
          }
        }
      } catch (error) {
        console.warn("[Multi-Provider] Resume polling failed:", error instanceof Error ? error.message : error);
      }
    }
  }

  /**
   * Get and clear any pending user feedback.
   */
  getUserFeedback(): string | null {
    const feedback = this.userFeedback;
    this.userFeedback = null;
    return feedback;
  }

  /**
   * Post a log message to the WorkerMill dashboard.
   * Adds prefix for coordinator messages. For executor output, use postRawLog().
   */
  private async postLog(message: string, persona?: string, provider?: string): Promise<void> {
    const prefix = persona ? this.getLogPrefix(persona, provider) : "[Multi-Provider]";
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
   * Load directive content for a persona from the API.
   * Records directive usage for effectiveness tracking.
   */
  private async loadDirective(persona: string): Promise<string | null> {
    // Check cache first
    if (this.directiveCache.has(persona)) {
      const cached = this.directiveCache.get(persona);
      return cached?.readme || null;
    }

    try {
      // Fetch persona bundle from API
      const response = await this.api.get(`/api/personas/worker/${persona}/bundle`);
      const bundle = response.data;

      if (bundle?.directives?.readme || Object.keys(bundle?.directives?.common || {}).length > 0) {
        console.log(`[Multi-Provider] Loaded directive for ${persona} from API`);
        this.directiveCache.set(persona, bundle.directives);

        // Record directive usage for effectiveness tracking
        await this.recordDirectiveUsage(persona, bundle.directives);

        return bundle.directives.readme || null;
      }
    } catch (err) {
      console.warn(`[Multi-Provider] Failed to load directive for ${persona}:`, err);
    }

    // Cache null to avoid repeated API calls
    this.directiveCache.set(persona, null);
    return null;
  }

  /**
   * Record which directives were used for this task.
   * This data is used to track directive effectiveness over time.
   */
  private async recordDirectiveUsage(
    persona: string,
    directives: {
      readme?: string | null;
      readmeMeta?: { id: string; version: number } | null;
      common?: Record<string, string>;
      commonMeta?: Record<string, { id: string; version: number }>;
    }
  ): Promise<void> {
    try {
      const usageRecords: Array<{
        directiveId: string;
        version: number;
        type: "readme" | "common";
        filename?: string;
        personaSlug: string;
      }> = [];

      // Add readme directive if present
      if (directives.readmeMeta?.id) {
        usageRecords.push({
          directiveId: directives.readmeMeta.id,
          version: directives.readmeMeta.version,
          type: "readme",
          personaSlug: persona,
        });
      }

      // Add common directives if present
      if (directives.commonMeta) {
        for (const [filename, meta] of Object.entries(directives.commonMeta)) {
          if (meta?.id) {
            usageRecords.push({
              directiveId: meta.id,
              version: meta.version,
              type: "common",
              filename,
              personaSlug: persona,
            });
          }
        }
      }

      if (usageRecords.length > 0) {
        await this.api.post("/api/directives/usage", {
          taskId: this.config.parentTaskId,
          directives: usageRecords,
        });
        console.log(`[Multi-Provider] Recorded ${usageRecords.length} directive(s) usage for ${persona}`);
      }
    } catch (error) {
      // Don't fail the task if directive tracking fails
      console.warn(`[Multi-Provider] Failed to record directive usage: ${error}`);
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
   * Streaming mode: AI SDK executor emits CUMULATIVE tokens periodically (not deltas).
   * We track per-story tokens using MAX (latest cumulative value), then SUM across stories.
   * Returns true if tokens were extracted.
   */
  private parseTokenMarkers(line: string, storyIndex: number): boolean {
    let foundTokens = false;

    // Parse input tokens marker: ::input_tokens::123
    const inputMatch = line.match(/::input_tokens::(\d+)/);
    if (inputMatch) {
      const tokens = parseInt(inputMatch[1], 10);
      foundTokens = true;

      // Get or initialize this story's token usage
      if (!this.storyTokenUsage.has(storyIndex)) {
        this.storyTokenUsage.set(storyIndex, { inputTokens: 0, outputTokens: 0 });
      }
      const storyTokens = this.storyTokenUsage.get(storyIndex)!;

      // Use MAX for cumulative updates (streaming emits total, not delta)
      const previousInput = storyTokens.inputTokens;
      storyTokens.inputTokens = Math.max(storyTokens.inputTokens, tokens);

      // Update global total: add the delta from this story
      const inputDelta = storyTokens.inputTokens - previousInput;
      if (inputDelta > 0) {
        this.tokenUsage.inputTokens += inputDelta;
      }
    }

    // Parse output tokens marker: ::output_tokens::456
    const outputMatch = line.match(/::output_tokens::(\d+)/);
    if (outputMatch) {
      const tokens = parseInt(outputMatch[1], 10);
      foundTokens = true;

      // Get or initialize this story's token usage
      if (!this.storyTokenUsage.has(storyIndex)) {
        this.storyTokenUsage.set(storyIndex, { inputTokens: 0, outputTokens: 0 });
      }
      const storyTokens = this.storyTokenUsage.get(storyIndex)!;

      // Use MAX for cumulative updates (streaming emits total, not delta)
      const previousOutput = storyTokens.outputTokens;
      storyTokens.outputTokens = Math.max(storyTokens.outputTokens, tokens);

      // Update global total: add the delta from this story
      const outputDelta = storyTokens.outputTokens - previousOutput;
      if (outputDelta > 0) {
        this.tokenUsage.outputTokens += outputDelta;
      }
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
      // Build clone URL based on SCM provider
      const scmProvider = process.env.SCM_PROVIDER || "github";
      const bitbucketUsername = process.env.BITBUCKET_USERNAME || "x-bitbucket-api-token-auth";
      let cloneUrl: string;

      if (scmProvider === "bitbucket") {
        // Use the username from environment (set by orchestrator)
        // - API Token format: x-bitbucket-api-token-auth
        // - App Password format: actual username
        // - Repository Access Token: x-token-auth
        const encodedUsername = encodeURIComponent(bitbucketUsername);
        const encodedToken = encodeURIComponent(this.config.githubToken);
        cloneUrl = `https://${encodedUsername}:${encodedToken}@bitbucket.org/${this.config.targetRepo}.git`;
      } else if (scmProvider === "gitlab") {
        cloneUrl = `https://oauth2:${this.config.githubToken}@gitlab.com/${this.config.targetRepo}.git`;
      } else {
        cloneUrl = `https://x-access-token:${this.config.githubToken}@github.com/${this.config.targetRepo}.git`;
      }
      const child = spawn("git", ["clone", cloneUrl, this.repoPath], {
        stdio: ["pipe", "pipe", "pipe"],
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
   * Detect if an existing branch exists for this task and checkout if so.
   * This enables retry scenarios to continue from previous work.
   * Returns true if an existing branch was found and checked out.
   */
  private async detectAndCheckoutExistingBranch(): Promise<boolean> {
    if (!this.config.jiraIssueKey) {
      return false;
    }

    // Branch naming convention: ai/{JIRA_ISSUE_KEY} (lowercase)
    const branchName = `ai/${this.config.jiraIssueKey.toLowerCase()}`;

    await this.postLog(`Checking for existing branch: ${branchName}`);

    try {
      const { execSync } = await import("child_process");

      // Fetch all remote branches
      execSync("git fetch --all", { cwd: this.repoPath, stdio: "pipe" });

      // Check if remote branch exists
      const remoteBranches = execSync("git branch -r", { cwd: this.repoPath, encoding: "utf-8" });
      const branchExists = remoteBranches.includes(`origin/${branchName}`);

      if (!branchExists) {
        await this.postLog(`No existing branch found, starting fresh`);
        return false;
      }

      await this.postLog(`Found existing branch: ${branchName}`);

      // Checkout the existing branch
      execSync(`git checkout -b ${branchName} origin/${branchName}`, { cwd: this.repoPath, stdio: "pipe" });
      await this.postLog(`Checked out existing branch: ${branchName}`);

      // Get commit history and PR feedback
      const commits = await this.getCommitHistory(branchName);
      const prInfo = await this.getPrFeedback(branchName);

      // Build prior work context
      this.priorWorkContext = {
        branchName,
        branchExists: true,
        commits,
        prNumber: prInfo?.prNumber,
        prUrl: prInfo?.prUrl,
        prState: prInfo?.prState,
        prReviewComments: prInfo?.reviewComments,
      };

      // Log summary of prior work
      await this.postLog(`Prior work detected: ${commits.length} commits`);
      if (prInfo) {
        await this.postLog(`Existing PR #${prInfo.prNumber}: ${prInfo.prState}`);
        if (prInfo.reviewComments && prInfo.reviewComments.length > 0) {
          await this.postLog(`PR has ${prInfo.reviewComments.length} review comments`);
        }
      }

      return true;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.warn("[Multi-Provider] Failed to detect existing branch:", errMsg);
      return false;
    }
  }

  /**
   * Get commit history for a branch (commits not in main).
   */
  private async getCommitHistory(branchName: string): Promise<PriorWorkContext["commits"]> {
    try {
      const { execSync } = await import("child_process");

      // Get commits that are in this branch but not in main/master
      // Format: SHA|message|files_changed
      const mainBranch = this.detectMainBranch();
      const logOutput = execSync(
        `git log ${mainBranch}..${branchName} --pretty=format:"%H|%s" --shortstat`,
        { cwd: this.repoPath, encoding: "utf-8" }
      );

      const commits: PriorWorkContext["commits"] = [];
      const lines = logOutput.split("\n");

      let currentCommit: { sha: string; message: string; filesChanged: number } | null = null;

      for (const line of lines) {
        if (line.includes("|")) {
          // This is a commit line (SHA|message)
          if (currentCommit) {
            commits.push(currentCommit);
          }
          const [sha, message] = line.split("|");
          currentCommit = { sha: sha.trim(), message: message.trim(), filesChanged: 0 };
        } else if (line.includes("file") && currentCommit) {
          // This is a stat line (e.g., "3 files changed, 10 insertions(+), 5 deletions(-)")
          const filesMatch = line.match(/(\d+) files? changed/);
          if (filesMatch) {
            currentCommit.filesChanged = parseInt(filesMatch[1], 10);
          }
        }
      }

      // Don't forget the last commit
      if (currentCommit) {
        commits.push(currentCommit);
      }

      return commits;
    } catch (error) {
      console.warn("[Multi-Provider] Failed to get commit history:", error);
      return [];
    }
  }

  /**
   * Detect the main branch name (main or master).
   */
  private detectMainBranch(): string {
    try {
      const { execSync } = require("child_process");
      const branches = execSync("git branch -r", { cwd: this.repoPath, encoding: "utf-8" });

      if (branches.includes("origin/main")) {
        return "origin/main";
      }
      return "origin/master";
    } catch {
      return "origin/main"; // Default to main
    }
  }

  /**
   * Get PR feedback (review comments) for a branch.
   */
  private async getPrFeedback(branchName: string): Promise<{
    prNumber: number;
    prUrl: string;
    prState: string;
    reviewComments: PriorWorkContext["prReviewComments"];
  } | null> {
    try {
      const { execSync } = await import("child_process");

      // Use GitHub CLI to find PR for this branch
      const prListOutput = execSync(
        `gh pr list --head ${branchName} --json number,url,state,reviewDecision --limit 1`,
        { cwd: this.repoPath, encoding: "utf-8" }
      );

      const prs = JSON.parse(prListOutput);
      if (prs.length === 0) {
        return null;
      }

      const pr = prs[0];

      // Get review comments
      const reviewCommentsOutput = execSync(
        `gh pr view ${pr.number} --json reviews,comments --jq '.reviews[] | {author: .author.login, body: .body, state: .state}'`,
        { cwd: this.repoPath, encoding: "utf-8" }
      );

      // Also get inline review comments
      const inlineCommentsOutput = execSync(
        `gh api repos/{owner}/{repo}/pulls/${pr.number}/comments --jq '.[] | {author: .user.login, body: .body, path: .path}'`,
        { cwd: this.repoPath, encoding: "utf-8" }
      );

      const reviewComments: PriorWorkContext["prReviewComments"] = [];

      // Parse review comments (general PR reviews)
      if (reviewCommentsOutput.trim()) {
        for (const line of reviewCommentsOutput.trim().split("\n")) {
          try {
            const comment = JSON.parse(line);
            if (comment.body && comment.body.trim()) {
              reviewComments.push({
                author: comment.author,
                body: comment.body,
              });
            }
          } catch { /* skip malformed lines */ }
        }
      }

      // Parse inline comments
      if (inlineCommentsOutput.trim()) {
        for (const line of inlineCommentsOutput.trim().split("\n")) {
          try {
            const comment = JSON.parse(line);
            if (comment.body && comment.body.trim()) {
              reviewComments.push({
                author: comment.author,
                body: comment.body,
                path: comment.path,
              });
            }
          } catch { /* skip malformed lines */ }
        }
      }

      return {
        prNumber: pr.number,
        prUrl: pr.url,
        prState: pr.state,
        reviewComments,
      };
    } catch (error) {
      console.warn("[Multi-Provider] Failed to get PR feedback:", error);
      return null;
    }
  }

  /**
   * Create a consolidated PR after all stories complete.
   * Supports multiple SCM providers:
   * - GitHub: Uses gh CLI (default)
   * - Bitbucket: Uses Bitbucket REST API
   * If this is a retry with an existing PR, updates that PR instead.
   */
  private async createConsolidatedPR(): Promise<void> {
    if (!this.config.jiraIssueKey) {
      await this.postLog("No Jira issue key, skipping PR creation");
      return;
    }

    // In parallel mode (GitOps available), delegate to GitOps consolidated PR
    // which merges all story branches into one PR
    if (this.gitOps) {
      await this.createConsolidatedPRWithGitOps();
      return;
    }

    // Sequential mode (Docker) — existing single-branch PR creation
    // Use ai/ prefix for branch naming (consistent with detectAndCheckoutExistingBranch)
    const branchName = this.priorWorkContext?.branchName || `ai/${this.config.jiraIssueKey.toLowerCase()}`;

    // If we already have a PR from prior work context, use that
    if (this.priorWorkContext?.prUrl && this.priorWorkContext?.prNumber) {
      this.currentPrUrl = this.priorWorkContext.prUrl;
      this.currentPrNumber = this.priorWorkContext.prNumber;
      await this.postLog(`Using existing PR: ${this.currentPrUrl}`);
    }

    await this.postLog(`Pushing changes to branch: ${branchName}`);

    // Detect SCM provider
    const scmProvider = process.env.SCM_PROVIDER || "github";
    await this.postLog(`SCM Provider: ${scmProvider}`);

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

      // If we're not already on the branch (from prior work checkout), switch to it
      if (!this.priorWorkContext?.branchExists) {
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
      }

      // Push branch to origin
      await this.postLog("Pushing branch to origin...");
      execSync(`git push -u origin ${branchName} --force`, { cwd: this.repoPath, encoding: "utf-8" });

      // If PR already exists (from retry), just log and return
      if (this.currentPrUrl) {
        await this.postLog(`Updated existing PR: ${this.currentPrUrl}`);
        console.log(`::pr_url::${this.currentPrUrl}`);
        if (this.currentPrNumber) {
          console.log(`::pr_number::${this.currentPrNumber}`);
        }
        return;
      }

      // Create PR - use task summary if available
      const summaryForTitle = this.taskSummary || "Implementation";
      // Truncate to fit GitHub's 256 char limit (leave room for key prefix)
      const maxSummaryLength = 230;
      const truncatedSummary = summaryForTitle.length > maxSummaryLength
        ? summaryForTitle.substring(0, maxSummaryLength - 3) + "..."
        : summaryForTitle;
      const prTitle = `${this.config.jiraIssueKey}: ${truncatedSummary}`;

      // Build PR body with quality metrics (same format as Epic mode)
      let prBody = `## Summary\nImplementation completed by WorkerMill Multi-Provider mode.\n\n${getTicketLabel(this.config.ticketSystem)}: ${this.config.jiraIssueKey}`;

      // Add quality metrics section if available
      if (this.qualityMetrics) {
        const m = this.qualityMetrics;
        const grade = m.qualityScore >= 90 ? 'A' :
                      m.qualityScore >= 80 ? 'B' :
                      m.qualityScore >= 70 ? 'C' :
                      m.qualityScore >= 60 ? 'D' : 'F';

        prBody += `\n\n## Code Quality Metrics\n\n`;
        prBody += `| Metric | Score | Details |\n`;
        prBody += `|--------|-------|--------|\n`;
        prBody += `| **Overall** | ${m.qualityScore}/100 (${grade}) | - |\n`;
        prBody += `| TypeCheck | ${m.typecheckScore}/100 | ${m.typeErrors === 0 ? '✅ No errors' : `❌ ${m.typeErrors} errors`} |\n`;
        prBody += `| Lint | ${m.lintScore}/100 | ${m.lintErrors} errors, ${m.lintWarnings} warnings |\n`;
        prBody += `| Tests | ${m.testScore}/100 | ${m.testsPassed} passed, ${m.testsFailed} failed, ${m.testsSkipped} skipped |\n`;
        prBody += `| Security | ${m.securityScore}/100 | ${m.securityHigh} high, ${m.securityMedium} medium, ${m.securityLow} low |\n`;

        if (m.coverageLines > 0) {
          prBody += `| Coverage | ${m.coverageScore}/100 | ${m.coverageLines}% lines, ${m.coverageBranches}% branches |\n`;
        }

        // Add quality gate status if available
        if (this.qualityGateResult) {
          const gateStatus = this.qualityGateResult.pass ? '✅ Passed' : '❌ Failed';
          prBody += `\n**Quality Gate:** ${gateStatus}`;
        }
      }

      await this.postLog("Creating pull request...");

      if (scmProvider === "bitbucket") {
        // Bitbucket PR creation via REST API
        const bitbucketUsername = process.env.BITBUCKET_USERNAME;
        const scmToken = process.env.SCM_TOKEN || this.config.githubToken;

        if (!bitbucketUsername) {
          throw new Error("BITBUCKET_USERNAME is required for Bitbucket PR creation");
        }

        // Parse workspace/repo from targetRepo
        const [workspace, repoSlug] = this.config.targetRepo.split("/");
        if (!workspace || !repoSlug) {
          throw new Error(`Invalid repository format: ${this.config.targetRepo}. Expected "workspace/repo"`);
        }

        await this.postLog(`Creating Bitbucket PR: ${workspace}/${repoSlug}`);

        const prResult = await this.createBitbucketPR(
          workspace,
          repoSlug,
          prTitle,
          branchName,
          "main", // base branch
          prBody,
          bitbucketUsername,
          scmToken
        );

        this.currentPrUrl = prResult.prUrl;
        this.currentPrNumber = prResult.prNumber;

        await this.postLog(`PR created: ${this.currentPrUrl}`);
        console.log(`::pr_url::${this.currentPrUrl}`);
        await this.postLog(`::pr_url::${this.currentPrUrl}`);
        console.log(`::pr_number::${this.currentPrNumber}`);
        await this.postLog(`::pr_number::${this.currentPrNumber}`);
      } else {
        // GitHub PR creation via gh CLI (default, backwards compatible)
        const prBodyFile = `/tmp/pr-body-${Date.now()}.md`;
        writeFileSync(prBodyFile, prBody);

        let prOutput: string;
        try {
          prOutput = execSync(
            `gh pr create --base main --head ${branchName} --title "${prTitle}" --body-file "${prBodyFile}"`,
            { cwd: this.repoPath, encoding: "utf-8" }
          );
        } finally {
          // Clean up temp file
          try { unlinkSync(prBodyFile); } catch { /* ignore */ }
        }

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
          await this.postLog(`::pr_url::${this.currentPrUrl}`);
          if (this.currentPrNumber) {
            console.log(`::pr_number::${this.currentPrNumber}`);
            await this.postLog(`::pr_number::${this.currentPrNumber}`);
          }
        } else {
          await this.postLog("PR created but could not extract URL from output");
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await this.postLog(`Failed to create PR: ${error}`);
      console.error("[Multi-Provider] PR creation error:", error);
    }
  }

  /**
   * Create a consolidated PR using GitOps (parallel mode).
   * Delegates to GitOps.createConsolidatedPR() which merges all story branches.
   */
  private async createConsolidatedPRWithGitOps(): Promise<void> {
    if (!this.gitOps || !this.config.jiraIssueKey) return;

    try {
      // Build story completions for PR body
      const storyCompletions = [...this.completedStoryIndices].map((idx) => {
        const branchName = this.storyBranchNames.get(idx);
        return {
          storyIndex: idx,
          title: branchName || `Story ${idx}`,
          filesModified: [] as string[],
        };
      });

      const epicTitle = this.taskSummary || "Multi-Provider Implementation";

      const prUrl = await this.gitOps.createConsolidatedPR(
        this.config.jiraIssueKey,
        epicTitle,
        storyCompletions,
        this.qualityMetrics ? {
          qualityScore: this.qualityMetrics.qualityScore,
          qualityGrade: this.qualityMetrics.qualityScore >= 90 ? 'A' :
                        this.qualityMetrics.qualityScore >= 80 ? 'B' :
                        this.qualityMetrics.qualityScore >= 70 ? 'C' :
                        this.qualityMetrics.qualityScore >= 60 ? 'D' : 'F',
          lintErrors: this.qualityMetrics.lintErrors,
          lintWarnings: this.qualityMetrics.lintWarnings,
          typeErrors: this.qualityMetrics.typeErrors,
          testsPassed: this.qualityMetrics.testsPassed,
          testsFailed: this.qualityMetrics.testsFailed,
          securityHigh: this.qualityMetrics.securityHigh,
          securityMedium: this.qualityMetrics.securityMedium,
          securityLow: this.qualityMetrics.securityLow,
        } : undefined
      );

      if (prUrl) {
        this.currentPrUrl = prUrl;
        // Extract PR number from URL
        const prNumberMatch = prUrl.match(/\/pull\/(\d+)/) || prUrl.match(/\/pull-requests\/(\d+)/);
        if (prNumberMatch) {
          this.currentPrNumber = parseInt(prNumberMatch[1], 10);
        }
        await this.postLog(`Consolidated PR created: ${prUrl}`);
        console.log(`::pr_url::${prUrl}`);
        await this.postLog(`::pr_url::${prUrl}`);
        if (this.currentPrNumber) {
          console.log(`::pr_number::${this.currentPrNumber}`);
          await this.postLog(`::pr_number::${this.currentPrNumber}`);
        }
      } else {
        await this.postLog("Failed to create consolidated PR (no URL returned)");
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await this.postLog(`Failed to create consolidated PR: ${error}`);
      console.error("[Multi-Provider] Consolidated PR creation error:", error);
    }
  }

  /**
   * Create a PR using Bitbucket REST API
   */
  private async createBitbucketPR(
    workspace: string,
    repoSlug: string,
    title: string,
    sourceBranch: string,
    destBranch: string,
    description: string,
    username: string,
    token: string
  ): Promise<{ prUrl: string; prNumber: number }> {
    const apiUrl = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/pullrequests`;

    const body = JSON.stringify({
      title,
      source: {
        branch: {
          name: sourceBranch,
        },
      },
      destination: {
        branch: {
          name: destBranch,
        },
      },
      description,
      close_source_branch: false,
    });

    // Get the appropriate auth header based on credential type
    const authHeader = getBitbucketAuthHeader(token);

    return new Promise((resolve, reject) => {
      const url = new URL(apiUrl);
      const options: https.RequestOptions = {
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": authHeader,
          "Content-Length": Buffer.byteLength(body),
        },
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", async () => {
          if (res.statusCode === 201) {
            try {
              const pr = JSON.parse(data);
              resolve({
                prUrl: pr.links.html.href,
                prNumber: pr.id,
              });
            } catch (e) {
              reject(new Error(`Failed to parse Bitbucket response: ${data}`));
            }
          } else if (res.statusCode === 409) {
            // PR already exists - try to find it
            console.log("[Multi-Provider] Bitbucket returned 409, searching for existing PR...");
            try {
              const existingPr = await this.findExistingBitbucketPR(workspace, repoSlug, sourceBranch, username, token);
              if (existingPr) {
                resolve(existingPr);
              } else {
                reject(new Error(`Bitbucket returned conflict but no existing PR found: ${data}`));
              }
            } catch (searchErr) {
              reject(new Error(`Bitbucket PR conflict and search failed: ${data}`));
            }
          } else {
            reject(new Error(`Bitbucket API error ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on("error", (e) => reject(e));
      req.write(body);
      req.end();
    });
  }

  /**
   * Find existing Bitbucket PR for a branch
   */
  private async findExistingBitbucketPR(
    workspace: string,
    repoSlug: string,
    sourceBranch: string,
    username: string,
    token: string
  ): Promise<{ prUrl: string; prNumber: number } | null> {
    const apiUrl = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/pullrequests?q=source.branch.name="${sourceBranch}"&state=OPEN`;

    // Get the appropriate auth header based on credential type
    const authHeader = getBitbucketAuthHeader(token);

    return new Promise((resolve, reject) => {
      const url = new URL(apiUrl);
      const options: https.RequestOptions = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "GET",
        headers: {
          "Authorization": authHeader,
        },
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              const response = JSON.parse(data);
              if (response.values && response.values.length > 0) {
                const pr = response.values[0];
                resolve({
                  prUrl: pr.links.html.href,
                  prNumber: pr.id,
                });
              } else {
                resolve(null);
              }
            } catch (e) {
              reject(new Error(`Failed to parse Bitbucket search response: ${data}`));
            }
          } else {
            reject(new Error(`Bitbucket API search error ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on("error", (e) => reject(e));
      req.end();
    });
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

      // Extract Jira requirements from task for tech_lead review
      if (!this.jiraRequirements && (task.summary || task.description)) {
        const parts: string[] = [];
        if (task.summary) {
          parts.push(`**Summary:** ${task.summary}`);
          // Store summary for PR title
          this.taskSummary = task.summary;
        }
        if (task.description) {
          parts.push(`**Description:**\n${task.description}`);
        }
        this.jiraRequirements = parts.join("\n\n");
        console.log(`[Multi-Provider] Extracted Jira requirements (${this.jiraRequirements.length} chars)`);
      }

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

      if (questionContent.length > 10) {
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
            `🔔 Blocking consultation sent to ${targetPersona}: "${questionContent}"`,
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
            `💬 Answered ${targetQuestion.persona}'s question: "${answerContent}"`,
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
            `💬 Replied to ${targetPersona}: "${answerContent}"`,
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
      api: "backend_developer",
      database: "backend_developer",
      dba: "backend_developer",
      ml: "data_ml_engineer",
      data: "data_ml_engineer",
      ios: "mobile_developer",
      android: "mobile_developer",
      architect: "architect",
      mobile: "mobile_developer",
    };

    const normalized = raw.toLowerCase().replace(/_/g, "");
    return mappings[normalized] || raw.toLowerCase();
  }

  /**
   * Detect and post natural language progress updates from executor output.
   * Captures markdown headings, bold text, and action phrases to provide
   * visibility into what the worker is doing without requiring specific patterns.
   */
  private detectAndPostNaturalProgress(line: string, story: Story): void {
    // Skip short lines or tool output
    if (line.length < 15 || line.startsWith("{") || line.startsWith("[")) {
      return;
    }

    // Throttle: don't post more than one progress update per 10 seconds per story
    const throttleKey = `progress-${story.storyIndex}`;
    const lastPost = this.lastProgressPostTime?.get(throttleKey) || 0;
    const now = Date.now();
    if (now - lastPost < 10000) {
      return;
    }

    let progressContent: string | null = null;

    // Pattern 1: Markdown headings (## Analyzing or # Implementation)
    const headingMatch = line.match(/^#{1,3}\s+(.+?)$/);
    if (headingMatch && headingMatch[1].length > 5) {
      progressContent = headingMatch[1].trim();
    }

    // Pattern 2: Bold text at start (**Analyzing User Verification**)
    if (!progressContent) {
      const boldMatch = line.match(/^\*\*([^*]+)\*\*/);
      if (boldMatch && boldMatch[1].length > 5) {
        progressContent = boldMatch[1].trim();
      }
    }

    // Pattern 3: Action phrases (Now analyzing, Creating file, Implementing)
    if (!progressContent) {
      const actionPatterns = [
        /^(Now\s+\w+ing)\s+(.+)/i,
        /^(Analyzing|Implementing|Creating|Updating|Modifying|Reading|Checking|Testing|Verifying|Reviewing|Planning|Starting|Completing)\s+(.+)/i,
        /^(I('m| am| will))\s+(now\s+)?(analyze|implement|create|update|modify|read|check|test|verify|review|plan|start|complete)\s+(.+)/i,
        /^(Looking at|Found|Discovered|Identified|Need to)\s+(.+)/i,
      ];

      for (const pattern of actionPatterns) {
        const match = line.match(pattern);
        if (match) {
          // Reconstruct the meaningful part
          progressContent = line.trim();
          break;
        }
      }
    }

    // Pattern 4: Decision-like statements without DEC- prefix
    if (!progressContent) {
      const decisionPatterns = [
        /^(I('ll| will)?\s+)?(decided?|choosing?|will use|using|going with|opting for)\s+(.+)/i,
        /^(The best approach|The solution|I recommend|My approach)\s+(is|will be)\s+(.+)/i,
      ];

      for (const pattern of decisionPatterns) {
        const match = line.match(pattern);
        if (match) {
          // Post as a decision-like progress
          progressContent = `💡 ${line.trim()}`;
          break;
        }
      }
    }

    // If we found something worth posting, send it to coordination feed
    if (progressContent) {
      // Update throttle timestamp
      if (!this.lastProgressPostTime) {
        this.lastProgressPostTime = new Map();
      }
      this.lastProgressPostTime.set(throttleKey, now);

      // Post progress asynchronously
      this.coordination.postProgress(
        progressContent,
        story.persona,
        story.storyIndex
      ).catch(() => {});
    }
  }

  // Throttle map for natural progress detection
  private lastProgressPostTime?: Map<string, number>;

  /**
   * Build enriched prompt with sibling context, expert roster, Q&A, consultations, directive, and user feedback.
   */
  private async buildPrompt(story: Story, allStories?: Story[], userFeedback?: string, directiveContent?: string | null, repoPathOverride?: string): Promise<string> {
    // Use override for parallel worktree execution (avoids race on this.repoPath)
    const promptRepoPath = repoPathOverride || this.repoPath;

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

    // Build user feedback section (from Talk to Worker or Tech Lead revision)
    // Note: During revision loops, reviewResult.feedback is passed as userFeedback
    const isRevision = this.revisionCount > 0;
    const userFeedbackSection = userFeedback
      ? isRevision
        ? `## ⚠️ REVISION REQUIRED - Tech Lead Feedback
The previous implementation was reviewed and requires changes. Please address the following feedback:

${userFeedback}

**IMPORTANT: You MUST address ALL feedback items above, not just one.**
- Go through each issue mentioned in the feedback
- Fix every problem, not just the first one you see
- Do NOT submit until you have addressed every point raised
- If a feedback item is unclear, make a reasonable interpretation and fix it

**EFFICIENCY TIP: Focus on files mentioned in the feedback.**
- You already explored the codebase in your previous attempt
- Skip re-reading files unless they're directly relevant to the feedback
- Go straight to the files that need changes
- Use \`git diff\` to see what you changed previously

`
        : `## 💬 MESSAGE FROM USER
The user has sent you the following message/instructions:

${userFeedback}

**Please take this feedback into account in your implementation.**

`
      : "";

    // Build prior work section (for retry scenarios)
    const priorWorkSection = this.buildPriorWorkSection();

    // Build directive section (persona-specific guidance)
    const directiveSection = directiveContent
      ? `## 🎯 Role Guidelines (${story.persona})
${directiveContent}

`
      : "";

    return `# Story ${story.storyIndex}: ${story.title}

${userFeedbackSection}${priorWorkSection}## Description
${story.description}

${directiveSection}## Expert Team (for consultations)
${rosterText}

To consult an expert, output: CONSULT-{PERSONA}: Your question?
For blocking consultation (waits for answer): CONSULT-{PERSONA}-BLOCKING: Your question?

## Constraints
${constraintsText || "None specified"}

## Sibling Decisions
${decisionsText || "No decisions yet"}

## Files Modified by Siblings
${fileChangesText || "No file changes yet"}

${qandAText ? `## Recent Team Q&A\n${qandAText}\n` : ""}
${consultationsText ? `## CONSULTATIONS AWAITING YOUR RESPONSE\n${consultationsText}\n\n**Please answer these questions as part of your work.**\n` : ""}
## Your Task
Implement this story following the constraints and coordinating with sibling decisions.

### CRITICAL: You MUST actually write code
This is an agentic environment. You have tools to create and edit files.
**DO NOT just describe what you would do - ACTUALLY DO IT by calling tools.**

### Implementation Steps (execute ALL of these):
1. **EXPLORE**: Use glob to find relevant files, use read_file to understand them
2. **IMPLEMENT**: Use write_file to CREATE new files or edit_file to MODIFY existing ones
3. **VERIFY**: Use read_file to confirm your changes were applied correctly
4. **COMMIT**: Use bash to run: git add -A && git commit -m "feat: your message"

### What constitutes completion:
- If you need to CREATE a file: you MUST call write_file with the content
- If you need to MODIFY a file: you MUST call edit_file with the changes
- After changes: you MUST commit with git
- Only output ::result:: markers AFTER you have made actual code changes

### 🤝 Team Collaboration (IMPORTANT)
You are part of a team of experts working on stories sequentially. **Ask questions when you hit ambiguity** — don't guess or make silent decisions. Your teammates' answers appear in the coordination feed for future stories, and the team works better when experts communicate openly.

**When to ask (don't stay silent on these):**
- **Design ambiguity**: Multiple valid approaches and you're unsure which fits the team's direction
- **Missing context**: You need information about what a previous expert built or decided
- **Dependency concern**: Your work might conflict with another story's changes
- **Integration questions**: You need to know an API shape, component interface, or data format
- **Scope conflict**: The story mentions files that seem out of scope or already modified

**Communication formats:**
- Post a decision for architectural choices: DEC-001: description
- Ask a general question: Q-001: What format should the API response use?
- Consult a specific expert: CONSULT-SECURITY: Is this auth approach secure?
- Blocking consultation (waits for answer): CONSULT-BACKEND-BLOCKING: What's the DB schema for users?
- Answer a sibling's question: ANSWER-BACKEND: Here's the endpoint format...
- Reply to a question ID: ANSWER-Q-001: Use bcrypt with cost 12
- Natural reply format: RE: [backend_developer] Use RS256 for JWT signing

**DO NOT use curl or direct API calls to post coordination messages.** Just include these markers in your regular output — the system detects and routes them automatically.

### Repository & Working Directory
The repository is cloned at: **${promptRepoPath}**

**IMPORTANT: Always use absolute paths from the repository root.**
- Use absolute paths like \`${promptRepoPath}/src/file.ts\` for read_file/write_file
- Avoid \`cd\` commands - they can cause you to lose track of the working directory
- If you must use \`cd\`, always return with \`cd ${promptRepoPath}\` afterward
- For bash commands, prefix with the full path: \`ls ${promptRepoPath}/src\`

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
    const emoji = this.personaIcons[currentStory.persona] || "🤖";

    for (const s of allStories) {
      const isCurrentStory = s.storyIndex === currentStory.storyIndex;
      const isCompleted = this.completedStoryIndices.has(s.storyIndex);
      const personaEmoji = this.personaIcons[s.persona] || "🤖";

      let status: string;
      if (isCompleted) {
        status = "completed ✅";
      } else if (isCurrentStory) {
        status = "running ← you";
      } else {
        status = "pending";
      }

      lines.push(`- ${personaEmoji}${s.persona} (Story ${s.storyIndex}): ${status}`);
    }

    return lines.join("\n");
  }

  /**
   * Build prior work section for retry scenarios.
   * Shows AI agents what work was done in previous attempts so they can continue from there.
   */
  private buildPriorWorkSection(): string {
    if (!this.priorWorkContext || !this.priorWorkContext.branchExists) {
      return "";
    }

    const ctx = this.priorWorkContext;
    const lines: string[] = [];

    lines.push(`## 🔄 PRIOR WORK CONTEXT (RETRY SCENARIO)`);
    lines.push(``);
    lines.push(`**IMPORTANT:** This is a RETRY. Previous work exists on branch \`${ctx.branchName}\`.`);
    lines.push(`Do NOT start from scratch. Review what's already done and CONTINUE from there.`);
    lines.push(``);

    // Show commits
    if (ctx.commits.length > 0) {
      lines.push(`### Previous Commits (${ctx.commits.length} total)`);
      for (const commit of ctx.commits.slice(0, 10)) { // Limit to 10 most recent
        lines.push(`- \`${commit.sha.substring(0, 7)}\` ${commit.message} (${commit.filesChanged} files)`);
      }
      if (ctx.commits.length > 10) {
        lines.push(`- ... and ${ctx.commits.length - 10} more commits`);
      }
      lines.push(``);
    }

    // Show PR info and review feedback
    if (ctx.prUrl) {
      lines.push(`### Existing Pull Request`);
      lines.push(`- PR: ${ctx.prUrl}`);
      lines.push(`- Status: ${ctx.prState || "unknown"}`);
      lines.push(``);

      if (ctx.prReviewComments && ctx.prReviewComments.length > 0) {
        lines.push(`### Review Feedback (CRITICAL - Address These)`);
        lines.push(`The following feedback was given on the previous attempt. **You MUST address these issues:**`);
        lines.push(``);
        for (const comment of ctx.prReviewComments) {
          if (comment.path) {
            lines.push(`- **${comment.author}** on \`${comment.path}\`:`);
          } else {
            lines.push(`- **${comment.author}**:`);
          }
          lines.push(`  > ${comment.body.replace(/\n/g, "\n  > ")}`);
          lines.push(``);
        }
      }
    }

    lines.push(`### Your Instructions for This Retry`);
    lines.push(`1. **Review existing code** - Check what's already implemented on this branch`);
    lines.push(`2. **Check git log** - See what commits were made: \`git log --oneline -10\``);
    lines.push(`3. **Address feedback** - If there are review comments above, fix those issues first`);
    lines.push(`4. **Continue work** - Only implement what's missing or broken`);
    lines.push(`5. **Commit incrementally** - Make small, focused commits`);
    lines.push(``);

    return lines.join("\n") + "\n";
  }

  /**
   * Format Q&A history for prompt inclusion.
   */
  private formatQandAHistory(messages: import("./coordination-client.js").ContextMessage[]): string {
    if (messages.length === 0) return "";

    const lines: string[] = [];

    for (const msg of messages) {
      const emoji = this.personaIcons[msg.persona] || "🤖";

      if (msg.messageType === "question") {
        lines.push(`- [${emoji}${msg.persona}] Q: ${msg.content}`);
      } else if (msg.messageType === "answer") {
        lines.push(`- [${emoji}${msg.persona}] A: ${msg.content}`);
      } else if (msg.messageType === "consultation") {
        const target = msg.metadata?.targetPersona as string || "unknown";
        lines.push(`- [${emoji}${msg.persona}] → ${target}: ${msg.content}`);
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
      const emoji = this.personaIcons[c.persona] || "🤖";
      const blocking = c.metadata?.blocking ? " [BLOCKING]" : "";
      lines.push(`- [${emoji}${c.persona}]${blocking} asks you: ${c.content}`);
    }

    return lines.join("\n");
  }

  /**
   * Execute a story using the AI SDK executor.
   * @param story - The story to execute
   * @param allStories - All stories for building the expert roster
   * @param userFeedback - Optional feedback from user via Talk to Worker
   */
  private async executeStory(story: Story, allStories?: Story[], userFeedback?: string, workingDir?: string): Promise<{ success: boolean; error?: string }> {
    // Effective repo path — workingDir override for parallel worktree execution
    const effectiveRepoPath = workingDir || this.repoPath;

    // Get provider routing for this persona from Decision API
    const routing = await this.decisionClient.routeProvider({
      persona: story.persona,
      modelName: this.config.model || this.config.managerModel,
      providerRouting: this.config.providerRouting ? JSON.stringify(this.config.providerRouting) : undefined,
      availableProviders: this.getAvailableProviders(),
    });
    const provider = routing.provider;
    const model = routing.model;
    const prefix = this.getLogPrefix(story.persona, provider);
    const startTime = Date.now();

    await this.postLogWithProvider(`Starting Story ${story.storyIndex}: ${story.title}`, story.persona, provider);
    await this.postLogWithProvider(`Target repo: ${this.config.targetRepo}`, story.persona, provider);
    await this.postLogWithProvider(`Provider: ${provider} | Model: ${model}`, story.persona, provider);

    // Post progress to coordination feed (real-time visibility)
    await this.coordination.postProgress(
      `Starting Story ${story.storyIndex}: ${story.title}`,
      story.persona,
      story.storyIndex
    );

    // Post story start to Jira
    await this.jira.storyStarted(story.storyIndex, story.title, story.persona, provider, model);

    // Load directive for this persona (for effectiveness tracking)
    const directiveContent = await this.loadDirective(story.persona);

    // Build enriched prompt with sibling context, expert roster, directive, and user feedback
    const prompt = await this.buildPrompt(story, allStories, userFeedback, directiveContent, effectiveRepoPath);

    // Use unified AIClient if enabled
    if (this.config.useUnifiedClient) {
      return this.executeStoryWithClient(story, prompt, provider, model, effectiveRepoPath);
    }

    // Legacy path: spawn ai-sdk-executor.js directly
    // Write prompt to temp file
    const promptFile = `/tmp/multi-expert-prompt-${Date.now()}.txt`;
    writeFileSync(promptFile, prompt);

    return new Promise((resolve) => {
      // Build environment with API keys
      // AGENT_WORKING_DIR tells the executor where to run file operations
      const env: Record<string, string> = {
        ...process.env as Record<string, string>,
        AGENT_WORKING_DIR: effectiveRepoPath,
        AGENT_MAX_STEPS: "100",
        AGENT_VERBOSE: "false",  // Cleaner output
        AGENT_STREAMING: "true", // Enable streaming for real-time cost tracking
      };

      // Pass reviewer token for PR approvals (avoids self-approval restriction)
      if (this.config.githubReviewerToken) {
        env.GITHUB_REVIEWER_TOKEN = this.config.githubReviewerToken;
      }

      // Pass icon maps to executor via environment (loaded from Decision API)
      if (Object.keys(this.personaIcons).length > 0) {
        env.PERSONA_ICONS_JSON = JSON.stringify(this.personaIcons);
      }
      if (Object.keys(this.providerIcons).length > 0) {
        env.PROVIDER_ICONS_JSON = JSON.stringify(this.providerIcons);
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

      // Build spawn command: binary mode (re-invoke self) vs Docker mode (node directly)
      const { command: spawnCmd, args: spawnArgs, cwd: spawnCwd } = this.getExecutorSpawnConfig();
      const args = [
        ...spawnArgs,
        "--provider", provider,
        "--model", model,
        "--persona", story.persona,
        "--prompt-file", promptFile,
      ];

      // Docker: runs from /app so node can find AI SDK in /app/node_modules
      // Binary: AGENT_WORKING_DIR env var tells the executor where to run file operations
      const child = spawn(spawnCmd, args, {
        cwd: spawnCwd,
        env: {
          ...env,
          // In binary mode, set the mode so entry.ts routes to ai-sdk-executor
          ...(process.env.__WORKERMILL_MODE ? { __WORKERMILL_MODE: "ai-sdk-executor" } : {}),
        },
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
            const hadTokens = this.parseTokenMarkers(line, story.storyIndex);

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
            // Detect natural language progress patterns (markdown headings, bold text, action phrases)
            this.detectAndPostNaturalProgress(line, story);
          }
        }
      });

      // Collect stderr for quota error detection
      let stderrBuffer = "";

      child.stderr.on("data", (data) => {
        const stderrText = data.toString().trim();
        if (stderrText) {
          stderrBuffer += stderrText + "\n";
          // Only log actual errors, not warnings/info
          if (stderrText.includes("Error") || stderrText.includes("error:")) {
            console.error(`${prefix} ${stderrText}`);
            this.postLog(stderrText, story.persona).catch(() => {});
          }
        }
      });

      // IMPORTANT: Do NOT use async callback with EventEmitter.on()
      // Async callbacks are fire-and-forget - Node won't wait for them
      // This was causing premature exit before resolve() was called
      child.on("close", (code) => {
        try {
          unlinkSync(promptFile);
        } catch {
          // Ignore cleanup errors
        }

        const success = code === 0;
        const error = success ? undefined : `AI SDK executor exited with code ${code}`;

        // Chain async work properly to ensure resolve() is always called
        const postCompletionWork = success
          ? this.getStoryFilesModified(story.storyIndex)
              .then((filesModified) => this.coordination.postCompletion(
                story.storyIndex,
                story.title,
                story.persona,
                { filesModified }
              ))
              .then(() => this.jira.storyCompleted(story.storyIndex, story.title, story.persona))
          : this.coordination.postBlocker(
              `Story ${story.storyIndex} failed: ${error}`,
              story.persona,
              undefined, // dependsOnStory - not applicable for failure blockers
              story.storyIndex // storyIndex - for sessionId threading
            ).then(() => this.jira.storyFailed(story.storyIndex, story.title, story.persona, error || "Unknown error"));

        postCompletionWork
          .catch((err) => {
            console.error(`[MultiExpert] Failed to post completion: ${err}`);
          })
          .finally(() => {
            // ALWAYS resolve the Promise, regardless of completion posting success
            if (success) {
              resolve({ success: true });
            } else {
              resolve({ success: false, error });
            }
          });
      });

      // IMPORTANT: Do NOT use async callback with EventEmitter.on()
      child.on("error", (err) => {
        const error = `Failed to spawn AI SDK executor: ${err.message}`;
        this.coordination.postBlocker(
          error,
          story.persona,
          undefined, // dependsOnStory - not applicable for spawn errors
          story.storyIndex // storyIndex - for sessionId threading
        )
          .then(() => this.jira.storyFailed(story.storyIndex, story.title, story.persona, error))
          .catch((postErr) => {
            console.error(`[MultiExpert] Failed to post blocker: ${postErr}`);
          })
          .finally(() => {
            resolve({ success: false, error });
          });
      });
    });
  }

  /**
   * Execute a story using the unified AIClient interface.
   * This is the feature-flagged path that replaces direct subprocess spawning.
   */
  private async executeStoryWithClient(
    story: Story,
    prompt: string,
    provider: string,
    model: string,
    workingDir?: string
  ): Promise<{ success: boolean; error?: string }> {
    const client = this.getAIClient(provider);
    const expertConfig = getExpertConfigForPersona(story.persona);

    try {
      const result = await client.execute({
        prompt,
        systemPrompt: expertConfig?.systemPrompt || `You are a ${story.persona} working on a software project.`,
        persona: story.persona as import("../epic/types.js").ExpertPersona,
        model,
        workingDir: workingDir || this.repoPath,
        storyId: story.id,
        parentTaskId: this.config.parentTaskId,
        env: {
          GITHUB_TOKEN: this.config.githubToken,
          GITHUB_REVIEWER_TOKEN: this.config.githubReviewerToken || "",
        },
        onMessage: (msg) => {
          // Log messages to dashboard
          if (msg.content) {
            this.postRawLog(msg.content).catch(() => {});
            // Parse markers from content
            this.parsePrMarkersFromContent(msg.content);
            this.detectAndPostDecisions(msg.content, story);
            this.detectAndPostQuestions(msg.content, story);
            this.detectAndPostConsultations(msg.content, story);
            this.detectAndPostAnswers(msg.content, story).catch(() => {});
            this.detectAndPostNaturalProgress(msg.content, story);
          }
        },
        onTokenUsage: (usage) => {
          // Update cumulative token tracking
          const prevUsage = this.storyTokenUsage.get(story.storyIndex) || { inputTokens: 0, outputTokens: 0 };
          const delta = {
            inputTokens: Math.max(0, usage.inputTokens - prevUsage.inputTokens),
            outputTokens: Math.max(0, usage.outputTokens - prevUsage.outputTokens),
          };
          this.tokenUsage.inputTokens += delta.inputTokens;
          this.tokenUsage.outputTokens += delta.outputTokens;
          this.storyTokenUsage.set(story.storyIndex, { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });

          // Report partial tokens periodically
          const now = Date.now();
          if (now - this.lastPartialReportTime >= MultiExpertCoordinator.PARTIAL_REPORT_INTERVAL) {
            this.lastPartialReportTime = now;
            this.reportPartialTokenUsage().catch(() => {});
          }
        },
      });

      // Extract PR URL from markers
      if (result.markers?.prUrl) {
        this.currentPrUrl = result.markers.prUrl;
      }
      if (result.markers?.prNumber) {
        this.currentPrNumber = parseInt(result.markers.prNumber, 10);
      }

      if (result.success) {
        await this.coordination.postCompletion(
          story.storyIndex,
          story.title,
          story.persona,
          { filesModified: await this.getStoryFilesModified(story.storyIndex) }
        );
        await this.jira.storyCompleted(story.storyIndex, story.title, story.persona);
        return { success: true };
      } else {
        const error = result.error || "AIClient execution failed";
        await this.coordination.postBlocker(error, story.persona, undefined, story.storyIndex);
        await this.jira.storyFailed(story.storyIndex, story.title, story.persona, error);
        return { success: false, error };
      }
    } catch (err) {
      const error = `AIClient error: ${err instanceof Error ? err.message : String(err)}`;
      await this.coordination.postBlocker(error, story.persona, undefined, story.storyIndex);
      await this.jira.storyFailed(story.storyIndex, story.title, story.persona, error);
      return { success: false, error };
    }
  }

  /**
   * Parse PR markers from message content (for unified client path).
   */
  private parsePrMarkersFromContent(content: string): void {
    const prUrlMatch = content.match(/::pr_url::(https?:\/\/[^\s]+)/);
    if (prUrlMatch) {
      this.currentPrUrl = prUrlMatch[1];
    }
    const prNumberMatch = content.match(/::pr_number::(\d+)/);
    if (prNumberMatch) {
      this.currentPrNumber = parseInt(prNumberMatch[1], 10);
    }
  }

  /**
   * Mark a story as completed by posting a completion context message.
   */
  /**
   * Execute a story in parallel using an isolated git worktree.
   * Fire-and-forget — mirrors Epic's executeStoryAsync() pattern.
   */
  private executeStoryParallel(story: Story, allStories: Story[], userFeedback?: string): void {
    (async () => {
      try {
        if (!this.gitOps) {
          throw new Error("GitOps not initialized for parallel execution");
        }

        // 1. Create isolated worktree for this story (same as Epic)
        const branch = await this.gitOps.createStoryBranch(
          story.storyIndex, story.title, this.config.jiraIssueKey
        );
        this.activeWorktrees.set(story.storyIndex, branch.worktreePath);
        this.storyBranchNames.set(story.storyIndex, branch.branchName);

        await this.postLog(`Created worktree for Story ${story.storyIndex}: ${branch.worktreePath}`, story.persona);

        // 2. Execute story with worktree path
        const result = await this.executeStoryInWorktree(story, branch.worktreePath, allStories, userFeedback);

        // 3. Handle completion
        await this.completeStory(story.id, story.storyIndex, story.persona, result.success, result.error);
        this.completedStoryIndices.add(story.storyIndex);

        if (result.success) {
          await this.postLog(`Story ${story.storyIndex} completed!`, story.persona);
        } else {
          this.failedStoryIndices.add(story.storyIndex);
          await this.postLog(`Story ${story.storyIndex} failed: ${result.error}`, story.persona);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        await this.completeStory(story.id, story.storyIndex, story.persona, false, errorMsg);
        this.failedStoryIndices.add(story.storyIndex);
        await this.postLog(`Story ${story.storyIndex} error: ${errorMsg}`, story.persona);
      } finally {
        // Reset expert to idle after delay (same as Epic lines 2036-2045)
        setTimeout(() => {
          this.expertStates.set(story.persona, { persona: story.persona, status: "idle" });
        }, 2000);
      }
    })();
  }

  /**
   * Execute a story in an isolated worktree directory.
   * Wraps the existing executeStory() with worktree path override.
   */
  private async executeStoryInWorktree(
    story: Story,
    worktreePath: string,
    allStories: Story[],
    userFeedback?: string
  ): Promise<{ success: boolean; error?: string }> {
    // Pass worktreePath as workingDir override — no shared state mutation (race-safe)
    const result = await this.executeStory(story, allStories, userFeedback, worktreePath);

    // After execution, push the worktree branch (same as Epic)
    if (result.success && this.gitOps) {
      const branchName = this.storyBranchNames.get(story.storyIndex);
      if (branchName) {
        try {
          // Commit any uncommitted work in the worktree
          const { execSync } = await import("child_process");
          const status = execSync("git status --porcelain", { cwd: worktreePath, encoding: "utf-8" });
          if (status.trim()) {
            execSync("git add -A", { cwd: worktreePath, stdio: "pipe" });
            execSync(`git commit -m "feat: Story ${story.storyIndex} - ${story.title}" --allow-empty`, { cwd: worktreePath, stdio: "pipe" });
          }

          // Push the story branch
          await this.gitOps.pushBranchFromWorktree(worktreePath, branchName);
          await this.postLog(`Pushed branch ${branchName}`, story.persona);
        } catch (pushErr) {
          console.error(`[Multi-Provider] Failed to push branch for story ${story.storyIndex}:`, pushErr);
        }
      }
    }

    return result;
  }

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

    // Clone the repository (skip if already cloned by remote-bootstrap)
    if (this.config.repoPath) {
      await this.postLog(`Using pre-cloned repository at ${this.repoPath}`);
    } else {
      await this.cloneRepo();
      await this.postLog("Repository cloned successfully");
    }

    // Load worker config from Decision API (icons, defaults)
    const workerConfig = await this.decisionClient.getWorkerConfig();
    this.personaIcons = workerConfig.personaIcons;
    this.providerIcons = workerConfig.providerIcons;

    // Store server-side prompt templates for reviewer
    this.serverPromptTemplates = workerConfig.promptTemplates;
    if (workerConfig.promptTemplates) {
      console.log("[MultiExpert] Loaded server-side prompt templates");
    }

    // Initialize GitOps for parallel worktree-based execution (remote mode only)
    // In Docker mode, repoPath is the default "/workspace/repo" — GitOps not needed
    const isRemoteMode = !!this.config.repoPath;
    if (isRemoteMode) {
      const workDir = this.repoPath.replace(/\/repo$/, "") || process.env.HOME || "/tmp";
      this.gitOps = new GitOps({
        targetRepo: this.config.targetRepo,
        githubToken: this.config.githubToken,
        workDir,
        scmProvider: (process.env.SCM_PROVIDER as "github" | "gitlab" | "bitbucket") || "github",
        scmBaseUrl: process.env.SCM_BASE_URL,
        bitbucketUsername: process.env.BITBUCKET_USERNAME,
        skipClone: true, // repo already cloned by remote-bootstrap
      }, (msg) => this.postLog(msg));
      console.log("[Multi-Provider] GitOps initialized for parallel execution");
    }

    // Detect and checkout existing branch for retry scenarios
    const hasExistingBranch = await this.detectAndCheckoutExistingBranch();
    if (hasExistingBranch && this.priorWorkContext) {
      await this.postLog("🔄 RETRY SCENARIO: Continuing from previous work");
      // Post prior work summary to Jira
      await this.jira.addComment(
        `🔄 **Retry Scenario Detected**\n\n` +
        `Found existing branch: \`${this.priorWorkContext.branchName}\`\n` +
        `Previous commits: ${this.priorWorkContext.commits.length}\n` +
        (this.priorWorkContext.prUrl ? `Existing PR: ${this.priorWorkContext.prUrl}\n` : "") +
        (this.priorWorkContext.prReviewComments?.length
          ? `Review comments: ${this.priorWorkContext.prReviewComments.length}\n`
          : "")
      );
    }

    // Main execution loop
    let completedStories = 0;
    let failedStories = 0;
    let noProgressIterations = 0;
    const MAX_NO_PROGRESS_ITERATIONS = 10;

    // Fetch all stories once for roster building (before filtering)
    const allStoriesForRoster = await this.fetchAllStories();

    // Initialize expert states from unique personas (for parallel mode)
    if (this.gitOps) {
      const uniquePersonas = new Set(allStoriesForRoster.map((s) => s.persona));
      for (const persona of uniquePersonas) {
        this.expertStates.set(persona, { persona, status: "idle" });
      }
      console.log(`[Multi-Provider] Parallel mode: ${uniquePersonas.size} expert(s), max ${this.maxParallelExperts} parallel`);
    }

    while (this.running) {
      // Check for dashboard commands (pause/resume/message)
      await this.pollForCommands();

      // Fetch available (pending) stories
      const stories = await this.fetchStories();

      if (stories.length === 0) {
        // In parallel mode, wait for in-flight stories to complete
        if (this.gitOps) {
          const hasRunningExperts = [...this.expertStates.values()].some((s) => s.status === "working");
          if (hasRunningExperts) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            continue;
          }
        }
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
        // In parallel mode, check if experts are still working
        if (this.gitOps) {
          const hasRunningExperts = [...this.expertStates.values()].some((s) => s.status === "working");
          if (hasRunningExperts) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            continue;
          }
        }
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

      if (this.gitOps) {
        // === PARALLEL MODE (remote agent with GitOps) ===
        for (const story of readyStories) {
          if (!this.running) break;

          // Check if we've hit the parallel limit
          const workingCount = [...this.expertStates.values()].filter((e) => e.status === "working").length;
          if (workingCount >= this.maxParallelExperts) break;

          // Check if this persona's expert slot is available
          const expert = this.expertStates.get(story.persona);
          if (expert && expert.status !== "idle") continue;

          // Try to claim the story
          const claimed = await this.claimStory(story.id, story.persona);
          if (!claimed) continue;

          // Update expert state to working
          this.expertStates.set(story.persona, {
            persona: story.persona,
            status: "working",
            currentStoryIndex: story.storyIndex,
          });

          // Get any pending user feedback
          const userFeedback = this.getUserFeedback();
          if (userFeedback) {
            console.log(`[Multi-Provider] Passing user feedback to ${story.persona}: "${userFeedback.substring(0, 50)}..."`);
          }

          // Fire-and-forget: execute story in isolated worktree (same as Epic line 1818)
          this.executeStoryParallel(story, allStoriesForRoster, userFeedback || undefined);
        }

        // Tally completions from parallel execution
        completedStories = this.completedStoryIndices.size;
        failedStories = this.failedStoryIndices.size;

        // Small delay between poll iterations
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } else {
        // === SEQUENTIAL MODE (Docker, existing behavior) ===
        for (const story of readyStories) {
          if (!this.running) break;

          // Try to claim the story
          const claimed = await this.claimStory(story.id, story.persona);
          if (!claimed) {
            continue;
          }

          // Get any pending user feedback (from Talk to Worker)
          const userFeedback = this.getUserFeedback();
          if (userFeedback) {
            console.log(`[Multi-Provider] Passing user feedback to ${story.persona}: "${userFeedback.substring(0, 50)}..."`);
          }

          // Execute the story (pass all stories for roster display and user feedback)
          const result = await this.executeStory(story, allStoriesForRoster, userFeedback || undefined);

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
                  `✅ Received answer from ${answer.persona}: "${answer.content}"`,
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
      // Post final summary to Jira (with transition to Done)
      await this.jira.postFinalSummary(completedStories, failedStories, undefined);
      console.log("::result::failed");
      return;
    }

    // Run quality verification before creating PR (same as Epic mode)
    if (completedStories > 0) {
      await this.postLog("Running quality verification...");
      try {
        this.qualityMetrics = await runQualityVerification(this.repoPath);

        // Post metrics to API
        await postQualityMetrics(
          this.config.apiBaseUrl,
          this.config.orgApiKey,
          this.config.parentTaskId,
          this.qualityMetrics
        );
        await this.postLog(`Quality metrics posted: score=${this.qualityMetrics.qualityScore}/100`);

        // Evaluate quality gate via Decision API
        const diffSummary = `score=${this.qualityMetrics.qualityScore}/100, typeErrors=${this.qualityMetrics.typeErrors}, lintErrors=${this.qualityMetrics.lintErrors}, testsFailed=${this.qualityMetrics.testsFailed}`;
        this.qualityGateResult = await this.decisionClient.evaluateQuality({
          diff: diffSummary,
          storyDescription: this.jiraRequirements || undefined,
        });

        // Log quality gate result
        const statusIcon = this.qualityGateResult.pass ? "PASSED ✅" : "FAILED ❌";
        console.log(`[Multi-Provider] Quality Gate: ${statusIcon}`);
        await this.postLog(
          `Quality gate: ${statusIcon}${this.qualityGateResult.reasons.length > 0 ? ` - ${this.qualityGateResult.reasons[0]}` : ""}`
        );

        // If quality gate failed, warn but don't block (can add blocking later)
        if (!this.qualityGateResult.pass) {
          const failureReasons = [...this.qualityGateResult.reasons, ...this.qualityGateResult.blockers];
          await this.postLog(
            `Quality gate issues: ${failureReasons.join(", ")}`
          );
        }
      } catch (qualityError) {
        const errMsg = qualityError instanceof Error ? qualityError.message : String(qualityError);
        console.warn("[Multi-Provider] Quality verification failed (non-fatal):", errMsg);
        await this.postLog(`Quality verification warning: ${errMsg}`);
        // Don't block PR creation on quality verification errors
      }
    }

    // Create PR if stories completed successfully
    if (completedStories > 0 && !this.currentPrUrl) {
      await this.createConsolidatedPR();
    }

    // Post final summary to Jira AFTER PR creation (with PR URL)
    await this.jira.postFinalSummary(completedStories, failedStories, this.currentPrUrl);

    // Run inline review if enabled and PR exists (with revision loop)
    if (!this.config.skipManagerReview && this.currentPrUrl && this.currentPrNumber) {
      let reviewDone = false;
      let finalDecision: "approved" | "revision_needed" | "rejected" = "revision_needed";

      while (!reviewDone && this.running) {
        const reviewResult = await this.runInlineReview();
        finalDecision = reviewResult.decision;

        if (!reviewResult.needsRevision) {
          // Review is final (approved, rejected, or max revisions reached)
          reviewDone = true;
        } else {
          // Revision needed - re-run stories with feedback
          await this.postLog(`Re-running stories with Tech Lead feedback...`);

          // Reset story tracking for re-execution
          this.completedStoryIndices.clear();

          // Fetch all stories again and re-execute them with revision feedback
          const allStories = await this.fetchAllStories();
          let revisionCompletedStories = 0;
          let revisionFailedStories = 0;

          for (const story of allStories) {
            if (!this.running) break;

            await this.postLog(`Revision: Re-executing story ${story.storyIndex} (${story.title})`, story.persona);

            // Execute with revision feedback
            const result = await this.executeStory(story, allStories, reviewResult.feedback);
            await this.completeStory(story.id, story.storyIndex, story.persona, result.success, result.error);
            this.completedStoryIndices.add(story.storyIndex);

            if (result.success) {
              revisionCompletedStories++;
              await this.postLog(`Revision: Story ${story.storyIndex} completed!`, story.persona);
            } else {
              revisionFailedStories++;
              await this.postLog(`Revision: Story ${story.storyIndex} failed: ${result.error}`, story.persona);
            }
          }

          await this.postLog(`Revision complete: ${revisionCompletedStories} succeeded, ${revisionFailedStories} failed`);

          // If revision had failures, escalate
          if (revisionFailedStories > 0) {
            await this.postLog("Revision had failures, escalating to human review");
            finalDecision = "revision_needed";
            reviewDone = true;
          } else {
            // Push changes and update PR
            await this.pushChangesForRevision();
          }
        }
      }

      // Output revision count for dashboard visibility
      if (this.revisionCount > 0) {
        console.log(`::revision_count::${this.revisionCount}`);
      }

      if (finalDecision === "approved") {
        console.log("::result::pr_approved");
        await this.postLog("::result::pr_approved");
        if (this.currentPrUrl) {
          console.log(`::pr_url::${this.currentPrUrl}`);
          await this.postLog(`::pr_url::${this.currentPrUrl}`);
        }
      } else if (finalDecision === "rejected") {
        console.log("::result::failed");
        await this.postLog("::result::failed");
      } else {
        // revision_needed or review failed - request human review
        console.log("::result::review_requested");
        await this.postLog("::result::review_requested");
        if (this.currentPrUrl) {
          console.log(`::pr_url::${this.currentPrUrl}`);
          await this.postLog(`::pr_url::${this.currentPrUrl}`);
        }
      }
    } else {
      // No review configured or no PR - request human review
      console.log("::result::review_requested");
      await this.postLog("::result::review_requested");
      if (this.currentPrUrl) {
        console.log(`::pr_url::${this.currentPrUrl}`);
        await this.postLog(`::pr_url::${this.currentPrUrl}`);
      }
    }
  }

  /**
   * Push changes after a revision and update the PR.
   */
  private async pushChangesForRevision(): Promise<void> {
    try {
      const { execSync } = await import("child_process");

      // Stage all changes
      execSync("git add -A", { cwd: this.repoPath, stdio: "pipe" });

      // Commit with revision message
      const commitMsg = `fix: Address Tech Lead review feedback (revision ${this.revisionCount})`;
      execSync(`git commit -m "${commitMsg}" --allow-empty`, { cwd: this.repoPath, stdio: "pipe" });

      // Push to the PR branch
      execSync("git push", { cwd: this.repoPath, stdio: "pipe" });

      await this.postLog(`Pushed revision ${this.revisionCount} changes to PR`);
    } catch (err) {
      console.error("[Multi-Provider] Failed to push revision changes:", err);
      await this.postLog(`Failed to push revision changes: ${err}`);
    }
  }

  /**
   * Run inline Tech Lead review.
   * Uses Agent SDK for Anthropic, AI SDK for other providers.
   * Returns the final review decision.
   */
  /**
   * Run inline Tech Lead review.
   * Returns "approved", "rejected", or "revision_needed" (with needsRevision flag for caller).
   * When revision is needed and we haven't hit max, returns with needsRevision=true so caller can re-run stories.
   */
  private async runInlineReview(): Promise<{ decision: "approved" | "revision_needed" | "rejected"; needsRevision: boolean; feedback?: string }> {
    if (!this.currentPrUrl || !this.currentPrNumber) {
      await this.postLog("No PR detected, skipping inline review");
      return { decision: "revision_needed", needsRevision: false };
    }

    await this.postLog(`Starting inline Tech Lead review phase (attempt ${this.revisionCount + 1}/${this.maxRevisions})`);
    await this.coordination.postContext(
      "progress",
      `Starting Tech Lead review (attempt ${this.revisionCount + 1}/${this.maxRevisions})`,
      "tech_lead"
    ).catch(() => {});

    // Get provider for tech_lead from Decision API
    const { provider, model } = await this.decisionClient.routeProvider({
      persona: "tech_lead",
      modelName: this.config.model || this.config.managerModel,
      providerRouting: this.config.providerRouting ? JSON.stringify(this.config.providerRouting) : undefined,
      availableProviders: this.getAvailableProviders(),
    });
    await this.postLog(`Tech Lead review using ${provider}/${model}`);

    const result = await this.runAiSdkReview(provider, model);

    if (!result.success) {
      await this.postLog(`Review failed: ${result.error}`, "tech_lead");
      return { decision: "revision_needed", needsRevision: false }; // Let human review handle it
    }

    await this.postLog(`Review decision: ${result.decision} (score: ${result.codeQualityScore})`, "tech_lead");

    if (result.decision === "approved") {
      await this.postLog("PR approved by Tech Lead!");
      await this.jira.addComment(`✅ Tech Lead approved PR with score ${result.codeQualityScore}/10`);
      await this.coordination.postContext(
        "decision",
        `✅ PR approved (score: ${result.codeQualityScore}/10)\n\n${result.feedback}`,
        "tech_lead"
      ).catch(() => {});
      return { decision: "approved", needsRevision: false };
    }

    if (result.decision === "rejected") {
      await this.postLog("PR rejected by Tech Lead - fundamental issues detected");
      await this.jira.addComment(`❌ Tech Lead rejected PR: ${result.feedback}`);
      await this.coordination.postContext(
        "decision",
        `❌ PR rejected\n\n${result.feedback}`,
        "tech_lead"
      ).catch(() => {});
      return { decision: "rejected", needsRevision: false };
    }

    // revision_needed - track feedback
    this.revisionCount++;
    this.lastReviewFeedback = result.feedback;
    await this.postLog(`Revision ${this.revisionCount}/${this.maxRevisions} needed: ${result.feedback}`);
    await this.jira.addComment(`🔄 Revision ${this.revisionCount}/${this.maxRevisions} requested:\n\n${result.feedback}`);
    await this.coordination.postContext(
      "revision_requested",
      `🔄 Revision ${this.revisionCount}/${this.maxRevisions} needed\n\n${result.feedback}`,
      "tech_lead"
    ).catch(() => {});

    if (this.revisionCount >= this.maxRevisions) {
      await this.postLog("Max revisions reached, escalating to human review");
      return { decision: "revision_needed", needsRevision: false };
    }

    // Signal that caller should re-run stories with the feedback
    return { decision: "revision_needed", needsRevision: true, feedback: result.feedback };
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
      ticketSystem: this.config.ticketSystem,
      jiraRequirements: this.jiraRequirements,
      provider,
      model,
      anthropicApiKey: this.config.anthropicApiKey,
      googleApiKey: this.config.googleApiKey,
      openaiApiKey: this.config.openaiApiKey,
      ollamaHost: this.config.ollamaHost,
      maxReviewRevisions: this.config.maxReviewRevisions,
    };

    const reviewer = new InlineReviewerAiSdk(reviewerConfig, this.repoPath, this.serverPromptTemplates?.techLeadReviewPrompt);
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

// Run only when executed as Docker entrypoint (not when imported by remote-bootstrap)
// In remote mode, __WORKERMILL_MODE is set and remote-bootstrap imports this module
// and instantiates MultiExpertCoordinator directly with its own config
if (!process.env.__WORKERMILL_MODE) {
  main();
}
