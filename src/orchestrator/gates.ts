import path from "path";
import fs from "fs";
import type { CliConfig, QualityGateCommand } from "../config.js";
import * as logger from "../logger.js";
import { runGate, type GateResult } from "../gate-runner.js";
import * as lspTool from "../engine/tools/lsp.js";
import type { OrchestrationOutput, Story } from "./types.js";

export interface PostExecutionQualityGateResult {
  gateResultsSection: string;
  requiredFailures: GateResult[];
}

export interface DiagnosticsSectionResult {
  errorCount: number;
  section: string;
}

/** Run LSP diagnostics on touched files. Returns error count (0 = clean, -1 = no LSP). */
export async function runDiagnosticsOnTouchedFiles(
  touchedFiles: string[],
  workingDir: string,
  log: (msg: string) => void,
): Promise<DiagnosticsSectionResult> {
  if (touchedFiles.length === 0) return { errorCount: 0, section: "" };

  const excludes = lspTool.loadTsconfigExcludes(workingDir);
  const unique = [...new Set(touchedFiles)].filter((filePath) => {
    const rel = path.isAbsolute(filePath) ? path.relative(workingDir, filePath) : filePath;
    return !excludes.some((re) => re.test(rel));
  });
  if (unique.length === 0) return { errorCount: 0, section: "" };

  log(`Running diagnostics on ${unique.length} touched file(s)...`);
  let totalErrors = 0;
  let lspAvailable = true;
  const lines: string[] = [];

  for (const filePath of unique) {
    try {
      const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(workingDir, filePath);
      if (!fs.existsSync(resolvedPath)) {
        log(`⚠ File not found: ${filePath}`);
        continue;
      }

      const result = await lspTool.execute({ action: "diagnostics", file: resolvedPath, format: "json" }, workingDir);
      if (result.success && result.content) {
        try {
          const parsed = JSON.parse(result.content);
          if (parsed.lsp_available === false) {
            lspAvailable = false;
            continue;
          }
          const errors =
            parsed.summary?.errors ??
            parsed.diagnostics?.filter((d: { severity: string }) => d.severity === "error").length ??
            0;
          totalErrors += errors;
          const status = errors > 0 ? `✗ ${filePath}: ${errors} error(s)` : `✓ ${filePath}: clean`;
          log(status);
          lines.push(status);
          if (errors > 0 && parsed.diagnostics) {
            for (const diagnostic of parsed.diagnostics.slice(0, 5)) {
              lines.push(`    ${diagnostic.line}:${diagnostic.col} ${diagnostic.message}`);
            }
            if (parsed.diagnostics.length > 5) {
              lines.push(`    ... and ${parsed.diagnostics.length - 5} more`);
            }
          }
        } catch {
          log(`✓ ${filePath}: ${result.content}`);
        }
      } else {
        log(`✗ ${filePath}: ${result.error}`);
      }
    } catch (err) {
      log(`✗ ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!lspAvailable && totalErrors === 0) return { errorCount: -1, section: "" };

  const section = totalErrors > 0
    ? `\n\n## LSP Diagnostics — ${totalErrors} ERROR(S)\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n\nThese type errors were found in touched files. Factor them into your review — request revision if they indicate real bugs.`
    : lines.length > 0
      ? `\n\n## LSP Diagnostics — CLEAN\n\n${lines.map((line) => `- ${line}`).join("\n")}`
      : "";

  return { errorCount: totalErrors, section };
}

export async function runPostExecutionQualityGates(args: {
  config: CliConfig;
  stories: Story[];
  completedStoryIds: string[];
  workingDir: string;
  output: OrchestrationOutput;
  getStoryDefinitionOfDone: (story: Story) => {
    requiredFiles: string[];
    requiredTests: string[];
    requiredCommands: string[];
  };
}): Promise<PostExecutionQualityGateResult> {
  const { config, stories, completedStoryIds, workingDir, output, getStoryDefinitionOfDone } = args;
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
  const gateResults = await Promise.all(allGates.map((gate) => runGate(gate, workingDir)));
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
