/**
 * Story Executor for Epic Mode
 *
 * Executes individual stories using the Claude Agent SDK.
 * Epic mode uses Anthropic/Claude CLI exclusively.
 * Agents can Read, Write, Edit files and run Bash commands autonomously.
 */

import type {
  ExpertPersona,
  ReadyStory,
  StoryResult,
  ContextMessage,
  EpicConfig,
  StreamMessage,
  ResilienceConfig,
  StoryValidationResult,
} from "./types.js";
import { getExpertConfig, COORDINATION_INSTRUCTIONS, LEARNING_INSTRUCTIONS } from "./experts.js";
import { CoordinationClient } from "./coordination-client.js";
import { GitOps, getBitbucketAuthHeader } from "./git-ops.js";
import { TicketOps } from "./ticket-ops.js";
import { runAgent, type AgentOptions, type AgentResult } from "./agent-sdk.js";
import { createAIClient, type AIClient, type AIClientOptions, type AIProvider } from "./ai-client-types.js";
import type { DecisionClient } from "./decision-client.js";
import { createRetryableApi } from "./api-retry.js";
import { isDockerDaemonReachable } from "./gate-utils.js";
import axios from "axios";
import { createLogsApi } from "../lib/api-client.js";
import * as fs from "fs/promises";
import { existsSync } from "fs";
import { execSync, execFileSync, spawn } from "child_process";

// Persona and provider icons are loaded from the Decision API at runtime
// via setIcons() called by the coordinator after getWorkerConfig().

/**
 * Load directive content from filesystem for a given persona (fallback).
 * Returns empty string if directive not found.
 */
async function loadDirectiveFromFile(persona: ExpertPersona): Promise<string> {
  const directivePath = `/app/directives/${persona}/README.md`;
  try {
    const content = await fs.readFile(directivePath, "utf-8");
    console.log(`[Epic] Loaded directive for ${persona} from file (${content.length} chars)`);
    return content;
  } catch {
    console.log(`[Epic] No directive found for ${persona}, using default prompt`);
    return "";
  }
}


/**
 * Tracking info for blocking questions.
 */
interface BlockingQuestion {
  id: string;
  questionId: string;
  content: string;
  targetPersona?: string;
}

/**
 * Story executor using Claude Agent SDK.
 */
export class StoryExecutor {
  private coordination: CoordinationClient;
  private gitOps: GitOps;
  private ticketOps: TicketOps;
  private config: EpicConfig;
  private logsApi: ReturnType<typeof createRetryableApi>;
  // Track blocking questions that need answers before story completes
  private pendingBlockingQuestions: Map<string, BlockingQuestion> = new Map();
  // Cache for directive bundles (by persona slug)
  private directiveCache: Map<string, { readme: string | null; common: Record<string, string> } | null> = new Map();
  // Unified AIClient for feature-flagged execution
  private aiClient: AIClient | null = null;
  // Decision client for API-side error classification
  private decisionClient: DecisionClient;
  // Resilience configuration (from org settings)
  private resilience: ResilienceConfig;
  // True when the current story execution has active user feedback (Talk to Worker)
  private hasActiveUserFeedback = false;
  // Track auto-retry attempts per story (for blocker handling)
  private retryCountByStory: Map<number, number> = new Map();
  // Persona/provider icons loaded from Decision API
  private personaIcons: Record<string, string> = {};
  private providerIcons: Record<string, string> = {};
  // Callback to notify coordinator when a worktree is created (for graceful shutdown tracking)
  onWorktreeCreated?: (storyIndex: number, worktreePath: string, branchName: string) => void;

  constructor(
    config: EpicConfig,
    coordination: CoordinationClient,
    gitOps: GitOps,
    decisionClient: DecisionClient,
    resilience?: ResilienceConfig
  ) {
    this.config = config;
    this.coordination = coordination;
    this.gitOps = gitOps;
    this.decisionClient = decisionClient;
    this.ticketOps = new TicketOps(config.jiraIssueKey, config.ticketSystem);
    // Default resilience settings if not provided
    this.resilience = resilience || {
      blockerMaxAutoRetries: 3,
      blockerAutoRetryEnabled: true,
      pushAfterCommit: true,
      gracefulShutdownEnabled: true,
    };

    // Create axios instance for posting logs to the dashboard (with retry for transient 5xx)
    const rawApi = createLogsApi(config);
    this.logsApi = createRetryableApi(rawApi, {
      maxRetries: 5,
      initialDelayMs: 500,
      maxDelayMs: 10000,
      logger: (msg) => console.log(`[Executor] ${msg}`),
    });

    // Initialize AIClient if unified client is enabled
    if (config.useUnifiedClient) {
      const provider = (config.workerProvider || "anthropic") as AIProvider;
      const isAnthropic = provider === "anthropic";
      this.aiClient = createAIClient({
        provider,
        apiKeys: {
          anthropic: isAnthropic ? config.anthropicApiKey : undefined,
          ollamaHost: provider === "ollama" ? (process.env.OLLAMA_HOST || "http://localhost:11434") : undefined,
        },
        apiConfig: { baseUrl: config.apiBaseUrl, orgApiKey: config.orgApiKey },
        useAgentSdk: isAnthropic,  // Only use Claude CLI for Anthropic
        githubToken: config.githubToken,
        // Docker sandbox mounts ~/.claude/.credentials.json — Claude CLI reads it directly.
        // Pass "mounted" as a truthy sentinel so validateApiKey() doesn't reject.
        oauthToken: isAnthropic && !config.anthropicApiKey ? "mounted" : undefined,
      });
    }
  }

  /**
   * Set persona and provider icons loaded from the Decision API.
   * Called by the coordinator after getWorkerConfig().
   */
  setIcons(personaIcons: Record<string, string>, providerIcons: Record<string, string>): void {
    this.personaIcons = personaIcons;
    this.providerIcons = providerIcons;
  }

  /**
   * Set server-side prompt templates loaded from the Decision API.
   * Called by the coordinator after getWorkerConfig().
   */
  private serverCoordinationInstructions: string | null = null;
  private serverLearningInstructions: string | null = null;

  setPromptTemplates(templates: { coordinationInstructions?: string; learningInstructions?: string }): void {
    this.serverCoordinationInstructions = templates.coordinationInstructions ?? null;
    this.serverLearningInstructions = templates.learningInstructions ?? null;
  }

  /**
   * Execute an agent using either the unified AIClient or legacy runAgent.
   * Routes based on the useUnifiedClient feature flag.
   */
  private async executeAgent(
    options: AgentOptions,
    storyId: string,
    onMessage?: (msg: StreamMessage) => void
  ): Promise<AgentResult> {
    // Use unified AIClient if enabled
    if (this.config.useUnifiedClient && this.aiClient && options.expertConfig) {
      const clientOptions: AIClientOptions = {
        prompt: options.prompt,
        systemPrompt: options.expertConfig.systemPrompt,
        persona: options.expertConfig.persona,
        model: options.expertConfig.model,
        workingDir: options.repoPath,
        storyId: storyId,
        parentTaskId: this.config.parentTaskId,
        env: options.env,
        tools: options.expertConfig.tools,
        onMessage: onMessage,
      };

      const result = await this.aiClient.execute(clientOptions);

      // Convert AIClientResult to AgentResult for compatibility
      return {
        success: result.success,
        messages: result.messages,
        error: result.error,
        structuredOutput: result.structuredOutput,
      };
    }

    // Legacy path: use runAgent directly
    return runAgent(this.config, {
      ...options,
      onMessage,
    });
  }

  /**
   * Get formatted log prefix with persona emoji and provider icon.
   * Format: [🧪 qa_engineer 🤖] for persona + provider visibility
   */
  private getLogPrefix(expert: ExpertPersona, provider?: string): string {
    const emoji = this.personaIcons[expert] || "🤖";
    const effectiveProvider = provider || this.config.workerProvider || "anthropic";
    const providerIcon = this.providerIcons[effectiveProvider] || "🤖";
    return `[${emoji} ${expert} ${providerIcon}]`;
  }

  /**
   * Post a log message to the WorkerMill dashboard.
   * This makes agent output visible in the task logs panel.
   */
  private async postLog(
    message: string,
    expert: ExpertPersona,
    type: "system" | "tool" | "output" | "error" = "output"
  ): Promise<void> {
    const prefix = this.getLogPrefix(expert);

    // Also log to CloudWatch
    console.log(`${prefix} ${message}`);

    try {
      await this.logsApi.post("/api/control-center/logs", {
        taskId: this.config.parentTaskId,
        type,
        message: `${prefix} ${message}`,
        severity: type === "error" ? "error" : "info",
      });
    } catch {
      // Fire and forget - don't block on log failures
    }
  }

  /**
   * Post a code event (Write/Edit) to the Live Code Viewer.
   * Fire-and-forget — does not block on failures.
   */
  private postCodeEvent(
    toolName: "Write" | "Edit",
    filePath: string,
    expert: string,
    data: { content?: string; oldStr?: string; newStr?: string },
  ): void {
    // Truncate content at 100KB
    const truncate = (s?: string) =>
      s && s.length > 100_000 ? s.substring(0, 100_000) : s;

    this.logsApi
      .post("/api/control-center/code-events", {
        taskId: this.config.parentTaskId,
        toolName,
        filePath,
        content: truncate(data.content),
        oldStr: truncate(data.oldStr),
        newStr: truncate(data.newStr),
        expert,
      })
      .catch(() => {
        // Fire and forget — don't block on code event failures
      });
  }

  /**
   * Load directive content for a persona.
   * Tries API first (supports org customizations), falls back to file system.
   * Also records directive usage for effectiveness tracking.
   */
  private async loadDirective(persona: ExpertPersona): Promise<string> {
    // Check cache first
    if (this.directiveCache.has(persona)) {
      const cached = this.directiveCache.get(persona);
      return cached?.readme || "";
    }

    // Try API first
    try {
      const response = await this.logsApi.get<{ directives?: { readme?: string | null; common?: Record<string, string>; readmeMeta?: { id: string; version: number } | null; commonMeta?: Record<string, { id: string; version: number }> } }>(`/api/personas/worker/${persona}/bundle`);
      const bundle = response.data;

      const directives = bundle?.directives;
      if (directives && (directives.readme || Object.keys(directives.common || {}).length > 0)) {
        console.log(`[Epic] Loaded directive for ${persona} from API`);
        const cacheEntry = { readme: directives.readme ?? null, common: directives.common ?? {} };
        this.directiveCache.set(persona, cacheEntry);

        // Record directive usage for effectiveness tracking
        await this.recordDirectiveUsage(persona, directives);

        return directives.readme || "";
      }
    } catch {
      // API doesn't have directives, fall back to file system
    }

    // Fall back to file system
    this.directiveCache.set(persona, null);
    return loadDirectiveFromFile(persona);
  }

  /**
   * Record which directives were used for this task.
   * This data is used to track directive effectiveness over time.
   */
  private async recordDirectiveUsage(
    persona: ExpertPersona,
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
        await this.logsApi.post("/api/directives/usage", {
          taskId: this.config.parentTaskId,
          directives: usageRecords,
        });
        console.log(`[Epic] Recorded ${usageRecords.length} directive(s) usage for ${persona}`);
      }
    } catch (error) {
      // Don't fail the task if directive tracking fails
      console.warn(`[Epic] Failed to record directive usage: ${error}`);
    }
  }

  /**
   * Build enriched system prompt for an expert.
   * Layers:
   * 1. Core identity (from experts.ts systemPrompt)
   * 2. Domain expertise (loaded from directives/{persona}/README.md)
   * 3. Coordination protocol (only if multi-story task)
   */
  private async buildEnrichedSystemPrompt(
    expert: ExpertPersona,
    totalStories: number
  ): Promise<string> {
    const expertConfig = getExpertConfig(expert);
    let prompt = expertConfig.systemPrompt;

    // Load domain expertise from directive
    const directive = await this.loadDirective(expert);
    if (directive) {
      prompt += "\n\n## Domain Expertise\n\n" + directive;
    }

    // Inject org-level AI guidelines (intent engineering)
    if (this.config.orgGuidelines) {
      prompt += `\n\n## Organization Guidelines\n\nThe following guidelines are set by this organization and take precedence over general best practices. Treat these as hard constraints, not suggestions:\n\n${this.config.orgGuidelines}`;
    }

    // Only add coordination instructions for multi-story tasks (saves ~1K tokens for single-story)
    if (totalStories > 1) {
      prompt += this.serverCoordinationInstructions ?? COORDINATION_INSTRUCTIONS;
    } else {
      console.log(`[Epic] Skipping coordination instructions for single-story task`);
    }

    // Always add learning instructions so experts can report discoveries
    prompt += this.serverLearningInstructions ?? LEARNING_INSTRUCTIONS;

    // Communication tone — keep status updates professional and direct
    prompt += `

## Communication Style

Write in a professional, direct tone. Do NOT open messages with filler words or pleasantries like "Perfect!", "Great!", "Awesome!", "Sure!", "Absolutely!", or similar. Start with the substance — what you did, what you found, or what you need. Be concise and informative.

When summarizing your work at the end, describe decisions in plain language. The internal DEC-xxx markers are parsed by the system automatically — your summary should restate decisions in readable form. For example, instead of repeating "DEC-001: Created repository-level config", write "Decision 1: Created a repository-level configuration file for..." with enough context for a non-technical reader to understand.`;

    // Docker environment — ALWAYS include instructions.
    // Even if `docker info` fails at startup (e.g., socket permission race, native mode),
    // the Claude agent may be able to use Docker at runtime, and the instructions
    // serve as a strong signal to prefer real services over mocks.
    const dockerAvailable = isDockerDaemonReachable();
    if (!dockerAvailable) {
      console.log("[Epic] Docker daemon not reachable at startup — Docker instructions still included in prompt");
    }
    prompt += `

## Development Environment (MANDATORY)

You have \`docker\` and \`docker compose\` available. **You MUST spin up real service dependencies** (databases, caches, message queues, etc.) using Docker containers before writing any application code that depends on them. Do NOT mock or stub external services — connect to real instances running in Docker.

### Required Workflow
1. **Before writing application code**: Start all required service containers
2. **Configure your code** to connect to \`localhost\` on the container ports. The worker uses host networking, so Docker services are reachable at localhost.
3. **Run tests against real services** — integration tests must hit real databases, not mocks
4. **Clean up containers** when you're done (\`docker stop <name>\`)

### Common Services
- MongoDB: \`docker run -d --rm -p 27017:27017 --name mongo-test mongo:7\`
- Redis: \`docker run -d --rm -p 6379:6379 --name redis-test redis:7-alpine\`
- PostgreSQL: \`docker run -d --rm -p 5432:5432 -e POSTGRES_PASSWORD=test --name postgres-test postgres:16-alpine\`
- MySQL: \`docker run -d --rm -p 3306:3306 -e MYSQL_ROOT_PASSWORD=test --name mysql-test mysql:8\`
- RabbitMQ: \`docker run -d --rm -p 5672:5672 --name rabbitmq-test rabbitmq:3-alpine\`
- If the project has a \`docker-compose.yml\`, use \`docker compose up -d\`
- Connect to services at \`localhost\` on the mapped ports. For example: \`postgresql://user:pass@localhost:5432/db\`

### Why This Matters
Mocking produces code full of assumptions and interface mismatches that break on first contact with real services. Real containers catch connection strings, schema mismatches, query errors, and serialization bugs immediately — not after deployment. **Tests that pass against mocks but fail against real services are worthless.**

### If Docker Is Not Working
If \`docker\` commands fail, DO NOT fall back to mocking. Instead:
1. Report the Docker error as a blocker
2. If the quality gate commands include env vars like MONGODB_URI or REDIS_URL, the test infrastructure expects REAL services
3. Never write test stubs or mock implementations as a workaround — the quality gates will catch and reject them

### CI/CD Workflows Must Include Service Containers
When creating GitHub Actions CI workflows that run tests requiring databases or other services, you **MUST** add \`services:\` blocks so the CI runner has real service instances. Example for PostgreSQL:
\`\`\`yaml
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
\`\`\`
The same pattern applies to Redis, MongoDB, MySQL, etc. **Tests that pass locally with Docker but fail in CI because there's no database are a waste of CI fix cycles.** Always match your local Docker setup with CI service containers.`;

    // Version trust instruction — generic, not hardcoded to any specific version
    prompt += `

## ⚠️ Technology Versions — Trust the Spec

**If the ticket, PRD, or task description specifies a dependency version, USE THAT VERSION.** Do NOT downgrade or "fix" versions you don't recognize — your training data has a cutoff and newer releases exist. Trust the spec over your knowledge.`;

    return prompt;
  }

  /**
   * Extract learnings from agent result messages.
   * Parses ::learning:: markers from the agent's text output.
   */
  private extractLearningsFromResult(result: { messages: StreamMessage[] }): string[] {
    const learnings: string[] = [];
    const fullText = result.messages
      .filter((m) => m.type === "text" || m.type === "result")
      .map((m) => m.content || "")
      .join("\n");

    const pattern = /::learning::(.+)/g;
    let match;
    while ((match = pattern.exec(fullText)) !== null) {
      const learning = match[1].trim();
      if (learning.length > 0) learnings.push(learning);
    }
    return learnings;
  }

  /**
   * Extract acceptance criteria from story description.
   * Looks for GIVEN/WHEN/THEN format or bullet points.
   */
  private extractAcceptanceCriteria(description: string): string[] {
    const criteria: string[] = [];

    // Look for GIVEN/WHEN/THEN blocks
    const gwtPattern = /(?:GIVEN|WHEN|THEN|AND)[:\s]+([^\n]+)/gi;
    let match;
    while ((match = gwtPattern.exec(description)) !== null) {
      criteria.push(match[1].trim());
    }

    // If no GWT found, look for bullet points
    if (criteria.length === 0) {
      const bulletPattern = /^[\s]*[-*•]\s+(.+)$/gm;
      while ((match = bulletPattern.exec(description)) !== null) {
        criteria.push(match[1].trim());
      }
    }

    // If still nothing, use the whole description as a single criterion
    if (criteria.length === 0 && description.trim()) {
      criteria.push(description.trim());
    }

    return criteria;
  }

  /**
   * Validate story completion before marking it done.
   * Checks acceptance criteria and verifies files were modified.
   */
  // ─── Quality Gate Methods ─────────────────────────────────────────────────

  /**
  /**
   * Merge all completed sibling branches into the story worktree.
   * Reuses the incremental rebase pattern — non-blocking on conflicts.
   * Called at story start and before each quality gate retry.
   */
  private async rebaseSiblingBranches(
    story: ReadyStory,
    expert: ExpertPersona,
    worktreePath?: string
  ): Promise<void> {
    if (!(this.resilience.incrementalRebaseEnabled ?? true)) return;
    if (!worktreePath) return;
    const wtPath = worktreePath;

    try {
      const allCompleted = await this.coordination.getAllCompletedBranchNames();
      // Filter out branches already merged as declared dependencies and current story
      const declaredDeps = new Set(story.dependencies || []);
      const siblingBranches: string[] = [];
      const sortedEntries = Array.from(allCompleted.entries()).sort(([a], [b]) => a - b);
      for (const [idx, branch] of sortedEntries) {
        if (idx === story.storyIndex) continue;
        if (declaredDeps.has(idx)) continue;
        siblingBranches.push(branch);
      }

      if (siblingBranches.length > 0) {
        await this.postLog(
          `Incremental rebase: merging ${siblingBranches.length} completed sibling branch(es)...`,
          expert,
          "system"
        );
        const siblingResult = await this.gitOps.mergeDependencyBranches(wtPath, siblingBranches);
        if (siblingResult.merged.length > 0) {
          await this.postLog(
            `Incremental rebase: merged ${siblingResult.merged.length} sibling branch(es): ${siblingResult.merged.join(", ")}`,
            expert,
            "system"
          );
        }
        if (siblingResult.conflicted.length > 0) {
          await this.postLog(
            `Incremental rebase: ${siblingResult.conflicted.length} sibling branch(es) had conflicts (non-blocking): ${siblingResult.conflicted.join(", ")}`,
            expert,
            "system"
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.postLog(
        `Incremental rebase failed (non-blocking): ${msg}`,
        expert,
        "system"
      );
    }
  }

  /**
   * [GATE 2] Post-push CI verification — waits for CI pipeline to complete
   * and verifies it passed. Only runs if CI workflow file exists in the worktree.
   */
  private async runPostPushCIGate(
    worktreePath: string,
    branchName: string,
    expert: ExpertPersona
  ): Promise<{ passed: boolean; log?: string; summary: string; infrastructureFailure?: boolean }> {
    const ciPath = this.config.ciWorkflowPath;
    if (!ciPath) {
      return { passed: true, summary: "No CI workflow path configured" };
    }

    // Check if the CI workflow file exists in the worktree
    try {
      await fs.access(`${worktreePath}/${ciPath}`);
    } catch {
      await this.postLog(`[CI Gate] No CI workflow at ${ciPath} — skipping post-push CI gate`, expert, "system");
      return { passed: true, summary: "CI workflow not yet created" };
    }

    // Parse repo owner/name from targetRepo
    const repoMatch = this.config.targetRepo.match(/([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (!repoMatch) {
      await this.postLog(`[CI Gate] Cannot parse repo from ${this.config.targetRepo} — skipping`, expert, "system");
      return { passed: true, summary: "Cannot parse repository" };
    }
    const [, owner, repo] = repoMatch;

    const scmProvider = process.env.SCM_PROVIDER || "github";
    await this.postLog(`[CI Gate] Waiting for CI to complete on branch ${branchName} (${scmProvider})...`, expert, "system");

    switch (scmProvider) {
      case "github":
        return this.pollGitHubActionsCI(owner, repo, branchName, expert);
      case "bitbucket":
        return this.pollBitbucketPipelinesCI(owner, repo, branchName, expert);
      default:
        await this.postLog(`[CI Gate] CI polling not supported for ${scmProvider} — skipping`, expert, "system");
        return { passed: true, summary: `CI polling not supported for ${scmProvider}` };
    }
  }

  /**
   * Poll GitHub Actions API for CI status.
   */
  private async pollGitHubActionsCI(
    owner: string,
    repo: string,
    branchName: string,
    expert: ExpertPersona
  ): Promise<{ passed: boolean; log?: string; summary: string; infrastructureFailure?: boolean }> {
    const maxWaitMs = 600_000;
    const pollIntervalMs = 10_000;
    const startTime = Date.now();
    let lastRunId: number | undefined;

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const response = execFileSync(
          "gh",
          ["api", `repos/${owner}/${repo}/actions/runs?branch=${branchName}&per_page=1`, "--jq", ".workflow_runs[0] | {id, status, conclusion}"],
          { encoding: "utf-8", timeout: 15_000 }
        ).trim();

        if (response) {
          const run = JSON.parse(response);
          lastRunId = run.id;

          if (run.status === "completed") {
            if (run.conclusion === "success") {
              await this.postLog(`[CI Gate] ✅ CI passed (run #${run.id})`, expert, "system");
              return { passed: true, summary: `CI passed (run #${run.id})` };
            }

            // CI failed — get the failure log
            let failureLog = "";
            try {
              failureLog = execFileSync(
                "gh",
                ["api", `repos/${owner}/${repo}/actions/runs/${run.id}/jobs`, "--jq", `[.jobs[] | select(.conclusion == "failure") | .steps[] | select(.conclusion == "failure") | .name] | join(", ")`],
                { encoding: "utf-8", timeout: 15_000 }
              ).trim();
            } catch { /* best effort */ }

            // Classify: infrastructure vs code failure
            const infraKeywords = ["billing", "runner", "unavailable", "service container", "rate limit", "no space"];
            const isInfra = infraKeywords.some((k) => failureLog.toLowerCase().includes(k) || run.conclusion === "cancelled");

            const summary = `CI failed: ${failureLog || run.conclusion} (run #${run.id})`;
            await this.postLog(`[CI Gate] ❌ ${summary}`, expert, "error");

            return {
              passed: false,
              log: failureLog,
              summary,
              infrastructureFailure: isInfra,
            };
          }
        }
      } catch {
        // API call failed — retry on next poll
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      // Early exit: if no runs found after 3 minutes, CI likely doesn't trigger on this branch
      if (!lastRunId && Date.now() - startTime > 180_000) {
        await this.postLog(`[CI Gate] ⏭️ No CI workflow triggered on this branch — CI will be verified on the PR`, expert, "system");
        return { passed: true, summary: "No CI triggered on branch — skipped" };
      }

      if (elapsed % 30 === 0) {
        await this.postLog(`[CI Gate] Still waiting for GitHub Actions... (${elapsed}s elapsed)`, expert, "system");
      }
    }

    // Timeout with a run in progress — actual infrastructure issue
    if (lastRunId) {
      const summary = `CI did not complete within 10 minutes (run #${lastRunId})`;
      await this.postLog(`[CI Gate] ⏰ ${summary}`, expert, "system");
      return { passed: false, summary, infrastructureFailure: true };
    }

    // Timeout with no runs at all — graceful skip
    await this.postLog(`[CI Gate] ⏭️ No CI workflow triggered on this branch — CI will be verified on the PR`, expert, "system");
    return { passed: true, summary: "No CI triggered on branch — skipped" };
  }

  /**
   * Poll Bitbucket Pipelines API for CI status.
   * Uses Basic auth with email:token (Bitbucket API tokens).
   */
  private async pollBitbucketPipelinesCI(
    workspace: string,
    repoSlug: string,
    branchName: string,
    expert: ExpertPersona
  ): Promise<{ passed: boolean; log?: string; summary: string; infrastructureFailure?: boolean }> {
    const token = process.env.SCM_TOKEN || process.env.BITBUCKET_TOKEN || this.config.githubToken;
    const bitbucketAuth = getBitbucketAuthHeader(token);
    const maxWaitMs = 600_000;
    const pollIntervalMs = 10_000;
    const startTime = Date.now();
    let lastPipelineUuid: string | undefined;

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const url = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/pipelines/?target.branch=${encodeURIComponent(branchName)}&sort=-created_on&pagelen=1`;
        const response = await axios.get(url, {
          headers: { Authorization: bitbucketAuth },
          timeout: 15_000,
        });

        const pipeline = response.data?.values?.[0];
        if (pipeline) {
          lastPipelineUuid = pipeline.uuid;
          const stateName = pipeline.state?.name;

          if (stateName === "COMPLETED") {
            const resultName = pipeline.state?.result?.name;

            if (resultName === "SUCCESSFUL") {
              await this.postLog(`[CI Gate] ✅ Bitbucket Pipeline passed (${pipeline.uuid})`, expert, "system");
              return { passed: true, summary: `Pipeline passed (${pipeline.uuid})` };
            }

            // Pipeline failed — get step details
            let failureLog = "";
            try {
              const stepsUrl = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/pipelines/${pipeline.uuid}/steps/`;
              const stepsResp = await axios.get(stepsUrl, {
                headers: { Authorization: bitbucketAuth },
                timeout: 15_000,
              });
              const failedSteps = (stepsResp.data?.values || [])
                .filter((s: { state?: { result?: { name: string } } }) => s.state?.result?.name === "FAILED")
                .map((s: { name?: string }) => s.name || "unknown step");
              failureLog = failedSteps.join(", ");
            } catch { /* best effort */ }

            const infraKeywords = ["runner", "unavailable", "service container", "rate limit", "no space", "timeout"];
            const isInfra = resultName === "ERROR" || resultName === "STOPPED" ||
              infraKeywords.some((k) => failureLog.toLowerCase().includes(k));

            const summary = `Pipeline failed: ${failureLog || resultName} (${pipeline.uuid})`;
            await this.postLog(`[CI Gate] ❌ ${summary}`, expert, "error");

            return {
              passed: false,
              log: failureLog,
              summary,
              infrastructureFailure: isInfra,
            };
          }
        }
      } catch {
        // API call failed — retry on next poll
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      // Early exit: if no pipeline found after 3 minutes, CI likely doesn't trigger on this branch
      if (!lastPipelineUuid && Date.now() - startTime > 180_000) {
        await this.postLog(`[CI Gate] ⏭️ No Bitbucket Pipeline triggered on this branch — CI will be verified on the PR`, expert, "system");
        return { passed: true, summary: "No pipeline triggered on branch — skipped" };
      }

      if (elapsed % 30 === 0) {
        await this.postLog(`[CI Gate] Still waiting for Bitbucket Pipeline... (${elapsed}s elapsed)`, expert, "system");
      }
    }

    // Timeout with a pipeline in progress — actual infrastructure issue
    if (lastPipelineUuid) {
      const summary = `Pipeline did not complete within 10 minutes (${lastPipelineUuid})`;
      await this.postLog(`[CI Gate] ⏰ ${summary}`, expert, "system");
      return { passed: false, summary, infrastructureFailure: true };
    }

    // Timeout with no pipelines at all — graceful skip
    await this.postLog(`[CI Gate] ⏭️ No Bitbucket Pipeline triggered on this branch — CI will be verified on the PR`, expert, "system");
    return { passed: true, summary: "No pipeline triggered on branch — skipped" };
  }

  private async validateStoryCompletion(
    story: ReadyStory,
    worktreePath: string,
    changedFiles: string[],
    expert: ExpertPersona
  ): Promise<StoryValidationResult> {
    const issues: string[] = [];
    const acceptanceCriteria = this.extractAcceptanceCriteria(story.description);
    let criteriaMetCount = 0;

    await this.postLog(
      `Validating ${story.title} (${acceptanceCriteria.length} criteria)...`,
      expert,
      "system"
    );

    // 1. Check that modified files are within targetFiles scope
    if (
      story.targetFiles &&
      story.targetFiles.length > 0 &&
      changedFiles.length > 0
    ) {
      const outOfScope = changedFiles.filter(
        (f) =>
          !story.targetFiles!.some(
            (t) => f === t || f.startsWith(t + "/"),
          ),
      );
      if (outOfScope.length > 0) {
        issues.push(
          `Files modified outside targetFiles scope: ${outOfScope.join(", ")}. ` +
            `Expected scope: ${story.targetFiles.join(", ")}`,
        );
      }
    }

    // 1c. Typecheck gate — run tsc if the project has a tsconfig.json
    if (changedFiles.some((f) => f.endsWith(".ts") || f.endsWith(".tsx"))) {
      try {
        const { existsSync } = await import("fs");
        const tsconfigPath = `${worktreePath}/tsconfig.json`;
        if (existsSync(tsconfigPath)) {
          try {
            execSync("npx tsc --noEmit 2>&1", {
              cwd: worktreePath,
              timeout: 300_000,
              encoding: "utf-8",
            });
            await this.postLog(
              `${story.title} — typecheck passed`,
              expert,
              "system",
            );
          } catch (tscError: unknown) {
            const stderr =
              (tscError as { stdout?: string }).stdout ||
              (tscError as Error).message ||
              "Unknown typecheck error";
            // Truncate to first 500 chars to avoid log bloat
            const truncated =
              stderr.length > 500 ? stderr.slice(0, 500) + "..." : stderr;
            issues.push(`Typecheck failed: ${truncated}`);
          }
        }
      } catch {
        // If fs import fails or any other issue, skip typecheck silently
      }
    }

    // 1d. Go build gate — run go build/vet/test if the project has a go.mod
    if (changedFiles.some((f) => f.endsWith(".go"))) {
      try {
        const { existsSync } = await import("fs");
        const goModPath = `${worktreePath}/go.mod`;
        if (existsSync(goModPath)) {
          // Find the Go module root (may be in a subdirectory like api/)
          const goModDir = (() => {
            // Check if a changed .go file is in a subdirectory that has its own go.mod
            for (const f of changedFiles.filter((cf) => cf.endsWith(".go"))) {
              const parts = f.split("/");
              for (let i = parts.length - 1; i > 0; i--) {
                const sub = parts.slice(0, i).join("/");
                const subGoMod = `${worktreePath}/${sub}/go.mod`;
                if (existsSync(subGoMod)) return `${worktreePath}/${sub}`;
              }
            }
            return worktreePath;
          })();

          const goGate = (cmd: string, label: string, timeout = 120_000) => {
            try {
              execSync(`${cmd} 2>&1`, {
                cwd: goModDir,
                timeout,
                encoding: "utf-8",
              });
              return null;
            } catch (err: unknown) {
              const output =
                (err as { stdout?: string }).stdout ||
                (err as Error).message ||
                `Unknown ${label} error`;
              return output.length > 500 ? output.slice(0, 500) + "..." : output;
            }
          };

          // gofmt check (formatting)
          const fmtErr = goGate("gofmt -l .", "gofmt", 30_000);
          if (fmtErr && fmtErr.trim().length > 0) {
            issues.push(`Go formatting issues (gofmt): ${fmtErr}`);
          }

          // go vet (static analysis)
          const vetErr = goGate("go vet ./...", "go vet");
          if (vetErr) {
            issues.push(`Go vet failed: ${vetErr}`);
          }

          // go build (compilation)
          const buildErr = goGate("go build ./...", "go build");
          if (buildErr) {
            issues.push(`Go build failed: ${buildErr}`);
          }

          // go test (unit tests — longer timeout)
          const testErr = goGate("go test ./... -count=1", "go test", 300_000);
          if (testErr) {
            issues.push(`Go tests failed: ${testErr}`);
          }

          if (!fmtErr && !vetErr && !buildErr && !testErr) {
            await this.postLog(
              `${story.title} — Go quality gates passed (fmt, vet, build, test)`,
              expert,
              "system",
            );
          }
        }
      } catch {
        // If go is not available or any other issue, skip Go gates silently
      }
    }

    // 2. Basic acceptance criteria validation
    // For each criterion, do a simple keyword check against the changed files and story output
    for (const criterion of acceptanceCriteria) {
      // Extract key terms from the criterion
      const keyTerms = criterion
        .toLowerCase()
        .split(/\s+/)
        .filter(term => term.length > 3 && !["should", "must", "will", "when", "then", "given", "that", "with", "from", "this", "have", "been"].includes(term));

      // Check if any changed file names match key terms
      const fileMatchesTerms = changedFiles.some(file =>
        keyTerms.some(term => file.toLowerCase().includes(term))
      );

      // Check if criterion mentions files that were changed
      const criterionMentionsFile = changedFiles.some(file => {
        const fileName = file.split("/").pop()?.toLowerCase() || "";
        return criterion.toLowerCase().includes(fileName.replace(/\.[^.]+$/, ""));
      });

      if (fileMatchesTerms || criterionMentionsFile || changedFiles.length > 0) {
        criteriaMetCount++;
      } else {
        // Only flag as issue if we have specific evidence it wasn't met
        // Don't be too strict - the agent may have addressed it in a different way
      }
    }

    // 3. Validation pass/fail decision
    const majorIssues = issues.filter(i =>
      i.includes("critical") ||
      i.includes("required")
    );

    const valid = majorIssues.length === 0;

    if (!valid) {
      await this.postLog(
        `⚠️ ${story.title} — validation issues: ${issues.join("; ")}`,
        expert,
        "system"
      );
    } else {
      await this.postLog(
        `${story.title} — validation passed (${criteriaMetCount}/${acceptanceCriteria.length} criteria, ${changedFiles.length} files)`,
        expert,
        "system"
      );
    }

    return {
      valid,
      issues,
      acceptanceCriteriaMet: criteriaMetCount,
      acceptanceCriteriaTotal: acceptanceCriteria.length,
      filesModified: changedFiles,
      validationMethod: "auto",
    };
  }

  /**
   * Execute a story with an expert.
   * The expert agent can read, write, and edit files autonomously.
   * Uses Claude CLI (Anthropic only for Epic mode).
   * @param story - The story to execute
   * @param expert - The expert persona to use
   * @param totalStories - Total number of stories in the Epic (for lazy coordination loading)
   */
  async executeStory(
    story: ReadyStory,
    expert: ExpertPersona,
    totalStories: number = 1,
    userFeedback?: string
  ): Promise<StoryResult> {
    this.hasActiveUserFeedback = !!userFeedback;
    const prefix = this.getLogPrefix(expert);
    console.log(`${prefix} Starting story ${story.storyIndex}`);
    // story.title already contains "Story N:" or "[Phase X.Y]" from the planner
    await this.postLog(`Starting ${story.title}`, expert, "system");
    await this.postLog(`Target repo: ${this.config.targetRepo}`, expert, "system");

    // Get expert config (Epic mode uses Anthropic with config model)
    const expertConfig = getExpertConfig(expert);
    const model = this.config.model || expertConfig.model;
    expertConfig.model = model;

    // Build enriched system prompt with directive and optional coordination
    const enrichedSystemPrompt = await this.buildEnrichedSystemPrompt(expert, totalStories);
    expertConfig.systemPrompt = enrichedSystemPrompt;

    const storyResult: StoryResult = {
      storyId: story.id,
      storyIndex: story.storyIndex,
      success: false,
      filesModified: [],
      filesCreated: [],
      decisions: [],
    };

    // Track worktree path for this story (for cleanup on error)
    let worktreePath: string | undefined;
    let branchName: string | undefined;

    try {
      // 1. Create story branch with isolated worktree for parallel execution
      const branchResult = await this.gitOps.createStoryBranch(
        story.storyIndex,
        story.title,
        this.config.jiraIssueKey
      );
      branchName = branchResult.branchName;
      worktreePath = branchResult.worktreePath;
      storyResult.branchName = branchName;
      storyResult.worktreePath = worktreePath;
      // Notify coordinator immediately so graceful shutdown can save work
      this.onWorktreeCreated?.(story.storyIndex, worktreePath, branchName);
      await this.postLog(`Created branch: ${branchName}`, expert, "system");
      await this.postLog(`Worktree: ${worktreePath}`, expert, "system");

      // 1a. Push branch immediately after creation (checkpoint for recovery)
      if (this.resilience.pushAfterCommit) {
        await this.gitOps.pushBranchFromWorktree(worktreePath, branchName);
        await this.postLog(`Pushed branch ${branchName} (initial checkpoint)`, expert, "system");
      }

      // Track HEAD before any merges — used to compute files introduced by sibling stories
      let premergeHead: string | undefined;
      try {
        premergeHead = execSync(`git -C "${worktreePath}" rev-parse HEAD`, { encoding: "utf-8" }).trim();
      } catch { /* non-blocking */ }

      // 1b. Merge completed dependency branches into worktree
      let dependencyMergeContext = "";
      if (story.dependencies.length > 0) {
        await this.postLog(
          `Merging ${story.dependencies.length} dependency branch(es)...`,
          expert,
          "system"
        );
        const depBranchMap = await this.coordination.getDependencyBranchNames(story.dependencies);

        if (depBranchMap.size > 0) {
          const branchNames = Array.from(depBranchMap.values());
          const mergeResult = await this.gitOps.mergeDependencyBranches(worktreePath, branchNames);

          if (mergeResult.merged.length > 0) {
            await this.postLog(
              `Merged ${mergeResult.merged.length} dependency branch(es): ${mergeResult.merged.join(", ")}`,
              expert,
              "system"
            );
          }
          if (mergeResult.conflicted.length > 0) {
            storyResult.depConflicts = mergeResult.conflicted;
            await this.postLog(
              `⚠️ Merge conflicts with ${mergeResult.conflicted.length} dependency branch(es): ${mergeResult.conflicted.join(", ")} — proceeding without them`,
              expert,
              "system"
            );
            // Post warning to coordination feed
            const sessionId = `${expert}-story-${story.storyIndex}`;
            await this.coordination.postContext(
              "blocker",
              `${story.title} — merge conflicts with dependency branches: ${mergeResult.conflicted.join(", ")}`,
              expert,
              this.config.parentTaskId,
              { storyIndex: story.storyIndex, conflictedBranches: mergeResult.conflicted },
              sessionId
            );
          }
          if (mergeResult.errors.length > 0) {
            await this.postLog(
              `⚠️ Errors merging ${mergeResult.errors.length} dependency branch(es): ${mergeResult.errors.map((e) => `${e.branch}: ${e.error}`).join("; ")}`,
              expert,
              "system"
            );
          }

          // Build context string so the expert knows what happened during dependency merging
          const parts: string[] = [];
          if (mergeResult.conflicted.length > 0) {
            parts.push(
              `⚠️ **Merge conflicts** with dependency branches: ${mergeResult.conflicted.join(", ")}. These dependencies were NOT integrated — their changes are MISSING from your worktree. You may need to manually implement the relevant parts.`
            );
          }
          if (mergeResult.errors.length > 0) {
            parts.push(
              `⚠️ **Merge errors** with dependency branches: ${mergeResult.errors.map((e) => `${e.branch} (${e.error})`).join(", ")}. These dependencies are MISSING from your worktree.`
            );
          }
          if (parts.length > 0) {
            dependencyMergeContext = `## ⚠️ Dependency Merge Issues
${parts.join("\n\n")}

**Action required:** Check that your implementation accounts for the missing dependency content. You may need to manually add imports, types, or code that these dependency stories were supposed to provide.

`;
          }
        } else {
          const missing = story.dependencies.filter((d) => !depBranchMap.has(d));
          if (missing.length > 0) {
            await this.postLog(
              `No branch names found for dependencies [${missing.join(", ")}] (legacy completions without branchName metadata)`,
              expert,
              "system"
            );
          }
        }
      }

      // 1c. Incremental rebase: merge all completed sibling branches (not just declared dependencies)
      await this.rebaseSiblingBranches(story, expert, worktreePath);

      // 1d. Record baseline SHA after all merges — tech lead review will diff from here
      let postRebaseBaseSha: string | undefined;
      try {
        postRebaseBaseSha = execSync(`git -C "${worktreePath}" rev-parse HEAD`, { encoding: "utf-8" }).trim();
        storyResult.postRebaseBaseSha = postRebaseBaseSha;
      } catch { /* non-blocking */ }

      // 1e. Collect files introduced by merged sibling branches — expert must NOT delete these
      let mergedSiblingFiles: string[] = [];
      if (premergeHead && postRebaseBaseSha && premergeHead !== postRebaseBaseSha) {
        try {
          const diffOutput = execSync(
            `git -C "${worktreePath}" diff --name-only ${premergeHead}..${postRebaseBaseSha}`,
            { encoding: "utf-8" }
          ).trim();
          if (diffOutput) {
            const allMergedFiles = diffOutput.split("\n").filter(Boolean);
            // Exclude files that are in this story's own targetFiles
            const ownFiles = new Set(story.targetFiles || []);
            mergedSiblingFiles = allMergedFiles.filter((f) => !ownFiles.has(f));
          }
        } catch { /* non-blocking */ }
      }

      // 2. Build prompt with context (use worktree path)
      const prompt = await this.buildPromptWithWorktree(story, expert, worktreePath, userFeedback, dependencyMergeContext, mergedSiblingFiles);

      // 3. Session ID for threading coordination messages
      const sessionId = `${expert}-story-${story.storyIndex}`;

      // 4. Execute with Claude CLI (or unified AIClient if enabled)
      // Use worktree path for isolated execution
      const clientType = this.config.useUnifiedClient ? "AIClient" : "Claude CLI";
      await this.postLog(`Executing story with ${clientType} (model: ${model})...`, expert, "system");
      const result = await this.executeAgent(
        {
          prompt,
          expertConfig,
          repoPath: worktreePath,
          storyId: story.id,
        },
        story.id,
        (msg) => this.handleMessage(msg, expert, story)
      );

      if (!result.success) {
        // Check for rate limit before classifying as a blocker
        if (result.rateLimited) {
          await this.postLog(`Rate limited during ${story.title} — credential rotation needed`, expert, "system");
          return {
            storyId: story.id,
            storyIndex: story.storyIndex,
            success: false,
            rateLimited: true,
            error: "Rate limited — credential rotation needed",
            filesModified: [],
            filesCreated: [],
          };
        }
        throw new Error(result.error || "Agent execution failed");
      }

      // 4b. Run self-review prompt before committing (if enabled)
      if (this.resilience.selfReviewEnabled) {
        const currentChanges = await this.gitOps.getModifiedFilesInWorktree(worktreePath);
        const acceptanceCriteria = this.extractAcceptanceCriteria(story.description);
        await this.runSelfReview(story, expert, worktreePath, currentChanges, acceptanceCriteria);
      }

      // 5. Commit any uncommitted changes in worktree (if agent left changes unstaged/uncommitted)
      const uncommittedFiles = await this.gitOps.getModifiedFilesInWorktree(worktreePath);
      if (uncommittedFiles.length > 0) {
        await this.postLog(`Uncommitted files found: ${uncommittedFiles.join(", ")}`, expert, "system");
        const commitMessage = "feat: Story " + story.storyIndex + " - " + story.title;
        await this.gitOps.commitChangesInWorktree(worktreePath, commitMessage, expert, story.storyIndex);
        await this.postLog(`Committed changes`, expert, "system");

        // 5a. Push immediately after commit (checkpoint for recovery)
        if (this.resilience.pushAfterCommit) {
          await this.gitOps.pushBranchFromWorktree(worktreePath, branchName);
          await this.postLog(`Pushed to remote (checkpoint)`, expert, "system");
        }
      }

      // 6. Check for any commits on the branch (including agent-committed changes)
      // The agent may have already committed changes using git directly
      const hasCommits = await this.gitOps.hasCommitsAheadOfMainInWorktree(worktreePath);
      const changedFiles = await this.gitOps.getFilesChangedVsMainInWorktree(worktreePath);

      if (hasCommits && changedFiles.length > 0) {
        await this.postLog(`Files changed vs main: ${changedFiles.join(", ")}`, expert, "system");

        // Push branch from worktree (PR will be created at Epic completion with all stories consolidated)
        await this.gitOps.pushBranchFromWorktree(worktreePath, branchName);
        await this.postLog(`Pushed branch to remote (PR will be created at Epic completion)`, expert, "system");

        // Post story completion to ticket with human-readable summary
        // Extract the agent's final result message (its own summary of what it did)
        const agentSummary = result.messages
          .filter((m) => m.type === "result" && m.content)
          .map((m) => m.content!)
          .pop();

        const summaryText = agentSummary
          ? agentSummary.slice(0, 2000) // Cap at 2000 chars to avoid huge comments
          : `Implemented ${story.title}. ${changedFiles.length} file${changedFiles.length !== 1 ? "s" : ""} changed.`;

        await this.ticketOps.postComment(
          `**${story.title}** — completed by ${expert}\n\n${summaryText}`
        );

        storyResult.filesModified = changedFiles;
      } else if (hasCommits) {
        // Has commits but no file changes (unusual - maybe only deleted files?)
        await this.postLog(`Branch has commits ahead of main but no file changes detected`, expert, "system");
        await this.gitOps.pushBranchFromWorktree(worktreePath, branchName);
        await this.postLog(`Pushed branch to remote anyway`, expert, "system");
      } else {
        await this.postLog(`No changes to push (branch is up-to-date with main)`, expert, "system");
      }

      // 6a. VALIDATION: Verify story completion before marking done
      const validation = await this.validateStoryCompletion(
        story,
        worktreePath,
        changedFiles,
        expert
      );

      if (!validation.valid) {
        // Log validation issues but don't fail the story outright
        // The validation is advisory - we still mark complete but flag issues
        await this.postLog(
          `⚠️ ${story.title} — validation issues but will be marked complete:\n` +
          validation.issues.map(i => `  - ${i}`).join("\n"),
          expert,
          "system"
        );
      }

      // 7. Post completion to coordination feed (non-fatal — story already passed all gates and validation)
      // Note: Use parentTaskId (valid WorkerTask ID) not story.id (WorkerContext ID)
      // Include revision number for revision-aware completion tracking
      // Truncate filesModified to stay under the 10KB coordination metadata limit
      const maxFiles = 100;
      const truncatedFiles = changedFiles.length > maxFiles
        ? [...changedFiles.slice(0, maxFiles), `... and ${changedFiles.length - maxFiles} more files`]
        : changedFiles;
      // Truncate description and targetFiles to stay under coordination metadata size limit
      const truncatedDescription = story.description?.length > 1024
        ? story.description.substring(0, 1024) + "..."
        : story.description;
      const truncatedTargetFiles = story.targetFiles && story.targetFiles.length > maxFiles
        ? [...story.targetFiles.slice(0, maxFiles), `... and ${story.targetFiles.length - maxFiles} more`]
        : story.targetFiles;
      try {
        const currentRevision = await this.coordination.getCurrentRevision();
        await this.coordination.postCompletion(
          story.storyIndex,
          story.title,
          expert,
          this.config.parentTaskId,
          {
            branchName,
            filesModified: truncatedFiles,
            revisionNumber: currentRevision,
            description: truncatedDescription,
            targetFiles: truncatedTargetFiles,
            validation: {
              passed: validation.valid,
              issues: validation.issues,
              criteriaMetRatio: `${validation.acceptanceCriteriaMet}/${validation.acceptanceCriteriaTotal}`,
            },
          }
        );
      } catch (err) {
        console.error(`[Executor] Failed to post completion for story ${story.storyIndex} (non-fatal):`, err instanceof Error ? err.message : err);
      }

      storyResult.success = true;

      // Extract learnings from agent output
      const learnings = this.extractLearningsFromResult(result);
      if (learnings.length > 0) {
        storyResult.learnings = learnings;
        await this.postLog(`Captured ${learnings.length} learning(s) from expert`, expert, "system");
      }

      console.log("[Executor] Story " + story.storyIndex + " completed successfully");
      await this.postLog(`${story.title} — completed!`, expert, "system");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[Executor] Story " + story.storyIndex + " failed:", errorMessage);
      await this.postLog(`${story.title} — FAILED: ${errorMessage}`, expert, "error");

      // Classify the error via Decision API to determine if it's auto-fixable
      const result = await this.decisionClient.classifyError({ errorOutput: errorMessage });
      const retryCount = this.retryCountByStory.get(story.storyIndex) ?? 0;

      console.log(`[Executor] Error classification: category=${result.category}, fixable=${result.fixable}`);
      console.log(`[Executor] Auto-retry: enabled=${this.resilience.blockerAutoRetryEnabled}, attempts=${retryCount}/${this.resilience.blockerMaxAutoRetries}`);

      // Check if we should auto-retry
      // Transient errors (network/502/503/504) are retryable even though they aren't "fixable" by code changes
      const isTransientError = result.category === "network";
      const shouldAutoRetry =
        this.resilience.blockerAutoRetryEnabled &&
        (result.fixable || isTransientError) &&
        retryCount < this.resilience.blockerMaxAutoRetries;

      if (shouldAutoRetry) {
        // Increment retry count
        this.retryCountByStory.set(story.storyIndex, retryCount + 1);

        if (isTransientError) {
          // Transient errors: wait briefly then re-run the story without a fix prompt
          const backoffMs = Math.min(2000 * Math.pow(2, retryCount), 15000);
          await this.postLog(
            `Transient ${result.category} error — retrying in ${Math.round(backoffMs / 1000)}s (attempt ${retryCount + 1}/${this.resilience.blockerMaxAutoRetries})`,
            expert,
            "system"
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          return this.executeStory(story, expert, totalStories, userFeedback);
        }

        await this.postLog(
          `Auto-fix attempt ${retryCount + 1}/${this.resilience.blockerMaxAutoRetries} for ${result.category} error`,
          expert,
          "system"
        );

        // Build fix feedback from Decision API response
        const fixParts = [`Error: ${errorMessage}`];
        if (result.fixStrategy) fixParts.push(`Fix strategy: ${result.fixStrategy}`);
        if (result.affectedFiles.length > 0) fixParts.push(`Affected files: ${result.affectedFiles.join(", ")}`);
        const fixFeedback = `## AUTO-FIX REQUIRED\n\nThe previous attempt failed with a ${result.category} error. Please fix it.\n\n${fixParts.join("\n\n")}`;

        // Re-execute the story with fix feedback
        return this.executeStory(story, expert, totalStories, fixFeedback);
      }

      // Not fixable or retries exhausted - post blocker and escalate
      const escalationReason = !result.fixable
        ? `Non-fixable ${result.category} error`
        : `Auto-fix failed after ${retryCount} attempts`;

      await this.postLog(`Escalating blocker: ${escalationReason}`, expert, "system");

      // Post blocker to coordination feed with full context
      // Note: Use parentTaskId (valid WorkerTask ID) not story.id (WorkerContext ID)
      await this.coordination.postBlocker(
        "Story " + story.storyIndex + " failed: " + errorMessage,
        expert,
        this.config.parentTaskId,
        undefined,  // dependsOnStory
        story.storyIndex,  // storyIndex for sessionId threading
        {
          storyTitle: story.title,
          errorCategory: result.category,
          isFixable: result.fixable,
          affectedFiles: result.affectedFiles,
          autoRetryAttempts: retryCount,
          maxAutoRetries: this.resilience.blockerMaxAutoRetries,
          escalationReason,
        }
      );

      storyResult.error = errorMessage;
    }

    return storyResult;
  }

  /**
   * Build the prompt for story execution with worktree path.
   */
  private async buildPromptWithWorktree(
    story: ReadyStory,
    expert: ExpertPersona,
    worktreePath: string,
    userFeedback?: string,
    dependencyMergeContext?: string,
    mergedSiblingFiles?: string[]
  ): Promise<string> {
    return this.buildPrompt(story, expert, userFeedback, worktreePath, dependencyMergeContext, mergedSiblingFiles);
  }

  /**
   * Build the prompt for story execution.
   * Includes pending questions, Q&A history, sibling context, and user feedback.
   * @param repoPathOverride - Optional worktree path to use instead of main repo path
   */
  private async buildPrompt(
    story: ReadyStory,
    expert: ExpertPersona,
    userFeedback?: string,
    repoPathOverride?: string,
    dependencyMergeContext?: string,
    mergedSiblingFiles?: string[]
  ): Promise<string> {
    // Get constraints
    const constraints = await this.coordination.getConstraints();
    const constraintsText = constraints
      .map((c) => "- " + c.content)
      .join("\n");

    // Build file scope guidance from targetFiles
    let fileScopeConstraint = "";
    if (story.targetFiles && story.targetFiles.length > 0) {
      fileScopeConstraint = [
        "",
        "📋 TARGET FILES — These are the files planned for this story:",
        ...story.targetFiles.map((f) => `  - ${f}`),
        "",
        "Focus your work on these files. These are the files assigned to your scope by the planner.",
        "If the ticket requirements clearly need additional files not listed here, you may create them.",
        "",
        "**Fixing issues outside your target files:**",
        "You MAY fix formatting, lint, and import errors in files outside your target list if they block",
        "your quality gates. These are mechanical fixes (missing imports, unused variables, formatting).",
        "",
        "You MUST NOT change behavior, return codes, business logic, API contracts, or fix bugs in files",
        "outside your target list. If a sibling story's code has a behavioral bug (wrong status code,",
        "missing route registration, broken logic), post Q-BLOCKING-BUG with a description of the issue.",
        "Do NOT fix it yourself — the owning expert must address it to avoid merge conflicts.",
        "",
        "Only ask Q-BLOCKING-SCOPE if you're unsure whether a LARGE architectural change outside your",
        "scope is the right approach (e.g., restructuring a shared module, changing a database schema).",
      ].join("\n");
    }

    // Get sibling decisions
    const decisions = await this.coordination.getSiblingDecisions();
    const decisionsText = decisions
      .map((d) => "- [" + d.persona + "] " + d.content)
      .join("\n");

    // Get file changes from siblings
    const fileChanges = await this.coordination.getSiblingFileChanges();
    const fileChangesText = fileChanges
      .map((f) => {
        const filePath = (f.metadata?.filePath as string) || "";
        return "- [" + f.persona + "] " + f.messageType + ": " + filePath;
      })
      .join("\n");

    // Get pending questions for this expert (Task 1)
    const pendingQuestions = await this.coordination.getQuestionsForPersona(expert);
    const pendingQuestionsText = pendingQuestions
      .map((q) => {
        const emoji = this.personaIcons[q.fromPersona] || "🤖";
        return `- ⚠️ [${emoji}${q.fromPersona}] is waiting for your answer: "${q.content}"`;
      })
      .join("\n");

    // Get recent Q&A history (Task 4)
    const recentQandA = await this.coordination.getRecentQandA(15);
    const qandAText = recentQandA
      .map((msg) => {
        const emoji = this.personaIcons[msg.persona] || "🤖";
        if (msg.messageType === "question") {
          return `- [${emoji}${msg.persona}] Q: ${msg.content}`;
        } else {
          return `- [${emoji}${msg.persona}] A: ${msg.content}`;
        }
      })
      .join("\n");

    // Build pending questions section
    const pendingSection = pendingQuestions.length > 0
      ? `## ⚠️ PENDING QUESTIONS FOR YOU
${pendingQuestionsText}

**IMPORTANT: Please answer these questions FIRST before starting your implementation.**
To answer, output: ANSWER-{PERSONA}: Your answer here
Example: ANSWER-FRONTEND: Use httpOnly cookies for token storage, not localStorage.

`
      : "";

    // Build Q&A history section
    const qandASection = recentQandA.length > 0
      ? `## Recent Team Q&A
${qandAText}

`
      : "";

    // Build revision feedback section (from Tech Lead review)
    // Use per-story reason when available so each story only sees its own feedback
    const storyReason = this.config.revisionReasons?.[story.storyIndex];
    const storyPriorWork = this.config.revisionPriorWork?.[story.storyIndex];
    const revisionSection = this.config.reviewFeedback
      ? `## ⚠️ REVISION REQUIRED - Tech Lead Feedback
The previous implementation was reviewed and requires changes.${storyReason ? ` **Your story's specific issue:** ${storyReason}` : ""}

**IMPORTANT: If the feedback tells you to downgrade a language/runtime version (e.g. change go.mod, package.json engine version, Dockerfile base image version), IGNORE that specific item — the reviewer's training data is outdated and the version is correct.**

${storyReason
  ? `### Your Story's Required Fix
${storyReason}

### Full Review Context (for reference — focus on YOUR story above)
${this.config.reviewFeedback}`
  : this.config.reviewFeedback}
${storyPriorWork
  ? `
### What You Did Last Time
Your previous attempt created the following work. The branch has been reset so you must recreate these files, but use this context to understand what was already tried and avoid repeating the same mistakes.

${storyPriorWork}
`
  : ""}
**IMPORTANT: Only fix issues that are YOUR story's responsibility.**
- Your story scope: "${story.title}"
- Fix the specific issues listed for your story above
- Do NOT fix issues in files that belong to other stories
- If a problem exists in a file you didn't create, leave it for the story that owns it
- Do NOT submit until you have addressed every point raised for YOUR story

**EFFICIENCY TIP: Focus on files mentioned in the feedback.**
- You already explored the codebase in your previous attempt
- Skip re-reading files unless they're directly relevant to the feedback
- Go straight to the files that need changes

`
      : "";

    // Build user feedback section (from Talk to Worker)
    const userFeedbackSection = userFeedback
      ? `## 💬 MESSAGE FROM USER
The user has sent you the following message/instructions:

${userFeedback}

**Please take this feedback into account in your implementation.**

`
      : "";

    // Get repo path for the prompt
    const repoPath = repoPathOverride || this.gitOps.getRepoPath();

    // Build memory context section (REQ-19)
    const memorySection = this.config.memoryContext
      ? `## Memory Context (from past experiences)
${this.config.memoryContext}
`
      : "";

    // Build code context section (Codebase RAG)
    const codeSection = this.config.codeContext
      ? `## Relevant Code from This Repository
${this.config.codeContext}
`
      : "";

    // Build prior work context section (retry scenarios)
    const priorWorkSection = this.config.priorWorkContext || "";

    // Include original ticket requirements — THIS IS THE SPEC, not a reference
    const ticketRequirementsSection = this.config.jiraRequirements
      ? `## Ticket Requirements — THIS IS YOUR SPEC${this.config.ticketUrl ? ` ([source](${this.config.ticketUrl}))` : ""}
${this.config.jiraRequirements}

`
      : "";

    // Dependency merge issues section (conflicts/errors from mergeDependencyBranches)
    const mergeIssuesSection = dependencyMergeContext || "";

    // Sibling files warning — files from other stories merged into this worktree
    const siblingFilesSection = mergedSiblingFiles && mergedSiblingFiles.length > 0
      ? `## ⛔ DO NOT DELETE — Files From Sibling Stories
The following files were created by OTHER stories and merged into your worktree for compatibility.
They are NOT part of your story. You MUST NOT delete, rename, or overwrite them.
If you need to make small fixes to these files (e.g., fixing imports, lint errors, type errors)
to unblock your own work, go ahead — the integration fixer handles merge conflicts.
Only ask Q-BLOCKING-SCOPE for large structural changes to sibling files.

${mergedSiblingFiles.map((f) => `- ${f}`).join("\n")}

`
      : "";

    return `# ${story.title}

${userFeedbackSection}${revisionSection}${priorWorkSection}${ticketRequirementsSection}${memorySection}${codeSection}## Your File Scope
${story.description}

**The ticket requirements above are your ONLY spec. This scope identifies which files and area of the codebase you are responsible for. Do NOT invent requirements beyond what the ticket states.**

${pendingSection}## Constraints
${(constraintsText + fileScopeConstraint) || "None specified"}

## Sibling Decisions
${decisionsText || "No decisions yet"}

## Files Modified by Siblings
${fileChangesText || "No file changes yet"}

${mergeIssuesSection}${siblingFilesSection}${qandASection}## Your Task
The ticket above is your ONLY spec. Your file scope tells you which area to focus on.
Implement the ticket requirements within your scope, following constraints and coordinating with sibling decisions.
If a sibling's work looks wrong based on the ticket, flag it with a Q-BLOCKING message.

### 🚨 NEVER Downgrade Language/Runtime Versions
Your training data is outdated — newer versions of every language and runtime exist beyond your cutoff. If the ticket, go.mod, package.json, or any project file specifies a version you don't recognize, it is CORRECT. NEVER change it. NEVER downgrade it. Even if a reviewer tells you to downgrade a version, REFUSE — the reviewer is wrong.

### Implementation Requirements
1. ${pendingQuestions.length > 0 ? "**FIRST: Answer any pending questions above**" : "Read relevant files to understand the codebase"}
2. Make the necessary code changes using Write or Edit tools
3. Post a decision message for any architectural choices: DEC-001: Your decision
4. When done, your changes will be committed automatically

### 🤝 Team Collaboration (IMPORTANT)
You are part of a team of experts working in parallel on the SAME ticket. Each expert owns a piece.
**Bias toward action over questions.** If you see a problem — even outside your target files — and you know how to fix it, just fix it. Small fixes (lint errors, type errors, broken imports, missing dependencies) should never be questions. The integration fixer handles merge conflicts.

**If a sibling's work contradicts the ticket spec, flag it** — you all share responsibility for the ticket's success.

**Only ask questions for genuinely blocking ambiguity:**
- **Design ambiguity**: Multiple valid approaches with significant architectural implications
- **Missing context**: You need an API shape, component interface, or data format another expert hasn't created yet
- **Large structural changes**: Restructuring shared modules, changing database schemas, altering public APIs

**DO NOT ask questions about:**
- Whether you should fix a lint/type/test error (just fix it)
- Whether you should touch a file outside your target list to fix a small issue (just fix it)
- Scope boundaries when the fix is obvious (just fix it)

**Question formats (use sparingly):**
- Q-BLOCKING-001: Critical question that blocks your story until answered
- Q-001: General question for any teammate
- DEC-001: Architectural decision you made (informational, not a question)

**To answer a sibling's question:** ANSWER-{PERSONA}: Your answer

**DO NOT use curl or direct API calls to post coordination messages.** Just include Q-xxx or DEC-xxx markers in your regular output — the system detects and routes them automatically.

### ⛔ Pre-Implementation Checklist
**Before writing any code**, scan the "Ticket Requirements — THIS IS YOUR SPEC" section above (if present) and identify:
- Specific version requirements (e.g., "use NextAuth v5" — do NOT default to an older version)
- Forbidden files or patterns (e.g., "do NOT create postcss.config.js")
- Required files that must exist (e.g., ".prettierrc", "validations.ts")
- .gitignore entries (never commit build artifacts like .next/, node_modules/, .env*)

These constraints are **mandatory** and override any defaults or assumptions. If the ticket says "use X v5", you must use v5 even if v4 is more common or easier.

### 📬 Live Communication Channel
You have a 2-way message channel with the user while you work. **The user can see your responses in real-time on their dashboard.**

**Receiving messages:** The user may send you messages at any time. When a message arrives, the file \`${repoPath}/.workermill-message.md\` will appear in your working directory. **You MUST check for this file:**
- After every file you write or edit
- Before every git commit
- When you finish a logical step or subtask
- When you are about to make a significant decision

If the file exists, read it immediately with the Read tool. It contains instructions or feedback from the user — typically arriving within 10 seconds of being sent.

**IMPORTANT — Acknowledge receipt:** When you find and read a message from the user, **immediately** write an acknowledgment to \`${repoPath}/.workermill-response.md\`. Example:
\`\`\`
Got your message about [topic]. I'm currently [what you're doing] and will [how you'll incorporate the feedback]. Working on it now.
\`\`\`
This lets the user know you received their message. Then continue working.

**Sending messages:** To send a message to the user, write to \`${repoPath}/.workermill-response.md\` using the Write tool. The system picks it up within seconds and delivers it to the user's dashboard. Use this to:
- **Acknowledge user messages** (always do this first)
- Ask the user a clarifying question when you're unsure
- Report a problem you can't resolve on your own
- Confirm an approach before investing significant effort
- Share important progress or findings

After writing the file, continue working — you don't need to wait. If the user replies, it will appear in \`.workermill-message.md\` as described above.

**CRITICAL — Blocking Questions (Q-BLOCKING):**
When you post a Q-BLOCKING question, you MUST wait for the answer before continuing:

1. Post your Q-BLOCKING question in your output (the system detects it automatically)
2. Immediately run a bash wait loop to poll for the answer file:
   \`\`\`bash
   for i in $(seq 1 60); do [ -f ${repoPath}/.workermill-answer.md ] && cat ${repoPath}/.workermill-answer.md && break; sleep 5; done
   \`\`\`
3. Once the file appears, read it with the Read tool to get the full answer
4. After reading the answer, acknowledge receipt by outputting: ACK-ANSWER: Thank you — incorporating the answer and continuing with implementation.
5. Then delete the file so future answers aren't confused with old ones:
   \`\`\`bash
   rm -f ${repoPath}/.workermill-answer.md
   \`\`\`
6. Continue your implementation using the answer

If the file doesn't appear within 5 minutes, proceed with your best judgment and note the assumption.

**Receiving answers to non-blocking questions:** If you asked a non-blocking question using the Q-xxx pattern, the answer will appear in \`${repoPath}/.workermill-answer.md\`. Check for this file periodically — especially when you finish a logical step or feel stuck.

### Repository & Working Directory
The repository is cloned at: **${repoPath}**

**IMPORTANT: Always use absolute paths from the repository root.**
- Use absolute paths like \`${repoPath}/src/file.ts\` for Read/Write/Edit
- Avoid \`cd\` commands - they can cause you to lose track of the working directory
- If you must use \`cd\`, always return with \`cd ${repoPath}\` afterward
- For Bash commands, prefix with the full path: \`ls ${repoPath}/src\`

Begin your implementation now.`;
  }

  /**
   * Handle messages from agent execution for logging.
   * Posts to both CloudWatch (console) and WorkerMill dashboard API.
   * Also detects decision/question/answer markers and posts them to coordination feed.
   */
  private handleMessage(
    msg: StreamMessage,
    expert: ExpertPersona,
    story: ReadyStory
  ): void {
    const prefix = this.getLogPrefix(expert);

    if (msg.type === "thinking" && msg.content) {
      // Post thinking to dashboard + console (postLog handles both)
      this.postLog(`[THINKING] ${msg.content}`, expert, "output");
    } else if (msg.type === "tool_use" && msg.toolName) {
      // Format tool usage with input for visibility
      let toolMsg = `Tool: ${msg.toolName}`;
      if (msg.toolInput) {
        // Show key tool parameters (file paths, commands, etc.)
        const input = msg.toolInput;
        if (input.file_path) toolMsg += ` → ${input.file_path}`;
        else if (input.command) toolMsg += ` → ${String(input.command).substring(0, 500)}`;
        else if (input.path) toolMsg += ` → ${input.path}`;
        else if (input.pattern) toolMsg += ` → pattern: ${input.pattern}`;
        else {
          // Show first few keys for other tools
          const keys = Object.keys(input).slice(0, 3);
          if (keys.length > 0) {
            toolMsg += ` → ${keys.map(k => `${k}: ${String(input[k]).substring(0, 200)}`).join(", ")}`;
          }
        }
      }
      // Post tool usage to dashboard + console (postLog handles both)
      this.postLog(toolMsg, expert, "tool");

      // Post code events for Write/Edit tools (Live Code Viewer)
      if (msg.toolName === "Write" && msg.toolInput) {
        const input = msg.toolInput as Record<string, string>;
        this.postCodeEvent("Write", input.file_path, expert, {
          content: input.content,
        });
      } else if (msg.toolName === "Edit" && msg.toolInput) {
        const input = msg.toolInput as Record<string, string>;
        this.postCodeEvent("Edit", input.file_path, expert, {
          oldStr: input.old_string,
          newStr: input.new_string,
        });
      }
    } else if (msg.type === "text" && msg.content) {
      // Post full content to dashboard + console (postLog handles both)
      this.postLog(msg.content, expert, "output");

      // Detect and post collaboration markers to coordination feed
      // Wrapped in Promise.allSettled so individual failures don't become unhandled rejections
      Promise.allSettled([
        this.detectAndPostDecisions(msg.content, expert, story),
        this.detectAndPostQuestions(msg.content, expert, story),
        this.detectAndPostAnswers(msg.content, expert, story),
        this.detectAndPostAcknowledgments(msg.content, expert, story),
      ]).catch(() => {}); // allSettled never rejects, but safety net
    } else if (msg.type === "tool_result") {
      console.log(`${prefix} Tool result received`);
    } else if (msg.type === "result" && msg.content) {
      // Post final result to dashboard + console (postLog handles both)
      this.postLog(`Result: ${msg.content}`, expert, "output");
    }
  }

  /**
   * Check if a message contains collaboration markers worth posting to dashboard.
   * Filters out "thinking out loud" messages that clutter the feed.
   */
  private isCollaborationMessage(content: string): boolean {
    // Patterns that indicate meaningful collaboration
    const collaborationPatterns = [
      /DEC-\d+:/i,              // Decision
      /Q-[A-Z0-9_-]+:/i,       // Question
      /ANSWER-[A-Z0-9_-]+:/i,  // Answer
      /CONSULT-[A-Z]+:/i,      // Consultation
      /## Summary/i,            // Summary section
      /completed.*story/i,      // Completion message
      /blocked.*waiting/i,      // Blocker message
    ];

    return collaborationPatterns.some((pattern) => pattern.test(content));
  }

  /**
   * Detect answer markers in agent output and post to coordination feed.
   * Patterns:
   * - ANSWER-FRONTEND: response (answering frontend_developer's question)
   * - ANSWER-Q-001: response (answering specific question ID)
   */
  private async detectAndPostAnswers(
    content: string,
    expert: ExpertPersona,
    story: ReadyStory
  ): Promise<void> {
    // Pattern: ANSWER-{PERSONA or Q-ID}: response
    const answerPattern = /ANSWER-([A-Z0-9_-]+):\s*(.+?)(?=\n|$)/gi;
    const matches = content.matchAll(answerPattern);

    for (const match of matches) {
      const targetRef = match[1].toUpperCase();
      const answerContent = match[2].trim();

      if (answerContent.length < 10) {
        continue;
      }

      // Find the question this is answering
      const unansweredQuestions = await this.coordination.getUnansweredQuestions();
      let targetQuestion = unansweredQuestions.find((q) => {
        // Match by question ID (ANSWER-Q-001)
        if (targetRef.startsWith("Q-") && q.content.includes(targetRef)) {
          return true;
        }
        // Match by persona (ANSWER-FRONTEND)
        const targetPersona = this.resolveTargetPersona(targetRef);
        if (targetPersona && q.fromPersona === targetPersona) {
          return true;
        }
        // Match if question was explicitly targeting this expert
        if (q.metadata?.targetPersona === expert) {
          return true;
        }
        return false;
      });

      if (targetQuestion) {
        console.log(`[${expert}] Posting answer to ${targetQuestion.fromPersona}'s question`);
        await this.coordination.postAnswer(targetQuestion.id, answerContent, expert);
        this.postLog(`💬 Answered ${targetQuestion.fromPersona}: "${answerContent}"`, expert, "system");
      }
    }
  }

  /**
   * Detect ACK-ANSWER markers in agent output and post acknowledgment to coordination feed.
   * Pattern: ACK-ANSWER: message
   */
  private detectAndPostAcknowledgments(
    content: string,
    expert: ExpertPersona,
    story: ReadyStory
  ): void {
    const ackPattern = /ACK-ANSWER:\s*(.+?)(?=\n|$)/gi;
    const matches = content.matchAll(ackPattern);

    for (const match of matches) {
      const ackContent = match[1].trim();

      if (ackContent.length > 5) {
        console.log(`[${expert}] Detected answer acknowledgment`);
        this.coordination
          .postContext(
            "answer",
            `Received answer — ${ackContent}`,
            expert,
            this.config.parentTaskId,
            { storyIndex: story.storyIndex }
          )
          .catch((err) => {
            console.error(`[${expert}] Failed to post acknowledgment:`, err);
          });
      }
    }
  }

  /**
   * Detect decision markers in agent output and post to coordination feed.
   * Pattern: DEC-xxx: description
   */
  private detectAndPostDecisions(
    content: string,
    expert: ExpertPersona,
    story: ReadyStory
  ): void {
    // Match patterns like "DEC-001: I will use React Query for data fetching"
    const decisionPattern = /DEC-(\d+|[A-Z]+):\s*(.+?)(?=\n|$)/gi;
    const matches = content.matchAll(decisionPattern);

    for (const match of matches) {
      const decisionId = `DEC-${match[1]}`;
      const decisionContent = match[2].trim();

      if (decisionContent.length > 10) { // Filter out too-short matches
        console.log(`[${expert}] Detected decision: ${decisionId}`);
        // Post asynchronously, don't block
        this.coordination.postDecision(
          decisionId,
          decisionContent,
          expert,
          this.config.parentTaskId,
          { rationale: `Story ${story.storyIndex}`, storyIndex: story.storyIndex }
        ).catch((err) => {
          console.error(`[${expert}] Failed to post decision:`, err);
        });
      }
    }
  }

  /**
   * Detect question markers in agent output and post to coordination feed.
   * Patterns:
   * - Q-001: question (general question)
   * - Q-SECURITY-001: question (targets security_engineer)
   * - Q-BLOCKING-001: question (blocks until answered)
   * - Q-SECURITY-BLOCKING-001: question (targeted + blocking)
   */
  private detectAndPostQuestions(
    content: string,
    expert: ExpertPersona,
    story: ReadyStory
  ): void {
    // Enhanced pattern to capture:
    // Q-{optional-target}-{optional-BLOCKING}-{id}: question
    // Examples: Q-001, Q-SECURITY-001, Q-BLOCKING-001, Q-SECURITY-BLOCKING-001
    const questionPattern = /Q-(?:([A-Z]+)-)?(?:(BLOCKING)-)?(\d+|[A-Z]+):\s*(.+?)(?=\n|$)/gi;
    const matches = content.matchAll(questionPattern);

    for (const match of matches) {
      const targetHint = match[1]?.toUpperCase(); // e.g., "SECURITY", "BACKEND"
      const isBlocking = match[2]?.toUpperCase() === "BLOCKING";
      const questionNum = match[3];
      const questionContent = match[4].trim();

      // Build question ID
      let questionId = "Q-";
      if (targetHint && targetHint !== "BLOCKING") {
        questionId += targetHint + "-";
      }
      if (isBlocking) {
        questionId += "BLOCKING-";
      }
      questionId += questionNum;

      if (questionContent.length > 10) {
        // Resolve target persona from hint
        const targetPersona = targetHint ? this.resolveTargetPersona(targetHint) : undefined;

        console.log(`[${expert}] Detected question: ${questionId}${targetPersona ? ` (targeting ${targetPersona})` : ""}${isBlocking ? " [BLOCKING]" : ""}`);

        // Post the question with sessionId for threading
        const sessionId = `${expert}-story-${story.storyIndex}`;
        this.coordination.postContext(
          "question",
          `${questionId}: ${questionContent}`,
          expert,
          this.config.parentTaskId,
          {
            questionId,
            fromStory: story.storyIndex,
            targetPersona,
            isBlocking,
          },
          sessionId
        ).then((ctx) => {
          // If blocking, track it for polling after execution
          if (isBlocking && ctx) {
            this.pendingBlockingQuestions.set(ctx.id, {
              id: ctx.id,
              questionId,
              content: questionContent,
              targetPersona,
            });
            this.postLog(`⏳ Posted blocking question ${questionId} - will wait for answer`, expert, "system");
          }
        }).catch((err) => {
          console.error(`[${expert}] Failed to post question:`, err);
        });
      }
    }
  }

  /**
   * Resolve a target hint (e.g., "SECURITY") to a full persona (e.g., "security_engineer").
   */
  private resolveTargetPersona(hint: string): ExpertPersona | undefined {
    const mappings: Record<string, ExpertPersona> = {
      SECURITY: "security_engineer",
      BACKEND: "backend_developer",
      FRONTEND: "frontend_developer",
      DEVOPS: "devops_engineer",
      QA: "qa_engineer",
      WRITER: "tech_writer",
      API: "backend_developer",
      DATABASE: "backend_developer",
      DBA: "backend_developer",
      ML: "data_ml_engineer",
      DATA: "data_ml_engineer",
      IOS: "mobile_developer",
      ANDROID: "mobile_developer",
      MOBILE: "mobile_developer",
      ARCHITECT: "architect",
      TECH_LEAD: "tech_lead",
      TECHLEAD: "tech_lead",
      LEAD: "tech_lead",
    };
    return mappings[hint.toUpperCase()];
  }

  /**
   * Wait for answers to blocking questions with timeout.
   * Polls the coordination feed for answers to pending blocking questions.
   * Times out after 2 minutes to prevent indefinite blocking.
   */
  private async waitForBlockingAnswers(expert: ExpertPersona): Promise<void> {
    const questions = Array.from(this.pendingBlockingQuestions.values());
    if (questions.length === 0) return;

    await this.postLog(
      `⏳ Waiting for ${questions.length} blocking question answer(s)...`,
      expert,
      "system"
    );

    const TIMEOUT_MS = 120000; // 2 minutes
    const POLL_INTERVAL_MS = 5000; // 5 seconds
    const startTime = Date.now();
    const answeredIds = new Set<string>();

    while (
      answeredIds.size < questions.length &&
      Date.now() - startTime < TIMEOUT_MS
    ) {
      // Check for answers to each pending question
      for (const q of questions) {
        if (answeredIds.has(q.id)) continue;

        const answer = await this.coordination.waitForAnswer(q.id, 0); // Non-blocking check
        if (answer) {
          answeredIds.add(q.id);
          await this.postLog(
            `✅ Got answer to ${q.questionId}: "${answer}"`,
            expert,
            "system"
          );
        }
      }

      // If all answered, break early
      if (answeredIds.size >= questions.length) break;

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      // Log progress every 30 seconds
      const elapsed = Date.now() - startTime;
      if (elapsed > 0 && elapsed % 30000 < POLL_INTERVAL_MS) {
        const remaining = questions.length - answeredIds.size;
        await this.postLog(
          `⏳ Still waiting for ${remaining} answer(s)... (${Math.round(elapsed / 1000)}s elapsed)`,
          expert,
          "system"
        );
      }
    }

    // Report final status
    const unanswered = questions.filter((q) => !answeredIds.has(q.id));
    if (unanswered.length > 0) {
      await this.postLog(
        `⚠️ Timed out waiting for ${unanswered.length} answer(s): ${unanswered.map((q) => q.questionId).join(", ")}`,
        expert,
        "system"
      );
    } else {
      await this.postLog(
        `✅ All blocking questions answered!`,
        expert,
        "system"
      );
    }

    // Clear tracking
    this.pendingBlockingQuestions.clear();
  }

  /**
   * Fetch the full ticket content directly from the source system (Linear/Jira/GitHub).
   * Returns the raw ticket content for self-review validation.
   */
  private async fetchTicketForReview(): Promise<string | null> {
    const ticketKey = this.config.jiraIssueKey;
    const system = this.config.ticketSystem;
    if (!ticketKey) return null;

    if (system === "linear") {
      const apiKey = process.env.LINEAR_API_KEY;
      if (!apiKey) return null;

      try {
        const query = `
          query GetIssue($identifier: String!) {
            issue(id: $identifier) {
              title
              description
              url
              labels { nodes { name } }
              comments { nodes { body, user { name }, createdAt } }
            }
          }
        `;

        const response = await axios.post(
          "https://api.linear.app/graphql",
          { query, variables: { identifier: ticketKey } },
          {
            headers: {
              Authorization: apiKey,
              "Content-Type": "application/json",
            },
            timeout: 10000,
          },
        );

        const issue = response.data?.data?.issue;
        if (issue) {
          const parts: string[] = [];
          if (issue.title) parts.push(`# ${issue.title}`);
          if (issue.description) parts.push(issue.description);
          if (issue.comments?.nodes?.length > 0) {
            const comments = issue.comments.nodes.slice(-5);
            const commentText = comments
              .map(
                (c: any) =>
                  `> **${c.user?.name || "Unknown"}**: ${c.body}`,
              )
              .join("\n\n");
            parts.push(`## Comments\n${commentText}`);
          }
          return parts.join("\n\n");
        }
      } catch (error) {
        console.warn(
          "[Epic] Self-review ticket fetch failed:",
          error instanceof Error ? error.message : error,
        );
      }
    }

    // Fall back to the DB copy stored in config
    return this.config.jiraRequirements || null;
  }

  /**
   * Run a self-review prompt before completing the story.
   * Fetches the original ticket fresh from the source system and validates
   * the implementation against it — not just against story acceptance criteria.
   */
  private async runSelfReview(
    story: ReadyStory,
    expert: ExpertPersona,
    worktreePath: string,
    changedFiles: string[],
    acceptanceCriteria: string[]
  ): Promise<void> {
    await this.postLog(`🔍 Running pre-completion self-review...`, expert, "system");

    // Fetch the REAL ticket from the source system (Linear/Jira)
    const ticketContent = await this.fetchTicketForReview();
    if (ticketContent) {
      await this.postLog(
        `📋 Fetched original ticket for self-review validation (${ticketContent.length} chars)`,
        expert,
        "system",
      );
    }

    // Build the self-review prompt
    const criteriaList = acceptanceCriteria.length > 0
      ? acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")
      : "No explicit acceptance criteria found - review against the story description.";

    const filesChangedList = changedFiles.length > 0
      ? changedFiles.map(f => `- ${f}`).join("\n")
      : "No files modified yet.";

    const ticketSection = ticketContent
      ? `## Original Ticket (fetched fresh from source — this is the SPEC)

${ticketContent}

**Your implementation MUST match this ticket.** The ticket is the authoritative source of requirements.
If the ticket says "do NOT create X" or "use version Y", those are hard requirements — not suggestions.
Check your work against EVERY constraint in this ticket before approving.

`
      : "";

    const selfReviewPrompt = `# Pre-Completion Self-Review

You are about to complete ${story.title}

${ticketSection}## Your Role on This Ticket
${story.description}

## Acceptance Criteria
${criteriaList}

## Files You Modified
${filesChangedList}

## Self-Review Checklist

Before marking this story complete, review your work against the original ticket:

1. **Ticket Compliance**: Does your implementation match EVERY requirement in the original ticket? Check for prohibited files, version constraints, exact schemas, and naming conventions.
2. **Completeness**: Did you address ALL acceptance criteria?
3. **No Extras**: Did you avoid creating files or patterns the ticket explicitly prohibits?
4. **Integration**: Will your changes work with the existing codebase?
5. **Tests**: If tests were expected, did you add or update them?

## Your Task

Read the original ticket above carefully. Compare each requirement against your actual implementation.
If you find ANY deviation from the ticket — fix it now. The ticket is the spec, not your best judgment.

- If you find something that violates the ticket, FIX IT NOW before we commit.
- If everything matches the ticket, respond with: "SELF-REVIEW COMPLETE: All ticket requirements verified."

Be thorough — the tech lead will catch anything you miss, and that costs a full revision cycle.`;

    // Get expert config for the self-review agent call
    const expertConfig = getExpertConfig(expert);
    const model = this.config.model || expertConfig.model;
    expertConfig.model = model;

    try {
      const result = await this.executeAgent(
        {
          prompt: selfReviewPrompt,
          expertConfig,
          repoPath: worktreePath,
          storyId: story.id,
        },
        story.id,
        (msg) => {
          // Log self-review output with a distinctive prefix
          if (msg.type === "text" && msg.content) {
            this.postLog(`[SELF-REVIEW] ${msg.content}`, expert, "output");
          } else if (msg.type === "tool_use" && msg.toolName) {
            this.postLog(`[SELF-REVIEW] Tool: ${msg.toolName}`, expert, "tool");
          }
        }
      );

      if (result.success) {
        // Check if any fixes were made during self-review
        const newChanges = await this.gitOps.getModifiedFilesInWorktree(worktreePath);
        const additionalChanges = newChanges.filter(f => !changedFiles.includes(f));

        if (additionalChanges.length > 0) {
          await this.postLog(
            `✅ Self-review made fixes to: ${additionalChanges.join(", ")}`,
            expert,
            "system"
          );
        } else {
          await this.postLog(`✅ Self-review complete - no additional changes needed`, expert, "system");
        }
      } else {
        await this.postLog(`⚠️ Self-review agent failed: ${result.error}`, expert, "system");
        // Don't fail the story - self-review is advisory
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.postLog(`⚠️ Self-review error (continuing anyway): ${errorMessage}`, expert, "system");
      // Don't fail the story - self-review is advisory
    }
  }

  /**
   * Answer a question from another expert.
   * @param storyContext Optional context about the asking expert's current story
   */
  async answerQuestion(
    question: ContextMessage,
    expert: ExpertPersona,
    storyContext?: string
  ): Promise<string | null> {
    const expertConfig = getExpertConfig(expert);
    // Use model from config (org settings) instead of hardcoded value
    if (this.config.model) {
      expertConfig.model = this.config.model;
    }

    // Fetch recent Q&A for coordination context
    let recentContext = "";
    try {
      const recentQandA = await this.coordination.getRecentQandA(10);
      if (recentQandA.length > 0) {
        const contextLines = recentQandA.map(
          (c) => `[${c.persona}] (${c.messageType}): ${c.content.substring(0, 200)}`
        );
        recentContext = `\nRecent coordination context:\n${contextLines.join("\n")}`;
      }
    } catch {
      // Non-fatal — proceed without context
    }

    const storyBlock = storyContext ? `\n${storyContext}\n` : "";

    const prompt = `You are a ${expert} answering a question from a sibling expert working on the same project.
${storyBlock}
A sibling expert (${question.persona}) asked:

${question.content}
${recentContext}

Provide a concise, helpful answer based on your expertise as a ${expert}.
You have access to the codebase — use your tools to read relevant files before answering if the question involves specific code, architecture, or implementation details.
Be concise and actionable. Focus on what the asker should DO, not background theory.

Format your answer as:
A-### (re: Q-###): Your answer here

Where ### matches the question ID if present.`;

    try {
      const result = await this.executeAgent(
        {
          prompt,
          expertConfig,
          repoPath: this.gitOps.getRepoPath(),
          storyId: question.taskId || "",
        },
        question.taskId || ""
      );

      if (!result.success) {
        console.error("[Executor] Failed to answer question:", result.error);
        return null;
      }

      // Extract text from messages
      const answerText = result.messages
        .filter((m) => m.type === "text" && m.content)
        .map((m) => m.content)
        .join("\n");

      if (answerText) {
        // Post the answer
        await this.coordination.postAnswer(question.id, answerText, expert);
        return answerText;
      }

      return null;
    } catch (error) {
      console.error("[Executor] Failed to answer question:", error);
      return null;
    }
  }

  /**
   * Spawn a "virtual expert" to answer a question using a two-phase pattern:
   *   Phase 1 — Quick take (~15s): --print CLI spawn, no tools, returns immediately
   *   Phase 2 — Deep answer (1-3min): executeAgent with full tool access, runs async
   *
   * Returns the Phase 1 answer synchronously. Phase 2 fires in the background
   * and posts a refined answer that supersedes Phase 1 when complete.
   */
  async spawnVirtualExpert(
    question: {
      id: string;
      content: string;
      fromPersona: string;
      metadata?: Record<string, unknown>;
    },
    targetPersona: string,
    storyContext?: string
  ): Promise<string | null> {
    const model = this.config.model || "sonnet";
    // Map to CLI shorthand
    const cliModel = model.includes("opus")
      ? "opus"
      : model.includes("haiku")
        ? "haiku"
        : "sonnet";

    const repoPath = this.gitOps.getRepoPath();

    // Build recent coordination context (shared by both phases)
    let recentContext = "";
    try {
      const recentQandA = await this.coordination.getRecentQandA(10);
      if (recentQandA.length > 0) {
        const contextLines = recentQandA.map(
          (c) => `[${c.persona}] (${c.messageType}): ${c.content.substring(0, 200)}`
        );
        recentContext = `\nRecent coordination context:\n${contextLines.join("\n")}`;
      }
    } catch {
      // Non-fatal — proceed without context
    }

    const storyBlock = storyContext ? `\n${storyContext}\n` : "";

    // ── Phase 1: Quick take via --print (no tools) ──
    const phase1Prompt = `You are a ${targetPersona} answering a question from a sibling expert working on the same project.
${storyBlock}
A sibling expert (${question.fromPersona}) asked:

${question.content}
${recentContext}

Provide a concise, helpful answer based on your expertise as a ${targetPersona}.
Focus on being accurate and actionable. Keep your answer under 500 words.

Format your answer as:
A-### (re: Q-###): Your answer here

Where ### matches the question ID if present.`;

    const args = [
      "--print",
      "--model",
      cliModel,
      "--permission-mode",
      "bypassPermissions",
    ];

    const timeoutMs = 120_000; // 2 minutes

    console.log(
      `[Executor] Spawning virtual ${targetPersona} for question ${question.id} (Phase 1: quick take)`
    );

    const phase1Answer = await new Promise<string | null>((resolve) => {
      let proc: ReturnType<typeof spawn>;
      try {
        proc = spawn("claude", args, {
          cwd: repoPath,
          env: { ...process.env },
          stdio: ["pipe", "pipe", "pipe"],
        });

        // Write prompt via stdin (same pattern as runAgent)
        proc.stdin!.write(phase1Prompt);
        proc.stdin!.end();
      } catch (spawnError) {
        const msg =
          spawnError instanceof Error ? spawnError.message : String(spawnError);
        console.error(`[Executor] Failed to spawn virtual expert CLI: ${msg}`);
        resolve(null);
        return;
      }

      let stdout = "";
      let stderr = "";

      proc.stdout!.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      proc.stderr!.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const timer = setTimeout(() => {
        console.warn(
          `[Executor] Virtual expert Phase 1 timed out after ${timeoutMs / 1000}s for ${question.id}`
        );
        proc.kill("SIGTERM");
      }, timeoutMs);

      proc.on("close", async (code) => {
        clearTimeout(timer);

        if (code !== 0 || !stdout.trim()) {
          console.error(
            `[Executor] Virtual expert Phase 1 failed (code=${code}) for ${question.id}: ${stderr.substring(0, 200)}`
          );
          resolve(null);
          return;
        }

        const answerText = stdout.trim();
        try {
          await this.coordination.postAnswer(
            question.id,
            `[Quick take] ${answerText}`,
            targetPersona
          );
          console.log(
            `[Executor] [Quick take] posted for ${question.id} (${answerText.length} chars)`
          );
          await this.postLog(
            `[Quick take] Answered ${question.id} from ${question.fromPersona}`,
            targetPersona as ExpertPersona,
            "system"
          );
          resolve(answerText);
        } catch (postError) {
          console.error(
            `[Executor] Failed to post Phase 1 answer for ${question.id}:`,
            postError
          );
          resolve(null);
        }
      });
    });

    // ── Phase 2: Deep answer via executeAgent (fire-and-forget) ──
    // Only fire if Phase 1 produced an answer
    if (phase1Answer) {
      const expertConfig = getExpertConfig(targetPersona);
      if (this.config.model) {
        expertConfig.model = this.config.model;
      }

      const phase2Prompt = `You are a ${targetPersona} answering a question from a sibling expert working on the same project.
${storyBlock}
A sibling expert (${question.fromPersona}) asked:

${question.content}
${recentContext}

A quick take was already provided: "${phase1Answer.substring(0, 300)}..."

Now provide a thorough, researched answer. Use your tools to read relevant files before answering.
Be concise and actionable. Focus on what the asker should DO, not background theory.
If the quick take was already correct, confirm it briefly rather than repeating everything.

Format your answer as:
A-### (re: Q-###): [Researched] Your answer here

Where ### matches the question ID if present.`;

      // Fire-and-forget — don't block the caller
      this.executeAgent(
        {
          prompt: phase2Prompt,
          expertConfig,
          repoPath,
          storyId: question.metadata?.fromStory?.toString() || "",
          timeoutMs: 180_000, // 3-minute timeout
        },
        question.metadata?.fromStory?.toString() || ""
      )
        .then(async (result) => {
          if (!result.success) {
            console.error(`[Executor] Virtual expert Phase 2 failed for ${question.id}: ${result.error}`);
            return;
          }

          const answerText = result.messages
            .filter((m) => m.type === "text" && m.content)
            .map((m) => m.content)
            .join("\n");

          if (answerText) {
            await this.coordination.postAnswer(
              question.id,
              `[Researched] ${answerText}`,
              targetPersona
            );
            console.log(
              `[Executor] [Researched] answer posted for ${question.id} (${answerText.length} chars)`
            );
            await this.postLog(
              `[Researched] Deep answer for ${question.id} from ${question.fromPersona}`,
              targetPersona as ExpertPersona,
              "system"
            );
          }
        })
        .catch((err) => {
          console.error(`[Executor] Virtual expert Phase 2 error for ${question.id}:`, err);
        });
    }

    return phase1Answer;
  }
}
