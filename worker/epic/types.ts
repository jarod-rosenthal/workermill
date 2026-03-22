/**
 * Epic Executor Types
 *
 * Shared type definitions for the Epic multi-agent execution service.
 * Handles story-based execution with Claude Agent SDK.
 */

/**
 * Get the display label for the current ticket system.
 * Uses TICKET_SYSTEM env var or falls back to the provided ticketSystem config.
 */
export function getTicketLabel(ticketSystem?: string): string {
  const system = ticketSystem || process.env.TICKET_SYSTEM || "internal";
  switch (system) {
    case "jira": return "Jira";
    case "linear": return "Linear";
    case "github": return "Issue";
    default: return "Ticket";
  }
}

/**
 * Expert persona identifier — dynamically loaded from API.
 * System defaults: frontend_developer, backend_developer, security_engineer, etc.
 * Custom personas: any slug created in PersonaStudio.
 */
export type ExpertPersona = string;

/**
 * Configuration for an expert subagent.
 */
export interface ExpertConfig {
  persona: ExpertPersona;
  description: string;
  systemPrompt: string;
  tools: string[];
  model: string;
  specialties: string[];
}

/**
 * State of an expert in the Epic executor.
 */
export interface ExpertState {
  persona: ExpertPersona;
  status: "idle" | "working" | "blocked" | "completed";
  currentStoryId?: string;
  currentStoryIndex?: number;
  startedAt?: Date;
}

/**
 * Story from the coordination feed that is ready for claiming.
 */
export interface ReadyStory {
  id: string;
  parentTaskId: string;
  storyIndex: number;
  persona: ExpertPersona;
  title: string;
  description: string;
  dependencies: number[];
  jiraIssueKey?: string;
  /** Files this story will modify - used for mutex group detection */
  targetFiles?: string[];
  /** Mutex groups this story belongs to - stories in same group run sequentially */
  mutexGroups?: string[];
}

/**
 * Context message from the coordination feed.
 */
export interface ContextMessage {
  id: string;
  parentTaskId: string;
  taskId?: string;
  persona: string;
  messageType: ContextMessageType;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export type ContextMessageType =
  | "constraints"
  | "file_created"
  | "file_modified"
  | "decision"
  | "dependency"
  | "question"
  | "answer"
  | "completion"
  | "blocker"
  | "blocker_detected"   // Escalated blocker from API
  | "blocker_resolved"   // User resolved a blocker (retry/skip/abort)
  | "warning"
  | "progress"
  | "story_ready"
  | "story_claimed"
  | "consultation"  // Targeted expert consultation (CONSULT-PERSONA: question?)
  | "revision_requested"  // Tech Lead requested revision with feedback
  | "user_message"       // User message from dashboard (Talk to Worker)
  | "worker_ack"         // Worker acknowledgment of user message
  | "expert_response"    // Expert mid-execution message to user (via .workermill-response.md)
  | "rate_limited";      // Provider rate/usage limit reached

/**
 * Question from the coordination feed that needs answering.
 */
export interface PendingQuestion {
  id: string;
  parentTaskId: string;
  fromPersona: string;
  content: string;
  createdAt: string;
  metadata?: {
    questionId?: string;
    targetPersona?: string;
    fromStory?: number;
    isBlocking?: boolean;
    options?: string[];
    recommendation?: string;
  };
}

/**
 * Decision posted to the coordination feed.
 */
export interface Decision {
  id: string;
  decisionId: string;
  content: string;
  rationale?: string;
  impacts?: string[];
  status: "proposed" | "accepted" | "superseded";
  isTentative: boolean;
}

/**
 * Story execution result from an expert.
 */
export interface StoryResult {
  storyId: string;
  storyIndex: number;
  success: boolean;
  prUrl?: string;
  filesModified?: string[];
  filesCreated?: string[];
  decisions?: Decision[];
  error?: string;
  learnings?: string[];
  /** Story failed due to rate limit — should rotate credentials and retry */
  rateLimited?: boolean;
  /** Branch name created by executor (for coordinator tracking) */
  branchName?: string;
  /** Worktree path used for isolated execution */
  worktreePath?: string;
  /** Git SHA after dependency/sibling merges — baseline for scoped review diff */
  postRebaseBaseSha?: string;
  /** Dependency branches that had merge conflicts (missing from worktree) */
  depConflicts?: string[];
}

/**
 * Epic executor configuration from environment.
 * Epic mode uses Anthropic/Claude CLI exclusively.
 */
export interface EpicConfig {
  parentTaskId: string;
  apiBaseUrl: string;
  orgApiKey: string;
  anthropicApiKey: string;
  githubToken: string;
  /** Separate GitHub token for PR reviews (to avoid self-approval restriction) */
  githubReviewerToken?: string;
  targetRepo: string;
  model?: string;
  /** AI provider for worker execution (anthropic, openai, google, ollama) */
  workerProvider?: string;
  jiraIssueKey?: string;
  /** Which ticket system to use for comments (jira, linear, github, internal) */
  ticketSystem?: "jira" | "linear" | "github" | "internal";
  /** Jira issue requirements (summary + description) for reviewing against */
  jiraRequirements?: string;
  /** Direct URL to the source ticket (for expert reference) */
  ticketUrl?: string;
  /** If true, PR needs manager review before deployment (review label) */
  reviewEnabled?: boolean;
  /** If true, auto-deploy after PR is merged (deploy label) */
  deploymentEnabled?: boolean;
  /** If true, this is a child task of a PRD decomposition */
  prdChildTask?: boolean;
  /** If true, run improvement analysis after task completes (improve label) */
  improvementEnabled?: boolean;
  /** Feedback from previous manager review (for revision runs) */
  reviewFeedback?: string;
  /** Per-story revision reasons from Tech Lead (keyed by story index) */
  revisionReasons?: Record<number, string>;
  /** Per-story prior work summaries captured before branch deletion (keyed by story index) */
  revisionPriorWork?: Record<number, string>;
  /** If true, bypass quality gate checks (bypass-quality-gate label) */
  qualityGateBypass?: boolean;
  /** If true, this is a foundation card (position 0) — skip integration fixer but pass gates to reviewer */
  isFoundationCard?: boolean;
  /** Pre-commit quality gate commands from board metadata (extracted from PRD) */
  qualityGateCommands?: {
    name: string;
    trigger?: string;
    commands: string[];
  }[];
  /** CI workflow path for post-push verification (from board metadata) */
  ciWorkflowPath?: string;
  /** Quality gate thresholds from organization settings */
  qualityThresholds?: {
    qualityGateEnabled: boolean;
    minQualityScore: number | null;
    minTestCoveragePercent: number | null;
    maxSecurityHighVulns: number | null;
    blockOnTypeErrors: boolean;
    blockOnTestFailures: boolean;
    blockOnLintErrors: boolean;
    blockOnE2EFailures: boolean;
    autoFixEnabled: boolean;
    autoFixMaxIterations: number;
  };
  /** Task summary for memory context retrieval (REQ-19) */
  taskSummary?: string;
  /** Memory context formatted for injection into prompts (REQ-19) */
  memoryContext?: string;
  /** Prior work context formatted for injection into prompts (retry scenarios) */
  priorWorkContext?: string;
  /** Codebase context - relevant code snippets from the repository (Codebase RAG) */
  codeContext?: string;
  /** If true, use unified AIClient interface instead of direct runAgent calls */
  useUnifiedClient?: boolean;
  /** Maximum number of expert subagents that can run in parallel */
  maxParallelExperts?: number;
  /** Max retries for fix agents (integration fixer + CI fixer). From org settings. */
  maxFixRetries?: number;
  /** Max turns (tool calls) per agent invocation. From org settings. */
  maxAgentTurns?: number;
  /** Max review revisions for the full Epic PR. From org settings. */
  maxReviewRevisions: number;
  /** Max per-story review revisions before auto-approving. From org settings. */
  maxPerStoryRevisions: number;
  /** Org-level AI guidelines for intent engineering */
  orgGuidelines?: string;
}

/**
 * Result of claiming a story.
 */
export interface ClaimResult {
  success: boolean;
  alreadyClaimed: boolean;
  claimedBy?: string;
}

/**
 * Result of story-level validation.
 * Checks if a story met its acceptance criteria before marking complete.
 */
export interface StoryValidationResult {
  valid: boolean;
  issues: string[];
  acceptanceCriteriaMet: number;
  acceptanceCriteriaTotal: number;
  filesModified: string[];
  validationMethod: "auto" | "agent";
}

/**
 * Result of epic-level validation.
 * Checks if all plan items were addressed before creating PR.
 */
export interface EpicValidationResult {
  valid: boolean;
  missing: string[];
  storiesCompleted: number;
  storiesTotal: number;
  unaddressedRequirements: string[];
}

/**
 * Message from agent execution stream.
 */
export interface StreamMessage {
  type: "text" | "thinking" | "tool_use" | "tool_result" | "result" | "error";
  content?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  /** Structured output from --json-schema (only present on result type) */
  structuredOutput?: Record<string, unknown>;
}

/**
 * Result of agent execution.
 */
export interface AgentResult {
  success: boolean;
  messages: StreamMessage[];
  error?: string;
  /** Final structured output when --json-schema was used */
  structuredOutput?: Record<string, unknown>;
  /** Agent failed due to rate limiting — should rotate credentials and retry */
  rateLimited?: boolean;
}

// ============================================================================
// Error Classification & Blocker Handling Types
// ============================================================================

/**
 * Categories of errors that can occur during story execution.
 * Used to determine if an error is auto-fixable.
 */
export type ErrorCategory =
  | "typescript"  // TypeScript compilation errors
  | "lint"        // ESLint/Prettier errors
  | "test"        // Test failures
  | "build"       // Build/bundler errors
  | "auth"        // Authentication/permission errors (NOT fixable)
  | "auth_transient" // Token revoked/expired — auto-retryable
  | "network"     // Network connectivity issues (NOT fixable)
  | "resource"    // Out of memory, disk space (NOT fixable)
  | "unknown";    // Unclassified errors (NOT fixable)

/**
 * Blocker information posted to coordination feed.
 */
export interface BlockerInfo {
  id: string;
  parentTaskId: string;
  storyIndex: number;
  storyTitle: string;
  persona: ExpertPersona;
  errorCategory: ErrorCategory;
  /** Human-readable summary of what went wrong */
  summary: string;
  /** Full error output (may be long) */
  errorMessage: string;
  affectedFiles: string[];
  autoRetryAttempts: number;
  maxAutoRetries: number;
  dependentStories: number[];
  createdAt: string;
  resolvedAt?: string;
  resolution?: BlockerResolution;
}

/**
 * How a blocker was resolved.
 */
export type BlockerResolution = "retried" | "skipped" | "aborted" | "auto_fixed";

/**
 * User response to a blocker escalation.
 */
export interface BlockerResponse {
  action: "retry" | "skip" | "abort";
  /** Optional guidance for retry attempts */
  guidance?: string;
  /** User who responded */
  respondedBy?: string;
  respondedAt: string;
}

/**
 * Resilience settings passed to worker from organization.
 */
export interface ResilienceConfig {
  /** Maximum auto-fix attempts before escalating to human */
  blockerMaxAutoRetries: number;
  /** Whether auto-retry is enabled for fixable errors */
  blockerAutoRetryEnabled: boolean;
  /** Push to remote after each agent commit */
  pushAfterCommit: boolean;
  /** Enable graceful shutdown on SIGTERM */
  gracefulShutdownEnabled: boolean;
  /** Ask agent to self-review before completing story */
  selfReviewEnabled?: boolean;
  /** Block stories with overlapping targetFiles from running in parallel */
  fileOverlapGatingEnabled?: boolean;
  /** Merge all completed story branches into new worktree before expert starts */
  incrementalRebaseEnabled?: boolean;
  /** Spawn Claude to intelligently resolve rebase conflicts during consolidation */
  mergeAgentEnabled?: boolean;
  /** Timeout in ms for waiting on human blocker resolution (default: 20 min) */
  blockerWaitTimeoutMs?: number;
}

/**
 * Per-story PR state for PR-per-story architecture.
 * Tracks each story's PR lifecycle independently.
 */
export interface StoryPRState {
  storyIndex: number;
  branchName: string;
  prUrl?: string;
  prNumber?: number;
  status:
    | "executing"
    | "pr_created"
    | "reviewing"
    | "approved"
    | "revision_needed"
    | "merged"
    | "failed";
  reviewFeedback?: string;
  revisionCount: number;
}

/**
 * Extended EpicConfig with resilience settings.
 */
export interface EpicConfigWithResilience extends EpicConfig {
  resilience?: ResilienceConfig;
}

/**
 * Structured build report emitted after each epic completes.
 * Captures failure patterns for future decomposition improvement.
 */
export interface BuildReport {
  taskId: string;
  repo: string;
  techStack?: string;
  storyCount: number;
  completedCount: number;
  failedCount: number;
  outcome: "success" | "partial_success" | "failure";
  totalRevisions: number;
  integrationFailures: Array<{
    afterStoryIndex: number;
    gatesFailed: string[];
    rootCause: string;
    fixedBy: "story_revision" | "integration_fixer" | "unfixed";
  }>;
  verificationFailures: Array<{
    storyIndex: number;
    criterion: string;
    reason: string;
  }>;
  timings: {
    totalDurationMs: number;
    storyDurationsMs: Record<number, number>;
  };
}
