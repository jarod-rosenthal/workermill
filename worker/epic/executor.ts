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
import { getExpertConfig } from "./experts.js";
import { CoordinationClient } from "./coordination-client.js";
import { GitOps, getBitbucketAuthHeader } from "./git-ops.js";
import { PromptBuilder } from "./prompt-builder.js";
import { TicketOps } from "./ticket-ops.js";
import { runAgent, type AgentOptions, type AgentResult } from "./agent-sdk.js";
import { createAIClient, type AIClient, type AIClientOptions, type AIProvider } from "./ai-client-types.js";
import type { DecisionClient } from "./decision-client.js";
import { CollaborationDetector } from "./collaboration-detector.js";
import { validateStoryCompletion, rebaseSiblingBranches, extractLearningsFromResult } from "./story-validator.js";
import { createRetryableApi } from "./api-retry.js";
import axios from "axios";
import { createLogsApi } from "../lib/api-client.js";
import * as fs from "fs/promises";
import { existsSync } from "fs";
import { execSync, execFileSync, spawn } from "child_process";

// Persona and provider icons are loaded from the Decision API at runtime
// via setIcons() called by the coordinator after getWorkerConfig().

/**
 * Story executor using Claude Agent SDK.
 */
export class StoryExecutor {
  private coordination: CoordinationClient;
  private gitOps: GitOps;
  private ticketOps: TicketOps;
  private config: EpicConfig;
  private logsApi: ReturnType<typeof createRetryableApi>;
  // Collaboration detection (questions, answers, decisions, acknowledgments)
  private collaborationDetector: CollaborationDetector;
  // Prompt builder (extracted from executor — handles system prompts + story prompts)
  private promptBuilder: PromptBuilder;
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

    // Initialize PromptBuilder with shared dependencies
    this.promptBuilder = new PromptBuilder(config, coordination, gitOps, this.logsApi);

    // Initialize CollaborationDetector with callbacks
    this.collaborationDetector = new CollaborationDetector(
      config,
      coordination,
      (message, expert, type) => this.postLog(message, expert, type),
      (toolName, filePath, expert, data) => this.postCodeEvent(toolName, filePath, expert, data)
    );

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
    this.promptBuilder.personaIcons = personaIcons;
    this.promptBuilder.providerIcons = providerIcons;
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
    this.promptBuilder.serverCoordinationInstructions = this.serverCoordinationInstructions;
    this.promptBuilder.serverLearningInstructions = this.serverLearningInstructions;
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

  // ─── Quality Gate Methods ─────────────────────────────────────────────────

  /**
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
    const enrichedSystemPrompt = await this.promptBuilder.buildEnrichedSystemPrompt(expert, totalStories);
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
      await rebaseSiblingBranches(story, expert, worktreePath, this.coordination, this.gitOps, this.resilience, (msg, exp, type) => this.postLog(msg, exp, type));

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
      const prompt = await this.promptBuilder.buildPromptWithWorktree(story, expert, worktreePath, userFeedback, dependencyMergeContext, mergedSiblingFiles);

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
        (msg) => this.collaborationDetector.handleMessage(msg, expert, story, this.getLogPrefix(expert))
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
        const acceptanceCriteria = this.promptBuilder.extractAcceptanceCriteria(story.description);
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
      const validation = await validateStoryCompletion(
        story,
        worktreePath,
        changedFiles,
        expert,
        this.promptBuilder,
        (msg, exp, type) => this.postLog(msg, exp, type)
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
      const learnings = extractLearningsFromResult(result.messages);
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
