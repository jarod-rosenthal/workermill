/**
 * Phased Executor - Orchestrates phased story execution
 *
 * Breaks story execution into discrete phases with fresh context windows:
 * ANALYZE → IMPLEMENT (per unit) → INTEGRATE → VERIFY ↔ FIX → COMMIT
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  PhaseType,
  PhasedExecutionState,
  PhaseResult,
  AnalyzeOutputs,
  ImplementOutputs,
  IntegrateOutputs,
  VerifyOutputs,
  FixOutputs,
  StoryRequirements,
  TokenUsage,
  PhasedExecutionMetrics,
  PHASE_TOKEN_BUDGETS,
  PlanUpdateRequest,
  PlanUpdateResponse,
  ImplementationUnit,
} from "./phased-types.js";
import {
  BuilderContext,
  buildAnalyzeInput,
  buildImplementInput,
  buildIntegrateInput,
  buildVerifyInput,
  buildFixInput,
  formatInputBundleForPrompt,
} from "./phase-input-builder.js";
import {
  createCheckpoint,
  createIntegrateCheckpoint,
  createFixCheckpoint,
  squashCheckpoints,
  ensureStoryBranch,
  forcePushBranch,
} from "./checkpoint-manager.js";
import { runAnalyzePhase } from "./phases/analyze.js";
import { runImplementPhase } from "./phases/implement.js";
import { runIntegratePhase } from "./phases/integrate.js";
import { runVerifyPhase } from "./phases/verify.js";
import { runFixPhase } from "./phases/fix.js";
import { CoordinationClient } from "./coordination-client.js";

const MAX_FIX_ITERATIONS = 3;

export interface PhasedExecutorConfig {
  repoPath: string;
  storyRequirements: StoryRequirements;
  model: string;
  taskId: string;
  jiraKey: string;
  branchName: string;
  baseBranch: string;
  anthropicApiKey: string;
  coordinationClient: CoordinationClient;
  onPhaseStart?: (phaseId: string, phaseType: PhaseType) => void;
  onPhaseComplete?: (result: PhaseResult) => void;
  onPlanUpdateRequest?: (request: PlanUpdateRequest) => Promise<PlanUpdateResponse>;
}

/**
 * Main entry point for phased story execution.
 */
export async function runPhasedExecution(
  config: PhasedExecutorConfig
): Promise<PhasedExecutionState> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  // Initialize state
  const state: PhasedExecutionState = {
    storyId: config.storyRequirements.storyId,
    taskId: config.taskId,
    status: "running",
    currentPhase: "analyze",
    completedPhases: [],
    implementResults: [],
    verifyIterations: [],
    fixIterations: [],
    checkpointCommits: [],
    startedAt: new Date(),
    totalTokens: { input: 0, output: 0, total: 0 },
    metrics: initializeMetrics(),
  };

  // Ensure we're on the story branch
  ensureStoryBranch(config.repoPath, config.branchName, config.baseBranch);

  // Post execution started
  await config.coordinationClient.postContext(config.taskId, {
    type: "phased_execution_started",
    storyId: state.storyId,
  });

  try {
    // === PHASE 1: ANALYZE ===
    config.onPhaseStart?.("analyze", "analyze");
    const analyzeResult = await runAnalyzePhaseWrapper(client, config, state);
    state.analyzeResult = analyzeResult.outputs as AnalyzeOutputs;
    state.completedPhases.push(analyzeResult);
    addTokenUsage(state.totalTokens, analyzeResult.tokenUsage);
    config.onPhaseComplete?.(analyzeResult);

    // === PHASE 2: IMPLEMENT (per unit) ===
    const units = state.analyzeResult.implementationUnits;
    const priorDecisions: string[] = [];

    for (let i = 0; i < units.length; i++) {
      state.currentPhase = "implement";
      state.currentUnitIndex = i;
      const unit = units[i];
      const phaseId = `implement-${i}`;

      config.onPhaseStart?.(phaseId, "implement");

      const implementResult = await runImplementPhaseWrapper(
        client,
        config,
        state,
        unit,
        priorDecisions
      );

      // Handle plan update request if present
      const outputs = implementResult.outputs as ImplementOutputs;
      if (outputs.planUpdateRequest) {
        const response = await handlePlanUpdateRequest(
          config,
          outputs.planUpdateRequest,
          units,
          i
        );
        // If major update, might need to re-analyze (future enhancement)
        if (!response.approved) {
          console.warn("Plan update request denied:", response.reason);
        }
      }

      state.implementResults.push(outputs);
      state.completedPhases.push(implementResult);
      addTokenUsage(state.totalTokens, implementResult.tokenUsage);

      // Collect decisions for next units
      priorDecisions.push(...outputs.decisions);

      // Create checkpoint commit
      if (outputs.filesModified.length > 0 || outputs.filesCreated.length > 0) {
        const checkpoint = await createCheckpoint(
          config.repoPath,
          i,
          unit.name,
          [...outputs.filesModified, ...outputs.filesCreated]
        );
        state.checkpointCommits.push(checkpoint.sha);
        implementResult.checkpointCommit = checkpoint.sha;
      }

      config.onPhaseComplete?.(implementResult);
    }

    // === PHASE 3: INTEGRATE ===
    state.currentPhase = "integrate";
    state.currentUnitIndex = undefined;
    config.onPhaseStart?.("integrate", "integrate");

    const integrateResult = await runIntegratePhaseWrapper(client, config, state);
    state.integrateResult = integrateResult.outputs as IntegrateOutputs;
    state.completedPhases.push(integrateResult);
    addTokenUsage(state.totalTokens, integrateResult.tokenUsage);

    // Checkpoint if integrate made changes
    const integrateOutputs = integrateResult.outputs as IntegrateOutputs;
    if (integrateOutputs.filesFixed.length > 0) {
      const checkpoint = await createIntegrateCheckpoint(
        config.repoPath,
        integrateOutputs.filesFixed
      );
      if (checkpoint) {
        state.checkpointCommits.push(checkpoint.sha);
        integrateResult.checkpointCommit = checkpoint.sha;
      }
    }

    config.onPhaseComplete?.(integrateResult);

    // === PHASE 4: VERIFY (with FIX loop) ===
    let verifyPassed = false;
    let fixIterations = 0;
    let lastVerifyResult: VerifyOutputs | undefined;
    const priorFixAttempts: string[] = [];
    const timeBeforeVerify = Date.now();

    while (!verifyPassed && fixIterations <= MAX_FIX_ITERATIONS) {
      state.currentPhase = "verify";
      const verifyPhaseId = `verify-${fixIterations}`;
      config.onPhaseStart?.(verifyPhaseId, "verify");

      const verifyResult = await runVerifyPhaseWrapper(client, config, state);
      lastVerifyResult = verifyResult.outputs as VerifyOutputs;
      state.verifyIterations.push(lastVerifyResult);
      state.completedPhases.push(verifyResult);
      addTokenUsage(state.totalTokens, verifyResult.tokenUsage);
      config.onPhaseComplete?.(verifyResult);

      if (lastVerifyResult.passed) {
        verifyPassed = true;
        if (fixIterations === 0) {
          state.metrics.verifyPassOnFirstAttempt = true;
        }
        state.metrics.timeToFirstGreenMs = Date.now() - timeBeforeVerify;
        break;
      }

      // Verify failed, run fix phase
      if (fixIterations >= MAX_FIX_ITERATIONS) {
        break;
      }

      fixIterations++;
      state.currentPhase = "fix";
      const fixPhaseId = `fix-${fixIterations}`;
      config.onPhaseStart?.(fixPhaseId, "fix");

      const fixResult = await runFixPhaseWrapper(
        client,
        config,
        state,
        lastVerifyResult,
        fixIterations,
        priorFixAttempts
      );
      const fixOutputs = fixResult.outputs as FixOutputs;
      state.fixIterations.push(fixOutputs);
      state.completedPhases.push(fixResult);
      addTokenUsage(state.totalTokens, fixResult.tokenUsage);

      // Track fix attempt for next iteration
      priorFixAttempts.push(
        `Iteration ${fixIterations}: Fixed ${fixOutputs.issuesAddressed.join(", ")}`
      );

      // Checkpoint if fix made changes
      if (fixOutputs.filesModified.length > 0) {
        const checkpoint = await createFixCheckpoint(
          config.repoPath,
          fixIterations,
          fixOutputs.filesModified
        );
        if (checkpoint) {
          state.checkpointCommits.push(checkpoint.sha);
          fixResult.checkpointCommit = checkpoint.sha;
        }
      }

      config.onPhaseComplete?.(fixResult);

      // Update redo rate metric
      state.metrics.redoRateByPhase.fix =
        (state.metrics.redoRateByPhase.fix || 0) + 1;
    }

    // === PHASE 5: COMMIT ===
    if (!verifyPassed) {
      state.status = "failed";
      state.completedAt = new Date();
      await config.coordinationClient.postContext(config.taskId, {
        type: "phased_execution_failed",
        storyId: state.storyId,
        error: `Verification failed after ${fixIterations} fix iterations`,
      });
      return state;
    }

    state.currentPhase = "commit";
    config.onPhaseStart?.("commit", "commit");

    // Squash all checkpoint commits
    if (state.checkpointCommits.length > 0) {
      const squashResult = await squashCheckpoints(
        config.repoPath,
        state.checkpointCommits,
        config.storyRequirements.title,
        config.jiraKey
      );

      // Push the squashed commit
      await forcePushBranch(config.repoPath, config.branchName);

      state.completedPhases.push({
        phaseId: "commit",
        phaseType: "commit",
        status: "completed",
        startedAt: new Date(),
        completedAt: new Date(),
        checkpointCommit: squashResult.finalSha,
      });
    }

    state.status = "completed";
    state.completedAt = new Date();
    state.metrics.phasesCompleted = state.completedPhases.length;
    state.metrics.totalTokensUsed = state.totalTokens.total;

    await config.coordinationClient.postContext(config.taskId, {
      type: "phased_execution_completed",
      storyId: state.storyId,
      metrics: state.metrics,
    });

    return state;
  } catch (error) {
    state.status = "failed";
    state.completedAt = new Date();

    const errorMessage = error instanceof Error ? error.message : String(error);
    await config.coordinationClient.postContext(config.taskId, {
      type: "phased_execution_failed",
      storyId: state.storyId,
      error: errorMessage,
    });

    throw error;
  }
}

// ============================================================
// Phase Wrappers
// ============================================================

async function runAnalyzePhaseWrapper(
  client: Anthropic,
  config: PhasedExecutorConfig,
  state: PhasedExecutionState
): Promise<PhaseResult> {
  const builderContext = createBuilderContext(config, state);
  const inputBundle = buildAnalyzeInput(builderContext);
  const prompt = formatInputBundleForPrompt(inputBundle);

  const startedAt = new Date();
  await config.coordinationClient.postContext(config.taskId, {
    type: "phase_started",
    storyId: state.storyId,
    phaseId: "analyze",
    phaseType: "analyze",
  });

  const outputs = await runAnalyzePhase(
    client,
    config.model,
    prompt,
    config.repoPath,
    PHASE_TOKEN_BUDGETS.analyze
  );

  const result: PhaseResult = {
    phaseId: "analyze",
    phaseType: "analyze",
    status: "completed",
    startedAt,
    completedAt: new Date(),
    outputs,
    tokenUsage: outputs.tokenUsage,
    readCount: outputs.readCount,
  };

  await config.coordinationClient.postContext(config.taskId, {
    type: "phase_completed",
    storyId: state.storyId,
    phaseId: "analyze",
    phaseType: "analyze",
    outputs,
  });

  // Return clean outputs without internal tracking fields
  return {
    ...result,
    outputs: {
      existingPatterns: outputs.existingPatterns,
      keyDecisions: outputs.keyDecisions,
      implementationUnits: outputs.implementationUnits,
      additionalFilesNeeded: outputs.additionalFilesNeeded,
      techConstraints: outputs.techConstraints,
      estimatedTotalTokens: outputs.estimatedTotalTokens,
      testCommands: outputs.testCommands,
    },
  };
}

async function runImplementPhaseWrapper(
  client: Anthropic,
  config: PhasedExecutorConfig,
  state: PhasedExecutionState,
  unit: ImplementationUnit,
  priorDecisions: string[]
): Promise<PhaseResult> {
  const builderContext = createBuilderContext(config, state);
  const inputBundle = buildImplementInput(builderContext, unit, priorDecisions);
  const prompt = formatInputBundleForPrompt(inputBundle);

  const phaseId = `implement-${unit.index}`;
  const startedAt = new Date();

  await config.coordinationClient.postContext(config.taskId, {
    type: "phase_started",
    storyId: state.storyId,
    phaseId,
    phaseType: "implement",
    unitIndex: unit.index,
  });

  const outputs = await runImplementPhase(
    client,
    config.model,
    prompt,
    config.repoPath,
    unit,
    PHASE_TOKEN_BUDGETS.implement
  );

  const result: PhaseResult = {
    phaseId,
    phaseType: "implement",
    status: "completed",
    startedAt,
    completedAt: new Date(),
    outputs,
    tokenUsage: outputs.tokenUsage,
    readCount: outputs.readCount,
  };

  await config.coordinationClient.postContext(config.taskId, {
    type: "phase_completed",
    storyId: state.storyId,
    phaseId,
    phaseType: "implement",
    unitIndex: unit.index,
    outputs,
  });

  return result;
}

async function runIntegratePhaseWrapper(
  client: Anthropic,
  config: PhasedExecutorConfig,
  state: PhasedExecutionState
): Promise<PhaseResult> {
  const builderContext = createBuilderContext(config, state);
  const inputBundle = buildIntegrateInput(builderContext);
  const prompt = formatInputBundleForPrompt(inputBundle);

  const startedAt = new Date();

  await config.coordinationClient.postContext(config.taskId, {
    type: "phase_started",
    storyId: state.storyId,
    phaseId: "integrate",
    phaseType: "integrate",
  });

  const outputs = await runIntegratePhase(
    client,
    config.model,
    prompt,
    config.repoPath,
    state.implementResults,
    PHASE_TOKEN_BUDGETS.integrate
  );

  const result: PhaseResult = {
    phaseId: "integrate",
    phaseType: "integrate",
    status: "completed",
    startedAt,
    completedAt: new Date(),
    outputs,
    tokenUsage: outputs.tokenUsage,
    readCount: outputs.readCount,
  };

  await config.coordinationClient.postContext(config.taskId, {
    type: "phase_completed",
    storyId: state.storyId,
    phaseId: "integrate",
    phaseType: "integrate",
    outputs,
  });

  return result;
}

async function runVerifyPhaseWrapper(
  client: Anthropic,
  config: PhasedExecutorConfig,
  state: PhasedExecutionState
): Promise<PhaseResult> {
  const builderContext = createBuilderContext(config, state);
  const inputBundle = buildVerifyInput(builderContext);
  const prompt = formatInputBundleForPrompt(inputBundle);

  const phaseId = `verify-${state.verifyIterations.length}`;
  const startedAt = new Date();

  await config.coordinationClient.postContext(config.taskId, {
    type: "phase_started",
    storyId: state.storyId,
    phaseId,
    phaseType: "verify",
  });

  const outputs = await runVerifyPhase(
    client,
    config.model,
    prompt,
    config.repoPath,
    state.analyzeResult?.testCommands || [],
    config.storyRequirements.acceptanceCriteria,
    PHASE_TOKEN_BUDGETS.verify
  );

  const result: PhaseResult = {
    phaseId,
    phaseType: "verify",
    status: "completed",
    startedAt,
    completedAt: new Date(),
    outputs,
    tokenUsage: outputs.tokenUsage,
    readCount: outputs.readCount,
  };

  await config.coordinationClient.postContext(config.taskId, {
    type: "phase_completed",
    storyId: state.storyId,
    phaseId,
    phaseType: "verify",
    outputs,
  });

  return result;
}

async function runFixPhaseWrapper(
  client: Anthropic,
  config: PhasedExecutorConfig,
  state: PhasedExecutionState,
  verifyOutputs: VerifyOutputs,
  iterationNumber: number,
  priorFixAttempts: string[]
): Promise<PhaseResult> {
  const builderContext = createBuilderContext(config, state);
  const inputBundle = buildFixInput(
    builderContext,
    verifyOutputs,
    iterationNumber,
    priorFixAttempts
  );
  const prompt = formatInputBundleForPrompt(inputBundle);

  const phaseId = `fix-${iterationNumber}`;
  const startedAt = new Date();

  await config.coordinationClient.postContext(config.taskId, {
    type: "phase_started",
    storyId: state.storyId,
    phaseId,
    phaseType: "fix",
  });

  const outputs = await runFixPhase(
    client,
    config.model,
    prompt,
    config.repoPath,
    verifyOutputs.issues,
    PHASE_TOKEN_BUDGETS.fix
  );

  const result: PhaseResult = {
    phaseId,
    phaseType: "fix",
    status: "completed",
    startedAt,
    completedAt: new Date(),
    outputs: { ...outputs, iterationNumber },
    tokenUsage: outputs.tokenUsage,
    readCount: outputs.readCount,
  };

  await config.coordinationClient.postContext(config.taskId, {
    type: "phase_completed",
    storyId: state.storyId,
    phaseId,
    phaseType: "fix",
    outputs,
  });

  return result;
}

// ============================================================
// Helpers
// ============================================================

function createBuilderContext(
  config: PhasedExecutorConfig,
  state: PhasedExecutionState
): BuilderContext {
  return {
    repoPath: config.repoPath,
    storyRequirements: config.storyRequirements,
    analyzeOutputs: state.analyzeResult,
    implementOutputs: state.implementResults,
    verifyOutputs: state.verifyIterations[state.verifyIterations.length - 1],
    checkpointCommits: state.checkpointCommits,
    baseBranch: config.baseBranch,
  };
}

function addTokenUsage(total: TokenUsage, phase?: TokenUsage): void {
  if (phase) {
    total.input += phase.input;
    total.output += phase.output;
    total.total += phase.total;
  }
}

function initializeMetrics(): PhasedExecutionMetrics {
  return {
    totalTokensUsed: 0,
    phasesCompleted: 0,
    verifyPassOnFirstAttempt: false,
    redoRateByPhase: {
      analyze: 0,
      implement: 0,
      integrate: 0,
      verify: 0,
      fix: 0,
      commit: 0,
    },
    verifyIssueLocality: {
      currentUnit: 0,
      priorUnits: 0,
      integration: 0,
    },
    contextRediscoveryCost: {},
    planDriftOccurred: false,
  };
}

async function handlePlanUpdateRequest(
  config: PhasedExecutorConfig,
  request: PlanUpdateRequest,
  currentUnits: ImplementationUnit[],
  currentUnitIndex: number
): Promise<PlanUpdateResponse> {
  // Post the plan update request to coordination feed
  await config.coordinationClient.postContext(config.taskId, {
    type: "phase_plan_update_requested",
    storyId: config.storyRequirements.storyId,
    planUpdateRequest: request,
  });

  // If custom handler provided, use it
  if (config.onPlanUpdateRequest) {
    const response = await config.onPlanUpdateRequest(request);
    await config.coordinationClient.postContext(config.taskId, {
      type: "phase_plan_updated",
      storyId: config.storyRequirements.storyId,
      planUpdateResponse: response,
    });
    return response;
  }

  // Default: auto-approve minor, deny major
  if (request.severity === "minor") {
    // Auto-approve: add suggested files to allowed touch set
    const currentUnit = currentUnits[currentUnitIndex];
    const updatedUnit = {
      ...currentUnit,
      allowedTouchSet: [
        ...new Set([
          ...currentUnit.allowedTouchSet,
          ...request.suggestedNewFiles,
        ]),
      ].filter((f) => !request.suggestedRemovals.includes(f)),
    };
    currentUnits[currentUnitIndex] = updatedUnit;

    const response: PlanUpdateResponse = {
      approved: true,
      updatedUnits: currentUnits,
      reason: "Minor plan update auto-approved",
    };

    await config.coordinationClient.postContext(config.taskId, {
      type: "phase_plan_updated",
      storyId: config.storyRequirements.storyId,
      planUpdateResponse: response,
    });

    return response;
  }

  // Major updates denied by default
  return {
    approved: false,
    reason: "Major plan updates require manual review",
  };
}
