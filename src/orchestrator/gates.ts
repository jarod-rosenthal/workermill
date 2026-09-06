import type { CliConfig, QualityGateCommand } from "../config.js";
import * as logger from "../logger.js";
import { runGate, type GateExecutionOptions, type GateResult, type GateStatus } from "../gate-runner.js";
import { createPathScope } from "../engine/path-policy.js";
import { runScopedProcess } from "../engine/scoped-process.js";
import type { SandboxSetting } from "../sandbox-mode.js";
import { runDiagnosticsOnTouchedFiles, emitFailureCode } from "./execution.js";
import { getStoryDefinitionOfDone as _getStoryDefinitionOfDone } from "./execution.js";
import type { OrchestrationOutput, Story, SharedContext } from "./types.js";

export type QualityGateSource = "static" | "required_command" | "planner_verification";

/** A gate with an identity that never depends on its human-readable title. */
export interface QualityGateDefinition {
  id: string;
  name: string;
  commands: string[];
  source: QualityGateSource;
  required: boolean;
}

/** Typed evidence retained for each attempted gate. */
export interface QualityGateResult {
  id: string;
  name: string;
  source: QualityGateSource;
  required: boolean;
  status: GateStatus;
  passed: boolean;
  output: string;
}

function gateExecutionOptions(config: CliConfig, workingDir: string, args: {
  abortSignal?: AbortSignal; runId?: string; sandboxed?: SandboxSetting;
}): GateExecutionOptions {
  const scope = createPathScope(workingDir, config.sandboxCapabilities?.extraPathGrants ?? []);
  return {
    signal: args.abortSignal,
    runId: args.runId,
    runProcess: (request) => runScopedProcess(request, {
      sandbox: args.sandboxed ?? config.sandbox ?? true,
      scope,
      capabilities: config.sandboxCapabilities,
    }),
  };
}

function gateDefinitions(args: {
  config: CliConfig;
  stories: Story[];
  completedStoryIds: string[];
  getStoryDefinitionOfDone: (story: Story) => { requiredCommands: string[] };
}): QualityGateDefinition[] {
  const completed = new Set(args.completedStoryIds);
  const staticGates: QualityGateCommand[] = args.config.qualityGates ?? [];
  const definitions: QualityGateDefinition[] = staticGates.map((gate, staticIndex) => ({
    // Position survives both a title edit and a duplicate title.
    id: `static:${staticIndex}`,
    name: gate.name,
    commands: gate.commands,
    source: "static",
    required: gate.required !== false,
  }));

  for (const story of args.stories) {
    if (!completed.has(story.id)) continue;
    for (const [commandIndex, command] of args.getStoryDefinitionOfDone(story).requiredCommands.entries()) {
      definitions.push({
        id: `required:${story.id}:${commandIndex}`,
        name: `required: ${story.title}`,
        commands: [command],
        source: "required_command",
        required: true,
      });
    }
    if (args.config.review?.verifyEnabled === false) continue;
    for (const [commandIndex, command] of (story.verificationCommands ?? []).entries()) {
      definitions.push({
        id: `planner:${story.id}:${commandIndex}`,
        name: `verify: ${story.title}`,
        commands: [command],
        source: "planner_verification",
        required: false,
      });
    }
  }
  return definitions;
}

function resultStatus(result: GateResult, signal?: AbortSignal): GateStatus {
  // The fallback makes older injected runners truthful until every caller has
  // adopted the R13 status field.
  if (signal?.aborted) return "cancelled";
  if (result.status) return result.status;
  return result.passed ? "passed" : "failed";
}

async function runGatesSequentially(args: {
  definitions: QualityGateDefinition[];
  workingDir: string;
  execution: GateExecutionOptions;
}): Promise<QualityGateResult[]> {
  const results: QualityGateResult[] = [];
  for (const definition of args.definitions) {
    // Cancellation prevents the next gate's command from being launched.
    if (args.execution.signal?.aborted) break;
    const executionResult = await runGate(definition, args.workingDir, args.execution);
    const status = resultStatus(executionResult, args.execution.signal);
    results.push({ ...definition, status, passed: status === "passed", output: executionResult.output });
    if (status === "cancelled") break;
  }
  return results;
}

function formatGateResults(results: QualityGateResult[]): string {
  const failed = results.filter((result) => result.status !== "passed");
  const passed = results.filter((result) => result.status === "passed");
  if (failed.length === 0) {
    return "\n\n## Quality Gate Results — ALL PASSED\n\n" + passed.map((result) => `- ✓ ${result.name}`).join("\n");
  }
  return "\n\n## Quality Gate Results — " + failed.length + " FAILED\n\n" +
    failed.map((result) => `### ${result.name} — ${result.status === "cancelled" ? "CANCELLED" : "FAILED"}\n\`\`\`\n${result.output.slice(0, 2000)}\n\`\`\``).join("\n\n") +
    "\n\nRequired command and static-gate failures are blocking unless a static gate sets required: false. Planner verification remains reviewer context outside strict mode.";
}

function isBlockingFailure(result: QualityGateResult, strict: boolean): boolean {
  return result.status === "cancelled" || (result.status === "failed" && (strict || result.required));
}

async function runPostExecutionGates(args: {
  config: CliConfig;
  stories: Story[];
  completedStoryIds: string[];
  workingDir: string;
  output: OrchestrationOutput;
  abortSignal?: AbortSignal;
  runId?: string;
  sandboxed?: SandboxSetting;
  getStoryDefinitionOfDone: (story: Story) => { requiredCommands: string[] };
}): Promise<{ gateResults: QualityGateResult[]; gateResultsSection: string; blockingFailures: QualityGateResult[]; cancelled: boolean }> {
  if (args.abortSignal?.aborted) {
    return { gateResults: [], gateResultsSection: "Quality gates cancelled.", blockingFailures: [], cancelled: true };
  }
  const definitions = gateDefinitions(args);
  if (definitions.length === 0 || args.completedStoryIds.length === 0) {
    return { gateResults: [], gateResultsSection: "", blockingFailures: [], cancelled: false };
  }

  args.output.coordinatorLog(`Running ${definitions.length} quality gate${definitions.length !== 1 ? "s" : ""}...`);
  args.output.status(`Running quality gates (${definitions.length})...`);
  const gateResults = await runGatesSequentially({
    definitions,
    workingDir: args.workingDir,
    execution: gateExecutionOptions(args.config, args.workingDir, args),
  });
  args.output.statusDone();

  for (const result of gateResults) {
    args.output.coordinatorLog(result.status === "passed" ? `  ✓ ${result.name}` : `  ✗ ${result.name} — ${result.status}`);
  }
  const failed = gateResults.filter((result) => result.status !== "passed");
  logger.info("Quality gates complete", {
    total: gateResults.length,
    passed: gateResults.length - failed.length,
    failed: failed.length,
    cancelled: gateResults.some((result) => result.status === "cancelled"),
  });
  return {
    gateResults,
    gateResultsSection: formatGateResults(gateResults),
    blockingFailures: failed.filter((result) => isBlockingFailure(result, args.config.review?.strict === true)),
    cancelled: gateResults.some((result) => result.status === "cancelled") || args.abortSignal?.aborted === true,
  };
}

// ── Testable utility (used by orchestrator-gates.test.ts) ──

export interface PostExecutionQualityGateResult {
  gateResultsSection: string;
  /** R13 typed evidence for the caller and future run manifest. */
  gateResults: QualityGateResult[];
  /** Compatibility name retained for callers before the R13c wiring lands. */
  requiredFailures: QualityGateResult[];
  blockingFailures: QualityGateResult[];
  cancelled: boolean;
}

export async function runPostExecutionQualityGates(args: {
  config: CliConfig;
  stories: Story[];
  completedStoryIds: string[];
  workingDir: string;
  output: OrchestrationOutput;
  abortSignal?: AbortSignal;
  runId?: string;
  sandboxed?: SandboxSetting;
  getStoryDefinitionOfDone: (story: Story) => {
    requiredFiles: string[];
    requiredTests: string[];
    requiredCommands: string[];
  };
}): Promise<PostExecutionQualityGateResult> {
  const result = await runPostExecutionGates(args);
  return {
    ...result,
    requiredFailures: result.gateResults.filter((gate) => gate.source === "required_command" && gate.status !== "passed"),
  };
}

// ── Orchestrator-level wrapper (called by runOrchestration) ──

export interface QualityGatesResult {
  gateResultsSection: string;
  earlyExit: boolean;
  /** Typed evidence; R13c will persist and consume this directly. */
  gateResults: QualityGateResult[];
  cancelled: boolean;
}

/**
 * Runs static, required-command, and planner verification gates. Static gates
 * block by default; planner verification is advisory unless strict mode is on.
 */
export async function runQualityGates(args: {
  config: CliConfig;
  output: OrchestrationOutput;
  sorted: Story[];
  completedStoryIds: string[];
  context: SharedContext;
  workingDir: string;
  abortSignal?: AbortSignal;
  runId?: string;
  sandboxed?: SandboxSetting;
}): Promise<QualityGatesResult> {
  const { config, output, sorted, completedStoryIds, context, workingDir, abortSignal } = args;
  if (abortSignal?.aborted) return { gateResultsSection: "Quality gates cancelled.", earlyExit: true, gateResults: [], cancelled: true };

  const result = await runPostExecutionGates({
    ...args,
    stories: sorted,
    getStoryDefinitionOfDone: _getStoryDefinitionOfDone,
  });
  if (result.cancelled || abortSignal?.aborted) {
    return { gateResultsSection: result.gateResultsSection, earlyExit: true, gateResults: result.gateResults, cancelled: true };
  }
  if (result.blockingFailures.length > 0) {
    for (const failure of result.blockingFailures) {
      emitFailureCode(output, "required_command_failed", `${failure.name} failed`);
    }
    const strictMode = config.review?.strict === true;
    const label = strictMode ? "Strict mode" : result.blockingFailures.some((failure) => failure.status === "cancelled") ? "Quality gates cancelled" : "Definition-of-done check";
    output.coordinatorLog(`${label} failed: ${result.blockingFailures.length} gate${result.blockingFailures.length !== 1 ? "s" : ""} failed.`);
    logger.info("Blocking gate failures", { strict: strictMode, failures: result.blockingFailures.map((failure) => failure.id) });
    return { gateResultsSection: result.gateResultsSection, earlyExit: true, gateResults: result.gateResults, cancelled: false };
  }

  let gateResultsSection = result.gateResultsSection;
  if (completedStoryIds.length > 0) {
    const diagResult = await runDiagnosticsOnTouchedFiles(
      [...context.filesCreated, ...context.filesModified],
      workingDir,
      (message) => output.coordinatorLog(message),
    );
    if (diagResult.section) gateResultsSection += diagResult.section;
  }
  if (abortSignal?.aborted) {
    return { gateResultsSection, earlyExit: true, gateResults: result.gateResults, cancelled: true };
  }
  return { gateResultsSection, earlyExit: false, gateResults: result.gateResults, cancelled: false };
}
