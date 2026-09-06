import type { CliConfig, QualityGateCommand } from "../config.js";
import * as logger from "../logger.js";
import { runGate, type GateResult } from "../gate-runner.js";
import { runDiagnosticsOnTouchedFiles, emitFailureCode } from "./execution.js";
import { getStoryDefinitionOfDone as _getStoryDefinitionOfDone } from "./execution.js";
import type { OrchestrationOutput, Story, SharedContext } from "./types.js";

// ── Testable utility (used by orchestrator-gates.test.ts) ──

export interface PostExecutionQualityGateResult {
  gateResultsSection: string;
  requiredFailures: GateResult[];
}

export async function runPostExecutionQualityGates(args: {
  config: CliConfig;
  stories: Story[];
  completedStoryIds: string[];
  workingDir: string;
  output: OrchestrationOutput;
  /** Forward the active orchestration lifecycle to required commands. */
  abortSignal?: AbortSignal;
  runId?: string;
  getStoryDefinitionOfDone: (story: Story) => {
    requiredFiles: string[];
    requiredTests: string[];
    requiredCommands: string[];
  };
}): Promise<PostExecutionQualityGateResult> {
  const { config, stories, completedStoryIds, workingDir, output, getStoryDefinitionOfDone, abortSignal, runId } = args;
  const verifyEnabled = config.review?.verifyEnabled !== false;
  const staticGates: QualityGateCommand[] = config.qualityGates ?? [];
  const requiredCommandGates = stories
    .filter((story) => completedStoryIds.includes(story.id) && getStoryDefinitionOfDone(story).requiredCommands.length > 0)
    .map((story) => ({ name: `required: ${story.title}`, commands: getStoryDefinitionOfDone(story).requiredCommands }));
  const dynamicGates = verifyEnabled
    ? stories
        .filter((story) => completedStoryIds.includes(story.id) && story.verificationCommands?.length)
        .map((story) => ({ name: `verify: ${story.title}`, commands: story.verificationCommands! }))
    : [];
  const allGates = [...staticGates, ...requiredCommandGates, ...dynamicGates];
  const requiredGateNames = new Set(requiredCommandGates.map((gate) => gate.name));

  if (allGates.length === 0 || completedStoryIds.length === 0) {
    return { gateResultsSection: "", requiredFailures: [] };
  }

  output.coordinatorLog(`Running ${allGates.length} quality gate${allGates.length !== 1 ? "s" : ""}...`);
  output.status(`Running quality gates (${allGates.length})...`);
  const gateResults = await Promise.all(allGates.map((gate) => runGate(gate, workingDir, { signal: abortSignal, runId })));
  output.statusDone();

  const failed = gateResults.filter((result) => !result.passed);
  const passed = gateResults.filter((result) => result.passed);

  for (const result of passed) output.coordinatorLog(`  ✓ ${result.name}`);
  for (const result of failed) output.coordinatorLog(`  ✗ ${result.name} — failed`);

  logger.info("Quality gates complete", {
    total: gateResults.length,
    passed: passed.length,
    failed: failed.length,
  });

  const gateResultsSection = failed.length > 0
    ? `\n\n## Quality Gate Results — ${failed.length} FAILED\n\n` +
      failed.map((result) => `### ${result.name} — FAILED\n\`\`\`\n${result.output.slice(0, 2000)}\n\`\`\``).join("\n\n") +
      "\n\nRequired command failures are blocking. Verification-gate failures remain reviewer context."
    : "\n\n## Quality Gate Results — ALL PASSED\n\n" + passed.map((result) => `- ✓ ${result.name}`).join("\n");

  return {
    gateResultsSection,
    requiredFailures: failed.filter((result) => requiredGateNames.has(result.name)),
  };
}

// ── Orchestrator-level wrapper (called by runOrchestration) ──

export interface QualityGatesResult {
  gateResultsSection: string;
  earlyExit: boolean;
}

/**
 * Runs post-execution quality gates: static gates, required command gates,
 * and dynamic verification gates. Returns formatted results for the reviewer.
 * Returns early if required gates fail.
 * Also runs LSP diagnostics on touched files.
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
}): Promise<QualityGatesResult> {
  const { config, output, sorted, completedStoryIds, context, workingDir, abortSignal, runId } = args;

  let gateResultsSection = "";
  const verifyEnabled = config.review?.verifyEnabled !== false;

  const staticGates = config.qualityGates ?? [];
  const requiredCommandGates = sorted
    .filter((s) => completedStoryIds.includes(s.id) && _getStoryDefinitionOfDone(s).requiredCommands.length > 0)
    .map((s) => ({ name: `required: ${s.title}`, commands: _getStoryDefinitionOfDone(s).requiredCommands }));
  const dynamicGates = verifyEnabled
    ? sorted
        .filter(s => completedStoryIds.includes(s.id) && s.verificationCommands?.length)
        .map(s => ({ name: `verify: ${s.title}`, commands: s.verificationCommands! }))
    : [];
  const allGates = [...staticGates, ...requiredCommandGates, ...dynamicGates];
  const requiredGateNames = new Set(requiredCommandGates.map((gate) => gate.name));

  if (allGates.length > 0 && completedStoryIds.length > 0) {
    output.coordinatorLog(`Running ${allGates.length} quality gate${allGates.length !== 1 ? "s" : ""}...`);
    output.status(`Running quality gates (${allGates.length})...`);
    const gateResults = await Promise.all(allGates.map((gate) => runGate(gate, workingDir, { signal: abortSignal, runId })));
    output.statusDone();

    const failed = gateResults.filter(r => !r.passed);
    const passed = gateResults.filter(r => r.passed);

    for (const r of passed) output.coordinatorLog(`  ✓ ${r.name}`);
    for (const r of failed) output.coordinatorLog(`  ✗ ${r.name} — failed`);

    logger.info("Quality gates complete", {
      total: gateResults.length,
      passed: passed.length,
      failed: failed.length,
    });

    const requiredFailures = failed.filter((result) => requiredGateNames.has(result.name));

    if (failed.length > 0) {
      gateResultsSection =
        `\n\n## Quality Gate Results — ${failed.length} FAILED\n\n` +
        failed.map(r =>
          `### ${r.name} — FAILED\n\`\`\`\n${r.output.slice(0, 2000)}\n\`\`\``
        ).join("\n\n") +
        "\n\nRequired command failures are blocking. Verification-gate failures remain reviewer context.";
    } else {
      gateResultsSection =
        "\n\n## Quality Gate Results — ALL PASSED\n\n" +
        passed.map(r => `- ✓ ${r.name}`).join("\n");
    }

    // Strict mode: ALL gate failures are blocking, not just required ones
    const strictMode = config.review?.strict === true;
    const blockingFailures = strictMode ? failed : requiredFailures;

    if (blockingFailures.length > 0) {
      for (const failure of blockingFailures) {
        emitFailureCode(output, "required_command_failed", `${failure.name} failed`);
      }
      const label = strictMode ? "Strict mode" : "Definition-of-done check";
      output.coordinatorLog(`${label} failed: ${blockingFailures.length} gate${blockingFailures.length !== 1 ? "s" : ""} failed.`);
      logger.info("Blocking gate failures", { strict: strictMode, failures: blockingFailures.map((result) => result.name) });
      return { gateResultsSection, earlyExit: true };
    }
  }

  // Run LSP diagnostics on touched files BEFORE review — so the reviewer sees type errors
  if (completedStoryIds.length > 0) {
    const diagResult = await runDiagnosticsOnTouchedFiles(
      [...context.filesCreated, ...context.filesModified],
      workingDir,
      (msg) => output.coordinatorLog(msg),
    );
    if (diagResult.section) {
      gateResultsSection += diagResult.section;
    }
  }

  return { gateResultsSection, earlyExit: false };
}
