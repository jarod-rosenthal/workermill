/**
 * Phase Input Builder - Constructs PhaseInputBundle for each phase
 *
 * Provides deterministic context to each phase, preventing re-discovery
 * of basics and ensuring consistent handoffs.
 */

import * as fs from "fs";
import * as path from "path";
import {
  PhaseInputBundle,
  PhaseType,
  StoryRequirements,
  AnalyzeContextSummary,
  RepoState,
  UnitContext,
  VerifyContext,
  FixContext,
  IntegrateContext,
  AnalyzeOutputs,
  ImplementOutputs,
  VerifyOutputs,
  RelevantSnippet,
  ImplementationUnit,
} from "./phased-types.js";
import {
  getGitDiffStat,
  getChangedFiles,
  getNewFilesCreated,
} from "./checkpoint-manager.js";

export interface BuilderContext {
  repoPath: string;
  storyRequirements: StoryRequirements;
  analyzeOutputs?: AnalyzeOutputs;
  implementOutputs: ImplementOutputs[];
  verifyOutputs?: VerifyOutputs;
  checkpointCommits: string[];
  baseBranch?: string;
}

/**
 * Builds PhaseInputBundle for the analyze phase.
 */
export function buildAnalyzeInput(
  context: BuilderContext
): PhaseInputBundle {
  return {
    storyRequirements: context.storyRequirements,
    analyzeOutputs: {
      patterns: [],
      keyDecisions: [],
      techConstraints: [],
      totalUnits: 0,
    },
    repoState: buildRepoState(context),
  };
}

/**
 * Builds PhaseInputBundle for an implement phase.
 */
export function buildImplementInput(
  context: BuilderContext,
  unit: ImplementationUnit,
  priorDecisions: string[]
): PhaseInputBundle {
  if (!context.analyzeOutputs) {
    throw new Error("Cannot build implement input without analyze outputs");
  }

  return {
    storyRequirements: context.storyRequirements,
    analyzeOutputs: {
      patterns: context.analyzeOutputs.existingPatterns,
      keyDecisions: context.analyzeOutputs.keyDecisions,
      techConstraints: context.analyzeOutputs.techConstraints,
      totalUnits: context.analyzeOutputs.implementationUnits.length,
    },
    repoState: buildRepoState(context),
    unitContext: {
      unitIndex: unit.index,
      unitName: unit.name,
      targetFiles: unit.files,
      allowedTouchSet: unit.allowedTouchSet,
      relevantSnippets: unit.relevantSnippets,
      priorUnitDecisions: priorDecisions,
      goal: unit.goal,
    },
  };
}

/**
 * Builds PhaseInputBundle for the integrate phase.
 */
export function buildIntegrateInput(
  context: BuilderContext
): PhaseInputBundle {
  if (!context.analyzeOutputs) {
    throw new Error("Cannot build integrate input without analyze outputs");
  }

  // Build import/export map from all implement outputs
  const exports: Array<{ file: string; name: string; type: string }> = [];
  const imports: Array<{ file: string; from: string; name: string }> = [];

  for (const output of context.implementOutputs) {
    exports.push(...output.exportsAdded);
    imports.push(...output.importsNeeded);
  }

  return {
    storyRequirements: context.storyRequirements,
    analyzeOutputs: {
      patterns: context.analyzeOutputs.existingPatterns,
      keyDecisions: context.analyzeOutputs.keyDecisions,
      techConstraints: context.analyzeOutputs.techConstraints,
      totalUnits: context.analyzeOutputs.implementationUnits.length,
    },
    repoState: buildRepoState(context),
    integrateContext: {
      allUnitOutputs: context.implementOutputs,
      importExportMap: { exports, imports },
    },
  };
}

/**
 * Builds PhaseInputBundle for the verify phase.
 */
export function buildVerifyInput(
  context: BuilderContext
): PhaseInputBundle {
  if (!context.analyzeOutputs) {
    throw new Error("Cannot build verify input without analyze outputs");
  }

  // Collect all changed files from implement outputs
  const changedFiles = new Set<string>();
  for (const output of context.implementOutputs) {
    for (const file of output.filesModified) {
      changedFiles.add(file);
    }
    for (const file of output.filesCreated) {
      changedFiles.add(file);
    }
  }

  return {
    storyRequirements: context.storyRequirements,
    analyzeOutputs: {
      patterns: context.analyzeOutputs.existingPatterns,
      keyDecisions: context.analyzeOutputs.keyDecisions,
      techConstraints: context.analyzeOutputs.techConstraints,
      totalUnits: context.analyzeOutputs.implementationUnits.length,
    },
    repoState: buildRepoState(context),
    verifyContext: {
      commandsToRun: context.analyzeOutputs.testCommands || [
        "npm run typecheck",
        "npm run lint",
        "npm test",
      ],
      acceptanceCriteria: context.storyRequirements.acceptanceCriteria,
      changedFiles: Array.from(changedFiles),
    },
  };
}

/**
 * Builds PhaseInputBundle for the fix phase.
 */
export function buildFixInput(
  context: BuilderContext,
  verifyOutputs: VerifyOutputs,
  iterationNumber: number,
  priorFixAttempts: string[]
): PhaseInputBundle {
  if (!context.analyzeOutputs) {
    throw new Error("Cannot build fix input without analyze outputs");
  }

  return {
    storyRequirements: context.storyRequirements,
    analyzeOutputs: {
      patterns: context.analyzeOutputs.existingPatterns,
      keyDecisions: context.analyzeOutputs.keyDecisions,
      techConstraints: context.analyzeOutputs.techConstraints,
      totalUnits: context.analyzeOutputs.implementationUnits.length,
    },
    repoState: buildRepoState(context),
    fixContext: {
      issues: verifyOutputs.issues,
      commandOutputs: verifyOutputs.commandOutputs,
      iterationNumber,
      priorFixAttempts,
    },
  };
}

/**
 * Builds the RepoState from current git state.
 */
function buildRepoState(context: BuilderContext): RepoState {
  return {
    gitDiffStat: getGitDiffStat(context.repoPath),
    changedFiles: getChangedFiles(context.repoPath, context.baseBranch),
    newFilesCreated: getNewFilesCreated(context.repoPath),
    checkpointCommits: context.checkpointCommits,
  };
}

/**
 * Reads a file and creates a RelevantSnippet.
 */
export function createSnippet(
  repoPath: string,
  filePath: string,
  reason: string
): RelevantSnippet | null {
  const fullPath = path.join(repoPath, filePath);

  try {
    if (!fs.existsSync(fullPath)) {
      return null;
    }

    const content = fs.readFileSync(fullPath, "utf-8");

    return {
      filePath,
      content,
      reason,
    };
  } catch (error) {
    console.warn(`Could not read ${filePath}: ${error}`);
    return null;
  }
}

/**
 * Creates snippets for a list of files.
 */
export function createSnippets(
  repoPath: string,
  files: Array<{ path: string; reason: string }>
): RelevantSnippet[] {
  const snippets: RelevantSnippet[] = [];

  for (const file of files) {
    const snippet = createSnippet(repoPath, file.path, file.reason);
    if (snippet) {
      snippets.push(snippet);
    }
  }

  return snippets;
}

/**
 * Formats PhaseInputBundle as a prompt section.
 */
export function formatInputBundleForPrompt(bundle: PhaseInputBundle): string {
  const sections: string[] = [];

  // Story requirements
  sections.push(`## Story Requirements

**Title:** ${bundle.storyRequirements.title}
**Scope:** ${bundle.storyRequirements.scope}
**Persona:** ${bundle.storyRequirements.persona}

**Acceptance Criteria:**
${bundle.storyRequirements.acceptanceCriteria.map((ac) => `- ${ac}`).join("\n")}
`);

  // Analyze context (if available)
  if (
    bundle.analyzeOutputs.patterns.length > 0 ||
    bundle.analyzeOutputs.keyDecisions.length > 0
  ) {
    sections.push(`## Analysis Context

**Existing Patterns:**
${bundle.analyzeOutputs.patterns.map((p) => `- ${p}`).join("\n") || "- (none identified)"}

**Key Decisions:**
${bundle.analyzeOutputs.keyDecisions.map((d) => `- ${d}`).join("\n") || "- (none yet)"}

**Tech Constraints:**
${bundle.analyzeOutputs.techConstraints.map((c) => `- ${c}`).join("\n") || "- (none identified)"}

**Total Implementation Units:** ${bundle.analyzeOutputs.totalUnits}
`);
  }

  // Repo state
  sections.push(`## Current Repository State

**Git Diff Stat:**
\`\`\`
${bundle.repoState.gitDiffStat || "(no changes yet)"}
\`\`\`

**Changed Files:** ${bundle.repoState.changedFiles.join(", ") || "(none)"}
**New Files Created:** ${bundle.repoState.newFilesCreated.join(", ") || "(none)"}
**Checkpoint Commits:** ${bundle.repoState.checkpointCommits.length}
`);

  // Unit context (for implement phase)
  if (bundle.unitContext) {
    sections.push(`## Unit Context

**Unit ${bundle.unitContext.unitIndex}:** ${bundle.unitContext.unitName}
**Goal:** ${bundle.unitContext.goal}

**Target Files:**
${bundle.unitContext.targetFiles.map((f) => `- ${f}`).join("\n")}

**Allowed Touch Set** (files you MAY edit):
${bundle.unitContext.allowedTouchSet.map((f) => `- ${f}`).join("\n")}

**Prior Unit Decisions:**
${bundle.unitContext.priorUnitDecisions.map((d) => `- ${d}`).join("\n") || "- (first unit)"}
`);

    // Relevant snippets
    if (bundle.unitContext.relevantSnippets.length > 0) {
      sections.push(`## Pre-Loaded File Contents

The following files have been pre-loaded to save you from re-reading them:

`);
      for (const snippet of bundle.unitContext.relevantSnippets) {
        sections.push(`### ${snippet.filePath}
**Reason:** ${snippet.reason}

\`\`\`
${snippet.content}
\`\`\`

`);
      }
    }
  }

  // Verify context
  if (bundle.verifyContext) {
    sections.push(`## Verify Context

**Commands to Run:**
${bundle.verifyContext.commandsToRun.map((c) => `- \`${c}\``).join("\n")}

**Changed Files to Focus On:**
${bundle.verifyContext.changedFiles.map((f) => `- ${f}`).join("\n")}
`);
  }

  // Fix context
  if (bundle.fixContext) {
    sections.push(`## Fix Context

**Iteration:** ${bundle.fixContext.iterationNumber} of 3

**Issues to Address:**
${bundle.fixContext.issues
  .map(
    (i) =>
      `- [${i.severity}] ${i.type}: ${i.message}${i.file ? ` (${i.file}:${i.line || "?"})` : ""}`
  )
  .join("\n")}

**Prior Fix Attempts:**
${bundle.fixContext.priorFixAttempts.map((a) => `- ${a}`).join("\n") || "- (first attempt)"}

**Command Outputs:**
${bundle.fixContext.commandOutputs
  .map(
    (o) => `
### \`${o.command}\` (exit code: ${o.exitCode})
\`\`\`
${o.truncatedLog}
\`\`\`
`
  )
  .join("\n")}
`);
  }

  // Integrate context
  if (bundle.integrateContext) {
    sections.push(`## Integrate Context

**Exports Added Across Units:**
${bundle.integrateContext.importExportMap.exports
  .map((e) => `- ${e.file}: ${e.name} (${e.type})`)
  .join("\n") || "- (none)"}

**Imports Needed:**
${bundle.integrateContext.importExportMap.imports
  .map((i) => `- ${i.file}: import ${i.name} from ${i.from}`)
  .join("\n") || "- (none)"}

**Unit Summaries:**
${bundle.integrateContext.allUnitOutputs
  .map(
    (u) => `
### Unit ${u.unitIndex}
- Files modified: ${u.filesModified.join(", ")}
- Files created: ${u.filesCreated.join(", ")}
- Decisions: ${u.decisions.join("; ")}
`
  )
  .join("\n")}
`);
  }

  return sections.join("\n---\n\n");
}
