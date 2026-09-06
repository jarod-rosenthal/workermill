import type { UsageSummary } from "../cost-tracker.js";
import type { RepositoryFingerprintResult, VerifiedRepositoryFingerprint } from "../repository-fingerprint.js";
import type { QualityGateResult } from "./gates.js";
import type { ReviewOutcome } from "./review.js";

export interface OrchestrationOutput {
  /** Log a message from a persona */
  log: (persona: string, message: string) => void;
  /** Log a coordinator message */
  coordinatorLog: (message: string) => void;
  /** Log an error */
  error: (message: string) => void;
  /** Show a status/spinner message (replaces ora) */
  status: (message: string) => void;
  /** Stop the spinner/status */
  statusDone: (message?: string) => void;
  /** Ask the user a yes/no question. Returns true for yes. */
  confirm: (prompt: string) => Promise<boolean | { allowed: boolean; mode?: "always" | "trust" }>;
  /** Ask the user a free-text question with a suggested answer. Returns the user's answer or the suggestion on timeout/skip. */
  askText?: (question: string, suggestion: string) => Promise<string>;
  /** Wait while orchestration is paused. */
  waitIfPaused?: () => Promise<void>;
  /** Pause orchestration and wait until resumed. */
  requestPause?: () => Promise<void>;
  /** Log a tool call */
  toolCall: (persona: string, toolName: string, toolInput: Record<string, unknown>) => void;
  /** Update the git branch displayed in the status bar */
  updateBranch?: (branch: string) => void;
  /** Update running cost in the UI (optional — noop if not provided) */
  updateCost?: (cost: number) => void;
  /** Update usage summary in the UI (optional — noop if not provided) */
  updateUsageSummary?: (summary: UsageSummary) => void;
  /** Update tokens-per-second for a model (optional — noop if not provided) */
  updateTokPerSec?: (providerModel: string, tokPerSec: number) => void;
  /** Notify live view of file changes (optional — noop if not provided) */
  onFileChange?: (persona: string, storyIndex: number, storyTitle: string, filePath: string, tool: "created" | "edited") => void;
}

export interface Story {
  id: string;       // Short kebab-case slug
  title: string;
  persona: string;
  description: string;
  dependsOn?: string[];  // References to other story IDs
  // Enriched fields from planner's codebase analysis
  targetFiles?: string[];      // Files to create or modify
  referenceFiles?: string[];   // Existing files to read for patterns
  primaryPattern?: string;     // Canonical existing file to follow
  integrationPoints?: string[]; // Exact seams where this work attaches
  assumptions?: string[];      // Planner assumptions, not confirmed facts
  nonGoals?: string[];         // Explicit scope boundaries
  implementationNotes?: string; // Planner's architectural guidance
  validationSignal?: string;   // Observable condition that proves this story is complete
  requiredFiles?: string[];
  requiredTests?: string[];
  requiredCommands?: string[];
  // Shell commands to verify acceptance criteria post-execution (verifyEnabled only)
  verificationCommands?: string[];
}

export type FailureCode =
  | "missing_required_file"
  | "missing_required_test"
  | "missing_required_command"
  | "test_only_in_excluded_suite"
  | "required_command_failed"
  | "worker_no_output"
  | "review_blocker_unresolved"
  | "review_stale_vs_head";

export interface StoryContractIssue {
  code: FailureCode;
  storyId: string;
  title: string;
  message: string;
  path?: string;
  command?: string;
}

export interface ReviewMustFixItem {
  id: string;
  storyNumber?: number;
  summary: string;
  blockingEvidence?: string;
  actionableFix?: string;
  signature: string;
}

export interface SharedContext {
  filesCreated: string[];
  filesModified: string[];
  decisions: string[];
  learnings: string[];
}

/** Result from a completed (or failed) orchestration — used by /retry. */
export interface OrchestrationResult {
  stories: Story[];
  completedStoryIds: string[];
  featureBranch: string | null;
  userTask: string;
  mainBranch?: string;
  /** Final hooks changed source after verified publication, so retry remains available. */
  completionInvalidated?: boolean;
}

/** Retry plan — skips planning, resumes from first incomplete story. */
export interface RetryPlan {
  stories: Story[];
  completedStoryIds: string[];
  featureBranch: string;
  mainBranch: string;
}

export interface StandaloneReviewResult {
  score: number;
  decision: "approved" | "revision_needed" | "rejected";
  feedback: string;
  reviewText: string;
}

/** Evidence that must still describe the repository when publication begins. */
export interface CompletionEvidence {
  fingerprint: VerifiedRepositoryFingerprint;
  gateResults: QualityGateResult[];
  reviewOutcome: ReviewOutcome;
}

export function fingerprintsMatch(
  expected: VerifiedRepositoryFingerprint,
  actual: RepositoryFingerprintResult,
): actual is VerifiedRepositoryFingerprint {
  return actual.verified && actual.head === expected.head && actual.digest === expected.digest;
}
