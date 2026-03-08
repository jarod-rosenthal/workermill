/**
 * Standard Executor Types
 *
 * Type definitions for the SDK-based standard executor.
 * Reuses EpicConfig from epic module for consistency.
 */

// Re-export types from epic that we need
export type { EpicConfig, StreamMessage, AgentResult, ExpertPersona } from "../epic/dist/types.js";

/**
 * Standard task configuration loaded from environment.
 * Extends EpicConfig with standard-specific fields.
 */
export interface StandardConfig {
  // Core identification
  taskId: string;
  apiBaseUrl: string;
  orgApiKey: string;
  anthropicApiKey: string;
  githubToken: string;
  githubReviewerToken?: string;

  // Task details
  targetRepo: string;
  jiraIssueKey?: string;
  ticketSummary?: string;
  ticketDescription?: string;

  // Persona and model
  persona: string;
  model?: string;

  // Branch configuration
  branchName?: string;
  baseBranch?: string;

  // Workflow flags (from Jira labels or org settings)
  reviewEnabled?: boolean;
  deploymentEnabled?: boolean;
  improvementEnabled?: boolean;

  // Revision limits (from org settings, required)
  maxReviewRevisions: number;
  maxPerStoryRevisions: number;

  // Optional review feedback (for revision runs)
  reviewFeedback?: string;

  // Planning agent outputs (if V2 pipeline)
  targetFiles?: string[];
  referenceFiles?: string[];
}

/**
 * Result of standard task execution.
 */
export interface StandardResult {
  success: boolean;
  prUrl?: string;
  filesModified?: string[];
  filesCreated?: string[];
  error?: string;

  // Token usage for cost tracking
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;

  // Inline phase results
  reviewResult?: "approved" | "revision_needed" | "rejected" | "skipped";
  deployResult?: "deployed" | "failed" | "skipped";
  improveResult?: {
    improvementsApplied: number;
    summary: string;
    changedFiles: string[];
  };
}

/**
 * Expert configuration for the agent.
 */
export interface StandardExpertConfig {
  persona: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  model: string;
  specialties: string[];
}
