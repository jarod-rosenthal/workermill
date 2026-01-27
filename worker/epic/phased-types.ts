/**
 * Phased Story Execution - Type Definitions
 *
 * These types support breaking story execution into discrete phases
 * with fresh context windows and explicit handoff contracts.
 */

// ============================================================
// Phase Types
// ============================================================

export type PhaseType =
  | "analyze" // Read codebase, produce authoritative plan
  | "implement" // Modify files for a specific unit
  | "integrate" // Coherence check after all units
  | "verify" // Run tests, type-check, validate AC
  | "fix" // Address specific issues (always followed by verify)
  | "commit"; // Finalize all changes (squash checkpoint commits)

// ============================================================
// Implementation Units
// ============================================================

/**
 * A bounded work package containing coupled files.
 * Produced by the Analyze phase.
 */
export interface ImplementationUnit {
  index: number;
  name: string; // Human-readable name, e.g., "Auth endpoints"
  files: string[]; // Primary files to modify
  goal: string; // What this unit accomplishes
  dependencies: number[]; // Unit indices that must complete first
  allowedTouchSet: string[]; // Files permitted to edit (superset of files)
  relevantSnippets: RelevantSnippet[]; // Pre-read content for this unit
  estimatedTokens: number;
}

/**
 * Pre-read file content injected into phase prompts
 * to avoid re-reading the same files each phase.
 */
export interface RelevantSnippet {
  filePath: string;
  content: string;
  reason: string; // Why this was included
}

// ============================================================
// Phase Input Bundle (Context Contract)
// ============================================================

/**
 * Deterministic context provided to each phase.
 * Prevents re-discovery of basics each phase.
 */
export interface PhaseInputBundle {
  // === Always included ===
  storyRequirements: StoryRequirements;
  analyzeOutputs: AnalyzeContextSummary;
  repoState: RepoState;

  // === Unit-specific (for implement phases) ===
  unitContext?: UnitContext;

  // === Verify-specific ===
  verifyContext?: VerifyContext;

  // === Fix-specific ===
  fixContext?: FixContext;

  // === Integrate-specific ===
  integrateContext?: IntegrateContext;
}

export interface StoryRequirements {
  storyId: string;
  title: string;
  scope: string;
  acceptanceCriteria: string[];
  persona: string;
}

export interface AnalyzeContextSummary {
  patterns: string[];
  keyDecisions: string[];
  techConstraints: string[];
  totalUnits: number;
}

export interface RepoState {
  gitDiffStat: string; // `git diff --stat` output
  changedFiles: string[]; // Files changed so far
  newFilesCreated: string[]; // Files created this story
  checkpointCommits: string[]; // SHAs of checkpoint commits
}

export interface UnitContext {
  unitIndex: number;
  unitName: string;
  targetFiles: string[]; // Files to modify in this unit
  allowedTouchSet: string[]; // Files permitted to edit
  relevantSnippets: RelevantSnippet[]; // Pre-injected content
  priorUnitDecisions: string[]; // Decisions from completed units
  goal: string;
}

export interface VerifyContext {
  commandsToRun: string[]; // Test commands, type-check, lint
  acceptanceCriteria: string[]; // What to check
  changedFiles: string[]; // Files to focus on
}

export interface FixContext {
  issues: VerifyIssue[]; // Issues to fix
  commandOutputs: CommandOutput[]; // For grounding
  iterationNumber: number; // 1, 2, or 3
  priorFixAttempts: string[]; // What was tried before
}

export interface IntegrateContext {
  allUnitOutputs: ImplementOutputs[]; // From all implement phases
  importExportMap: ImportExportMap; // For coherence
}

export interface ImportExportMap {
  exports: Array<{ file: string; name: string; type: string }>;
  imports: Array<{ file: string; from: string; name: string }>;
}

// ============================================================
// Phase Results
// ============================================================

/**
 * Phase execution result stored in WorkerContext
 */
export interface PhaseResult {
  phaseId: string; // "analyze", "implement-0", "integrate", etc.
  phaseType: PhaseType;
  status: "pending" | "running" | "completed" | "failed";
  startedAt?: Date;
  completedAt?: Date;
  outputs?: PhaseOutputs;
  tokenUsage?: TokenUsage;
  readCount?: number; // Files read (for budget tracking)
  checkpointCommit?: string; // Git SHA if checkpoint created
  error?: string;
}

export type PhaseOutputs =
  | AnalyzeOutputs
  | ImplementOutputs
  | IntegrateOutputs
  | VerifyOutputs
  | FixOutputs;

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

// ============================================================
// Analyze Phase Outputs
// ============================================================

export interface AnalyzeOutputs {
  existingPatterns: string[];
  keyDecisions: string[];
  implementationUnits: ImplementationUnit[];
  additionalFilesNeeded: string[];
  techConstraints: string[];
  estimatedTotalTokens: number;
  testCommands: string[]; // Commands to verify the story
}

// ============================================================
// Implement Phase Outputs
// ============================================================

export interface ImplementOutputs {
  unitIndex: number;
  filesModified: string[];
  filesCreated: string[];
  decisions: string[]; // Decisions for sibling visibility
  exportsAdded: Array<{ file: string; name: string; type: string }>;
  importsNeeded: Array<{ file: string; from: string; name: string }>;
  planUpdateRequest?: PlanUpdateRequest;
}

// ============================================================
// Integrate Phase Outputs
// ============================================================

export interface IntegrateOutputs {
  filesFixed: string[];
  importExportIssuesFixed: number;
  typeIssuesFixed: number;
  indexFilesUpdated: string[];
}

// ============================================================
// Verify Phase Outputs
// ============================================================

export interface VerifyOutputs {
  passed: boolean;
  issues: VerifyIssue[];
  commandOutputs: CommandOutput[];
  testResults?: TestResults;
  typeCheckPassed: boolean;
  lintPassed: boolean;
  acceptanceCriteriaResults: AcceptanceCriteriaResult[];
}

export interface VerifyIssue {
  type: "test_failure" | "type_error" | "lint_error" | "acceptance_gap";
  file?: string;
  line?: number;
  message: string;
  severity: "error" | "warning";
  commandLog?: string; // Truncated log for FIX grounding
}

export interface CommandOutput {
  command: string;
  exitCode: number;
  truncatedLog: string; // Top N lines + error excerpts
  durationMs: number;
}

export interface TestResults {
  passed: number;
  failed: number;
  skipped: number;
}

export interface AcceptanceCriteriaResult {
  criterion: string;
  met: boolean;
  evidence: string;
}

// ============================================================
// Fix Phase Outputs
// ============================================================

export interface FixOutputs {
  issuesAddressed: string[];
  issuesRemaining: string[];
  filesModified: string[];
  iterationNumber: number;
}

// ============================================================
// Plan Update Mechanism
// ============================================================

/**
 * Request from implement phase to modify the plan.
 * Prevents silent divergence from spec.
 */
export interface PlanUpdateRequest {
  reason: string; // Why the plan needs to change
  suggestedNewFiles: string[]; // Files that need to be added
  suggestedRemovals: string[]; // Files that don't need changes
  suggestedNewUnits?: Partial<ImplementationUnit>[]; // New units to add
  risks: string[]; // Risks of the change
  severity: "minor" | "major"; // Minor: auto-approve. Major: mini-analyze.
}

export interface PlanUpdateResponse {
  approved: boolean;
  updatedUnits?: ImplementationUnit[];
  reason: string;
}

// ============================================================
// Phased Execution State
// ============================================================

/**
 * Overall state of phased execution for a story.
 * Stored in WorkerContext for resumability.
 */
export interface PhasedExecutionState {
  storyId: string;
  taskId: string;
  status: "running" | "completed" | "failed";
  currentPhase: PhaseType;
  currentUnitIndex?: number; // For implement phase
  completedPhases: PhaseResult[];
  analyzeResult?: AnalyzeOutputs;
  implementResults: ImplementOutputs[];
  integrateResult?: IntegrateOutputs;
  verifyIterations: VerifyOutputs[];
  fixIterations: FixOutputs[];
  checkpointCommits: string[];
  startedAt: Date;
  completedAt?: Date;
  totalTokens: TokenUsage;
  metrics: PhasedExecutionMetrics;
}

/**
 * Metrics tracked during phased execution.
 * Used for monitoring and optimization.
 */
export interface PhasedExecutionMetrics {
  // Primary metrics
  totalTokensUsed: number;
  phasesCompleted: number;
  verifyPassOnFirstAttempt: boolean;

  // Diagnostic metrics
  redoRateByPhase: Record<PhaseType, number>;
  verifyIssueLocality: {
    currentUnit: number;
    priorUnits: number;
    integration: number;
  };
  contextRediscoveryCost: Record<string, number>; // phaseId -> tokens spent on reads
  planDriftOccurred: boolean;
  timeToFirstGreenMs?: number;
}

// ============================================================
// Token Budgets
// ============================================================

export const PHASE_TOKEN_BUDGETS: Record<PhaseType, number> = {
  analyze: 15000,
  implement: 25000,
  integrate: 15000,
  verify: 20000,
  fix: 20000,
  commit: 5000, // Minimal - mostly deterministic
};

export const PHASE_READ_BUDGETS: Record<PhaseType, number> = {
  analyze: 8, // Discovery phase, needs exploration
  implement: 5, // Beyond pre-injected content
  integrate: 3, // Targeted fixes only
  verify: 2, // Mostly running commands
  fix: 3, // Targeted fixes with command logs
  commit: 0, // No reads needed
};

// ============================================================
// WorkerContext Message Types (additions)
// ============================================================

export type PhasedContextMessageType =
  | "phase_started"
  | "phase_completed"
  | "phase_failed"
  | "phase_outputs"
  | "phase_checkpoint" // Checkpoint commit created
  | "phase_plan_update_requested" // Agent requests plan change
  | "phase_plan_updated" // Orchestrator approved change
  | "phased_execution_started"
  | "phased_execution_completed"
  | "phased_execution_failed";

/**
 * Message payload for phased execution context messages.
 */
export interface PhasedContextMessage {
  type: PhasedContextMessageType;
  storyId: string;
  phaseId?: string;
  phaseType?: PhaseType;
  unitIndex?: number;
  outputs?: PhaseOutputs;
  error?: string;
  checkpointCommit?: string;
  planUpdateRequest?: PlanUpdateRequest;
  planUpdateResponse?: PlanUpdateResponse;
  metrics?: Partial<PhasedExecutionMetrics>;
}
