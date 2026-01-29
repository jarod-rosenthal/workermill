/**
 * Epic Executor Types
 *
 * Shared type definitions for the Epic multi-agent execution service.
 * Handles story-based execution with Claude Agent SDK.
 */

/**
 * Expert persona types that can participate in Epic collaboration.
 */
export type ExpertPersona =
  | "frontend_developer"
  | "backend_developer"
  | "security_engineer"
  | "qa_engineer"
  | "devops_engineer"
  | "tech_writer"
  | "api_developer"
  | "data_engineer"
  | "database_administrator"
  | "ml_engineer"
  | "mobile_developer_android"
  | "mobile_developer_ios"
  | "tech_lead";

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
  | "warning"
  | "progress"
  | "story_ready"
  | "story_claimed"
  | "consultation"  // Targeted expert consultation (CONSULT-PERSONA: question?)
  | "revision_requested"  // Tech Lead requested revision with feedback
  // Phased execution message types
  | "phase_started"
  | "phase_completed"
  | "phase_failed"
  | "phase_outputs"
  | "phase_checkpoint"
  | "phase_plan_update_requested"
  | "phase_plan_updated"
  | "phased_execution_started"
  | "phased_execution_completed"
  | "phased_execution_failed";

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
  jiraIssueKey?: string;
  /** If true, PR needs manager review before deployment (review label) */
  reviewEnabled?: boolean;
  /** If true, auto-deploy after PR is merged (deploy label) */
  deploymentEnabled?: boolean;
  /** If true, run improvement analysis after task completes (improve label) */
  improvementEnabled?: boolean;
  /** Feedback from previous manager review (for revision runs) */
  reviewFeedback?: string;
  /** If true, use phased execution with fresh context windows (phased label) */
  phasedEnabled?: boolean;
  /** If true, bypass quality gate checks (bypass-quality-gate label) */
  qualityGateBypass?: boolean;
  /** Quality gate thresholds from organization settings */
  qualityThresholds?: {
    qualityGateEnabled: boolean;
    minQualityScore: number | null;
    minTestCoveragePercent: number | null;
    maxSecurityHighVulns: number | null;
    blockOnTypeErrors: boolean;
    blockOnTestFailures: boolean;
  };
  /** Task summary for memory context retrieval (REQ-19) */
  taskSummary?: string;
  /** Memory context formatted for injection into prompts (REQ-19) */
  memoryContext?: string;
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
 * Message from agent execution stream.
 */
export interface StreamMessage {
  type: "text" | "thinking" | "tool_use" | "tool_result" | "result" | "error";
  content?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
}

/**
 * Result of agent execution.
 */
export interface AgentResult {
  success: boolean;
  messages: StreamMessage[];
  error?: string;
}
