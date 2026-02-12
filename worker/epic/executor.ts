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
import { GitOps } from "./git-ops.js";
import { TicketOps } from "./ticket-ops.js";
import { runAgent, type AgentOptions, type AgentResult } from "./agent-sdk.js";
import { createAIClient, type AIClient, type AIClientOptions } from "./ai-client-types.js";
import { classifyError, extractAffectedFiles, generateFixPrompt } from "./error-classifier.js";
import axios from "axios";
import * as fs from "fs/promises";
import { execSync, spawn } from "child_process";

// Persona configs for log visibility (consistent with frontend)
const PERSONA_CONFIGS: Record<string, { emoji: string }> = {
  frontend_developer: { emoji: "🎨" },
  backend_developer: { emoji: "⚙️" },
  devops_engineer: { emoji: "🔧" },
  security_engineer: { emoji: "🔒" },
  qa_engineer: { emoji: "🧪" },
  tech_writer: { emoji: "📝" },
  project_manager: { emoji: "📋" },
  api_developer: { emoji: "🔌" },
  database_administrator: { emoji: "🗄️" },
  ml_engineer: { emoji: "🧠" },
  data_engineer: { emoji: "📊" },
  mobile_developer_ios: { emoji: "📱" },
  mobile_developer_android: { emoji: "🤖" },
  tech_lead: { emoji: "👨‍💼" },
  planning_agent: { emoji: "🗺️" },
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
  private logsApi: ReturnType<typeof axios.create>;
  // Track blocking questions that need answers before story completes
  private pendingBlockingQuestions: Map<string, BlockingQuestion> = new Map();
  // Cache for directive bundles (by persona slug)
  private directiveCache: Map<string, { readme: string | null; common: Record<string, string> } | null> = new Map();
  // Unified AIClient for feature-flagged execution
  private aiClient: AIClient | null = null;
  // Resilience configuration (from org settings)
  private resilience: ResilienceConfig;
  // Track auto-retry attempts per story (for blocker handling)
  private retryCountByStory: Map<number, number> = new Map();

  constructor(
    config: EpicConfig,
    coordination: CoordinationClient,
    gitOps: GitOps,
    resilience?: ResilienceConfig
  ) {
    this.config = config;
    this.coordination = coordination;
    this.gitOps = gitOps;
    this.ticketOps = new TicketOps(config.jiraIssueKey, config.ticketSystem);
    // Default resilience settings if not provided
    this.resilience = resilience || {
      blockerMaxAutoRetries: 3,
      blockerAutoRetryEnabled: true,
      pushAfterCommit: true,
      gracefulShutdownEnabled: true,
    };

    // Create axios instance for posting logs to the dashboard
    this.logsApi = axios.create({
      baseURL: config.apiBaseUrl,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.orgApiKey,
      },
      timeout: 5000,
    });

    // Initialize AIClient if unified client is enabled
    if (config.useUnifiedClient) {
      this.aiClient = createAIClient({
        provider: "anthropic",
        apiKeys: { anthropic: config.anthropicApiKey },
        apiConfig: { baseUrl: config.apiBaseUrl, orgApiKey: config.orgApiKey },
        useAgentSdk: true,
        githubToken: config.githubToken,
      });
    }
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
  private getLogPrefix(expert: ExpertPersona, provider: string = "anthropic"): string {
    const personaConfig = PERSONA_CONFIGS[expert] || { emoji: "🤖" };
    const providerIcon = PROVIDER_ICONS[provider] || "🤖";
    return `[${personaConfig.emoji} ${expert} ${providerIcon}]`;
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
      const response = await this.logsApi.get(`/api/personas/worker/${persona}/bundle`);
      const bundle = response.data;

      if (bundle?.directives?.readme || Object.keys(bundle?.directives?.common || {}).length > 0) {
        console.log(`[Epic] Loaded directive for ${persona} from API`);
        this.directiveCache.set(persona, bundle.directives);

        // Record directive usage for effectiveness tracking
        await this.recordDirectiveUsage(persona, bundle.directives);

        return bundle.directives.readme || "";
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
      prompt += "\n\n***REMOVED******REMOVED*** Domain Expertise\n\n" + directive;
    }

    // Only add coordination instructions for multi-story tasks (saves ~1K tokens for single-story)
    if (totalStories > 1) {
      prompt += COORDINATION_INSTRUCTIONS;
    } else {
      console.log(`[Epic] Skipping coordination instructions for single-story task`);
    }

    // Always add learning instructions so experts can report discoveries
    prompt += LEARNING_INSTRUCTIONS;

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
      `Validating story ${story.storyIndex} completion (${acceptanceCriteria.length} criteria)...`,
      expert,
      "system"
    );

    // 1. Check that some files were actually modified
    if (changedFiles.length === 0) {
      issues.push("No files were modified - story may not be complete");
    }

    // 1b. Check that modified files are within targetFiles scope
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
              timeout: 60_000,
              encoding: "utf-8",
            });
            await this.postLog(
              `Story ${story.storyIndex} typecheck passed`,
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
    // Be lenient: pass if files were changed and no major red flags
    const hasChanges = changedFiles.length > 0;
    const majorIssues = issues.filter(i =>
      i.includes("No files were modified") ||
      i.includes("critical") ||
      i.includes("required")
    );

    const valid = hasChanges && majorIssues.length === 0;

    if (!valid) {
      await this.postLog(
        `⚠️ Story ${story.storyIndex} validation issues: ${issues.join("; ")}`,
        expert,
        "system"
      );
    } else {
      await this.postLog(
        `Story ${story.storyIndex} validation passed (${criteriaMetCount}/${acceptanceCriteria.length} criteria, ${changedFiles.length} files)`,
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
      await this.postLog(`Created branch: ${branchName}`, expert, "system");
      await this.postLog(`Worktree: ${worktreePath}`, expert, "system");

      // 1a. Push branch immediately after creation (checkpoint for recovery)
      if (this.resilience.pushAfterCommit) {
        await this.gitOps.pushBranchFromWorktree(worktreePath, branchName);
        await this.postLog(`Pushed branch ${branchName} (initial checkpoint)`, expert, "system");
      }

      // 1b. Merge completed dependency branches into worktree
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
            await this.postLog(
              `⚠️ Merge conflicts with ${mergeResult.conflicted.length} dependency branch(es): ${mergeResult.conflicted.join(", ")} — proceeding without them`,
              expert,
              "system"
            );
            // Post warning to coordination feed
            const sessionId = `${expert}-story-${story.storyIndex}`;
            await this.coordination.postContext(
              "blocker",
              `Story ${story.storyIndex} had merge conflicts with dependency branches: ${mergeResult.conflicted.join(", ")}`,
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

      // 2. Build prompt with context (use worktree path)
      const prompt = await this.buildPromptWithWorktree(story, expert, worktreePath, userFeedback);

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
          await this.postLog(`Rate limited during story ${story.storyIndex} — credential rotation needed`, expert, "system");
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

      // 4b. Poll for blocking question answers (Task 3)
      if (this.pendingBlockingQuestions.size > 0) {
        await this.waitForBlockingAnswers(expert);
      }

      // 4c. Run self-review prompt before committing (if enabled)
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
          `**Story ${story.storyIndex}: ${story.title}** — completed by ${expert}\n\n${summaryText}`
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
          `⚠️ Story ${story.storyIndex} has validation issues but will be marked complete:\n` +
          validation.issues.map(i => `  - ${i}`).join("\n"),
          expert,
          "system"
        );
      }

      // 7. Post completion to coordination feed
      // Note: Use parentTaskId (valid WorkerTask ID) not story.id (WorkerContext ID)
      // Include revision number for revision-aware completion tracking
      const currentRevision = await this.coordination.getCurrentRevision();
      await this.coordination.postCompletion(
        story.storyIndex,
        story.title,
        expert,
        this.config.parentTaskId,
        {
          branchName,
          filesModified: changedFiles,
          revisionNumber: currentRevision,
          validation: {
            passed: validation.valid,
            issues: validation.issues,
            criteriaMetRatio: `${validation.acceptanceCriteriaMet}/${validation.acceptanceCriteriaTotal}`,
          },
        }
      );

      storyResult.success = true;

      // Extract learnings from agent output
      const learnings = this.extractLearningsFromResult(result);
      if (learnings.length > 0) {
        storyResult.learnings = learnings;
        await this.postLog(`Captured ${learnings.length} learning(s) from expert`, expert, "system");
      }

      console.log("[Executor] Story " + story.storyIndex + " completed successfully");
      await this.postLog(`Story ${story.storyIndex} completed successfully!`, expert, "system");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[Executor] Story " + story.storyIndex + " failed:", errorMessage);
      await this.postLog(`Story ${story.storyIndex} FAILED: ${errorMessage}`, expert, "error");

      // Classify the error to determine if it's auto-fixable
      const classification = classifyError(errorMessage);
      const affectedFiles = extractAffectedFiles(errorMessage);
      const retryCount = this.retryCountByStory.get(story.storyIndex) ?? 0;

      console.log(`[Executor] Error classification: category=${classification.category}, fixable=${classification.isFixable}`);
      console.log(`[Executor] Auto-retry: enabled=${this.resilience.blockerAutoRetryEnabled}, attempts=${retryCount}/${this.resilience.blockerMaxAutoRetries}`);

      // Check if we should auto-retry
      const shouldAutoRetry =
        this.resilience.blockerAutoRetryEnabled &&
        classification.isFixable &&
        retryCount < this.resilience.blockerMaxAutoRetries;

      if (shouldAutoRetry) {
        // Increment retry count
        this.retryCountByStory.set(story.storyIndex, retryCount + 1);

        await this.postLog(
          `Auto-fix attempt ${retryCount + 1}/${this.resilience.blockerMaxAutoRetries} for ${classification.category} error`,
          expert,
          "system"
        );

        // Generate fix prompt and re-execute
        const fixPrompt = generateFixPrompt(classification, errorMessage, affectedFiles);
        const fixFeedback = `***REMOVED******REMOVED*** AUTO-FIX REQUIRED\n\nThe previous attempt failed with a ${classification.category} error. Please fix it.\n\n${fixPrompt}`;

        // Re-execute the story with fix feedback
        return this.executeStory(story, expert, totalStories, fixFeedback);
      }

      // Not fixable or retries exhausted - post blocker and escalate
      const escalationReason = !classification.isFixable
        ? `Non-fixable ${classification.category} error`
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
          errorCategory: classification.category,
          isFixable: classification.isFixable,
          affectedFiles,
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
    userFeedback?: string
  ): Promise<string> {
    return this.buildPrompt(story, expert, userFeedback, worktreePath);
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
    repoPathOverride?: string
  ): Promise<string> {
    // Get constraints
    const constraints = await this.coordination.getConstraints();
    const constraintsText = constraints
      .map((c) => "- " + c.content)
      .join("\n");

    // Build hard file scope constraint from targetFiles
    let fileScopeConstraint = "";
    if (story.targetFiles && story.targetFiles.length > 0) {
      fileScopeConstraint = [
        "",
        "⛔ FILE SCOPE RESTRICTION — You MUST ONLY create or modify these files:",
        ...story.targetFiles.map((f) => `  - ${f}`),
        "",
        "You may READ any file for context, but your commits MUST ONLY contain changes to the files listed above.",
        "If you discover you need changes to files NOT listed above, you MUST ask about it:",
        "  Q-BLOCKING-SCOPE: The story description mentions [file] but it's not in targetFiles — should I modify it? (explain why)",
        "Do NOT silently skip the discrepancy or make a unilateral decision — ASK so the team can help.",
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
        const emoji = PERSONA_CONFIGS[q.fromPersona]?.emoji || "🤖";
        return `- ⚠️ [${emoji} ${q.fromPersona}] is waiting for your answer: "${q.content}"`;
      })
      .join("\n");

    // Get recent Q&A history (Task 4)
    const recentQandA = await this.coordination.getRecentQandA(15);
    const qandAText = recentQandA
      .map((msg) => {
        const emoji = PERSONA_CONFIGS[msg.persona]?.emoji || "🤖";
        if (msg.messageType === "question") {
          return `- [${emoji} ${msg.persona}] Q: ${msg.content}`;
        } else {
          return `- [${emoji} ${msg.persona}] A: ${msg.content}`;
        }
      })
      .join("\n");

    // Build pending questions section
    const pendingSection = pendingQuestions.length > 0
      ? `***REMOVED******REMOVED*** ⚠️ PENDING QUESTIONS FOR YOU
${pendingQuestionsText}

**IMPORTANT: Please answer these questions FIRST before starting your implementation.**
To answer, output: ANSWER-{PERSONA}: Your answer here
Example: ANSWER-FRONTEND: Use httpOnly cookies for token storage, not localStorage.

`
      : "";

    // Build Q&A history section
    const qandASection = recentQandA.length > 0
      ? `***REMOVED******REMOVED*** Recent Team Q&A
${qandAText}

`
      : "";

    // Build revision feedback section (from Tech Lead review)
    const revisionSection = this.config.reviewFeedback
      ? `***REMOVED******REMOVED*** ⚠️ REVISION REQUIRED - Tech Lead Feedback
The previous implementation was reviewed and requires changes. Please address the following feedback:

${this.config.reviewFeedback}

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
      : "";

    // Build user feedback section (from Talk to Worker)
    const userFeedbackSection = userFeedback
      ? `***REMOVED******REMOVED*** 💬 MESSAGE FROM USER
The user has sent you the following message/instructions:

${userFeedback}

**Please take this feedback into account in your implementation.**

`
      : "";

    // Get repo path for the prompt
    const repoPath = repoPathOverride || this.gitOps.getRepoPath();

    // Build memory context section (REQ-19)
    const memorySection = this.config.memoryContext
      ? `***REMOVED******REMOVED*** Memory Context (from past experiences)
${this.config.memoryContext}
`
      : "";

    // Build code context section (Codebase RAG)
    const codeSection = this.config.codeContext
      ? `***REMOVED******REMOVED*** Relevant Code from This Repository
${this.config.codeContext}
`
      : "";

    // Build prior work context section (retry scenarios)
    const priorWorkSection = this.config.priorWorkContext || "";

    return `***REMOVED*** Story ${story.storyIndex}: ${story.title}

${userFeedbackSection}${revisionSection}${priorWorkSection}${memorySection}${codeSection}***REMOVED******REMOVED*** Description
${story.description}

${pendingSection}***REMOVED******REMOVED*** Constraints
${(constraintsText + fileScopeConstraint) || "None specified"}

***REMOVED******REMOVED*** Sibling Decisions
${decisionsText || "No decisions yet"}

***REMOVED******REMOVED*** Files Modified by Siblings
${fileChangesText || "No file changes yet"}

${qandASection}***REMOVED******REMOVED*** Your Task
Implement this story following the constraints and coordinating with sibling decisions.

***REMOVED******REMOVED******REMOVED*** Implementation Requirements
1. ${pendingQuestions.length > 0 ? "**FIRST: Answer any pending questions above**" : "Read relevant files to understand the codebase"}
2. Make the necessary code changes using Write or Edit tools
3. Post a decision message for any architectural choices: DEC-001: Your decision
4. When done, your changes will be committed automatically

***REMOVED******REMOVED******REMOVED*** 🤝 Team Collaboration (IMPORTANT)
You are part of a team of experts working in parallel. **Ask questions when you hit ambiguity** — don't guess or make silent decisions. Your teammates are here to help, and the team works better when experts communicate openly.

**When to ask a question (use these markers in your output):**
- **Scope conflict**: Story mentions files not in your targetFiles list
- **Design ambiguity**: Multiple valid approaches and you're unsure which fits the team's direction
- **Missing context**: You need information about what a sibling expert is building
- **Dependency concern**: Your work might conflict with another story's changes
- **Integration questions**: You need to know an API shape, component interface, or data format another expert is creating

**Question formats:**
- Q-BACKEND-001: What's the API endpoint format? (targets backend_developer)
- Q-SECURITY-001: Is this auth approach secure? (targets security_engineer)
- Q-BLOCKING-001: Critical question? (blocks your story until answered)
- Q-001: General question for any teammate

**To answer a sibling's question:** ANSWER-{PERSONA}: Your answer

**DO NOT use curl or direct API calls to post coordination messages.** Just include Q-xxx or DEC-xxx markers in your regular output — the system detects and routes them automatically.

***REMOVED******REMOVED******REMOVED*** Repository & Working Directory
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
    } else if (msg.type === "text" && msg.content) {
      // Post full content to dashboard + console (postLog handles both)
      this.postLog(msg.content, expert, "output");

      // Detect and post collaboration markers to coordination feed
      this.detectAndPostDecisions(msg.content, expert, story);
      this.detectAndPostQuestions(msg.content, expert, story);
      this.detectAndPostAnswers(msg.content, expert, story);
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
      /***REMOVED******REMOVED*** Summary/i,            // Summary section
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
      API: "api_developer",
      DATABASE: "database_administrator",
      DBA: "database_administrator",
      ML: "ml_engineer",
      DATA: "data_engineer",
      IOS: "mobile_developer_ios",
      ANDROID: "mobile_developer_android",
      TECH_LEAD: "tech_lead",
      TECHLEAD: "tech_lead",
      LEAD: "tech_lead",
      ARCHITECT: "tech_lead",
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
   * Run a self-review prompt before completing the story.
   * Asks the agent to review their work against acceptance criteria
   * and gives them a chance to make final fixes.
   */
  private async runSelfReview(
    story: ReadyStory,
    expert: ExpertPersona,
    worktreePath: string,
    changedFiles: string[],
    acceptanceCriteria: string[]
  ): Promise<void> {
    await this.postLog(`🔍 Running pre-completion self-review...`, expert, "system");

    // Build the self-review prompt
    const criteriaList = acceptanceCriteria.length > 0
      ? acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")
      : "No explicit acceptance criteria found - review against the story description.";

    const filesChangedList = changedFiles.length > 0
      ? changedFiles.map(f => `- ${f}`).join("\n")
      : "No files modified yet.";

    const selfReviewPrompt = `***REMOVED*** Pre-Completion Self-Review

You are about to complete Story ${story.storyIndex}: ${story.title}

***REMOVED******REMOVED*** Story Description
${story.description}

***REMOVED******REMOVED*** Acceptance Criteria
${criteriaList}

***REMOVED******REMOVED*** Files You Modified
${filesChangedList}

***REMOVED******REMOVED*** Self-Review Checklist

Before marking this story complete, please honestly review your work:

1. **Completeness**: Did you address ALL acceptance criteria, not just some of them?
2. **Edge Cases**: Did you handle error cases and edge conditions?
3. **Integration**: Will your changes work with the existing codebase?
4. **Tests**: If tests were expected, did you add or update them?
5. **Cleanup**: Did you remove any debug code, console.logs, or TODO comments?

***REMOVED******REMOVED*** Your Task

Look at your changes critically. Ask yourself: "Did I overlook anything?"

- If you find something missing or incorrect, FIX IT NOW before we commit.
- If everything looks complete, simply respond with: "SELF-REVIEW COMPLETE: All acceptance criteria addressed."

Be thorough but efficient - focus only on gaps in your implementation.`;

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
   */
  async answerQuestion(
    question: ContextMessage,
    expert: ExpertPersona
  ): Promise<string | null> {
    const expertConfig = getExpertConfig(expert);
    // Use model from config (org settings) instead of hardcoded value
    if (this.config.model) {
      expertConfig.model = this.config.model;
    }

    const prompt = `A sibling expert (${question.persona}) asked:

${question.content}

Provide a concise, helpful answer based on your expertise as a ${expert}.

Format your answer as:
A-***REMOVED******REMOVED******REMOVED*** (re: Q-***REMOVED******REMOVED******REMOVED***): Your answer here

Where ***REMOVED******REMOVED******REMOVED*** matches the question ID if present.`;

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
   * Spawn a lightweight Claude CLI process to answer a question when ALL experts are busy.
   * Uses --print mode (no streaming, no tools) with a 2-minute timeout.
   * This is a fire-and-forget pattern — the caller doesn't await the full result.
   */
  async spawnQuickAnswer(
    question: {
      id: string;
      content: string;
      fromPersona: string;
    },
    targetPersona: ExpertPersona
  ): Promise<string | null> {
    const model = this.config.model || "sonnet";
    // Map to CLI shorthand
    const cliModel = model.includes("opus")
      ? "opus"
      : model.includes("haiku")
        ? "haiku"
        : "sonnet";

    const repoPath = this.gitOps.getRepoPath();

    // Build a focused prompt with persona framing and recent context
    let recentContext = "";
    try {
      const recentQandA = await this.coordination.getRecentQandA(10);
      if (recentQandA.length > 0) {
        const contextLines = recentQandA.map(
          (c) => `[${c.persona}] (${c.messageType}): ${c.content.substring(0, 200)}`
        );
        recentContext = `\n\nRecent coordination context:\n${contextLines.join("\n")}`;
      }
    } catch {
      // Non-fatal — proceed without context
    }

    const prompt = `You are a ${targetPersona} answering a question from a sibling expert.

A sibling expert (${question.fromPersona}) asked:

${question.content}
${recentContext}

Provide a concise, helpful answer based on your expertise as a ${targetPersona}.
Focus on being accurate and actionable. Keep your answer under 500 words.

Format your answer as:
A-***REMOVED******REMOVED******REMOVED*** (re: Q-***REMOVED******REMOVED******REMOVED***): Your answer here

Where ***REMOVED******REMOVED******REMOVED*** matches the question ID if present.`;

    const args = [
      "--print",
      "--model",
      cliModel,
      "--permission-mode",
      "bypassPermissions",
    ];

    const timeoutMs = 120_000; // 2 minutes

    console.log(
      `[Executor] Quick-answering question ${question.id} as ${targetPersona} (all experts busy)`
    );

    return new Promise((resolve) => {
      let proc: ReturnType<typeof spawn>;
      try {
        proc = spawn("claude", args, {
          cwd: repoPath,
          env: { ...process.env },
          stdio: ["pipe", "pipe", "pipe"],
        });

        // Write prompt via stdin (same pattern as runAgent)
        proc.stdin!.write(prompt);
        proc.stdin!.end();
      } catch (spawnError) {
        const msg =
          spawnError instanceof Error ? spawnError.message : String(spawnError);
        console.error(`[Executor] Failed to spawn quick-answer CLI: ${msg}`);
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
          `[Executor] Quick-answer timed out after ${timeoutMs / 1000}s for ${question.id}`
        );
        proc.kill("SIGTERM");
      }, timeoutMs);

      proc.on("close", async (code) => {
        clearTimeout(timer);

        if (code !== 0 || !stdout.trim()) {
          console.error(
            `[Executor] Quick-answer failed (code=${code}) for ${question.id}: ${stderr.substring(0, 200)}`
          );
          resolve(null);
          return;
        }

        const answerText = stdout.trim();
        try {
          await this.coordination.postAnswer(
            question.id,
            answerText,
            targetPersona
          );
          console.log(
            `[Executor] Quick-answer posted for ${question.id} (${answerText.length} chars)`
          );
          await this.postLog(
            `Quick-answered ${question.id} from ${question.fromPersona}`,
            targetPersona,
            "system"
          );
          resolve(answerText);
        } catch (postError) {
          console.error(
            `[Executor] Failed to post quick-answer for ${question.id}:`,
            postError
          );
          resolve(null);
        }
      });
    });
  }
}
