/**
 * V2 Step Processor
 *
 * Handles the execution of a single V2 pipeline step:
 * 1. Parse step input from environment/stdin
 * 2. Run git setup command (reset + clean for rewinds)
 * 3. Resolve reference file patterns
 * 4. Build the step prompt with context
 * 5. Output step-specific markers for orchestrator
 *
 * This script is called by the worker entrypoint when pipelineVersion=v2.
 */

import { execSync } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { resolveReferenceFiles } from "./resolve-reference-files";

// Types matching api/src/services/pipeline-v2-types.ts
interface PlannedStepV2 {
  index: number;
  title: string;
  description: string;
  persona: string;
  verificationType: "logic" | "ui" | "docs" | "config";
  verificationInstructions: string;
  targetFiles: string[];
  referenceFiles?: string[];
  estimatedComplexity?: 1 | 2 | 3;
  timeoutMinutes?: number;
}

interface TechStackV2 {
  language: string;
  framework: string;
  styling?: string;
  database?: string;
  testing?: string;
  buildTool?: string;
  templateId?: string;
  rationale: string;
}

interface ExecutionPlanV2 {
  architecturalSummary: string;
  techStack: TechStackV2;
  steps: PlannedStepV2[];
  criticScore?: number;
  criticRisks?: string[];
}

interface WorkerStepInput {
  step: PlannedStepV2;
  contextSidecar: string[];
  previousCommitHash?: string;
  repoState: "fresh" | "continue" | "rewind";
  gitSetupCommand?: string;
  fullPlan: ExecutionPlanV2;
  currentStepIndex: number;
  totalSteps: number;
  resolvedReferenceFiles?: string[];
  unresolvedReferenceInstructions?: string[];
}

const VERIFICATION_STRATEGIES: Record<string, string> = {
  logic: "Strict TDD: Write failing test first, then implement until test passes",
  ui: "Structural: Ensure build passes, component mounts without errors",
  docs: "Linting: Run markdown linter, validate all links work",
  config: "Validation: Ensure config parses correctly with no syntax errors",
};

/**
 * Log helper that outputs to stderr (stdout is for markers)
 */
function log(message: string): void {
  console.error(`[v2-step] ${message}`);
}

/**
 * Run a shell command and return output
 */
function runCommand(cmd: string, cwd?: string): string {
  log(`Running: ${cmd}`);
  try {
    return execSync(cmd, {
      cwd,
      encoding: "utf-8",
      stdio: ["inherit", "pipe", "pipe"],
    });
  } catch (error: unknown) {
    const execError = error as { stderr?: string; message?: string };
    throw new Error(`Command failed: ${cmd}\n${execError.stderr || execError.message}`);
  }
}

/**
 * Parse the step input from environment variable or stdin
 */
async function parseStepInput(): Promise<WorkerStepInput> {
  // Check for V2_STEP_INPUT environment variable (set by entrypoint)
  const envInput = process.env.V2_STEP_INPUT;
  if (envInput) {
    log("Parsing step input from V2_STEP_INPUT environment variable");
    return JSON.parse(envInput);
  }

  // Fall back to stdin
  log("Parsing step input from stdin");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const input = Buffer.concat(chunks).toString("utf-8");
  return JSON.parse(input);
}

/**
 * Execute git setup command (reset + clean for rewinds)
 */
function executeGitSetup(gitSetupCommand: string | undefined, workDir: string): void {
  if (!gitSetupCommand) {
    log("No git setup command needed");
    return;
  }

  log(`Executing git setup: ${gitSetupCommand}`);
  try {
    runCommand(gitSetupCommand, workDir);
    log("Git setup completed successfully");
  } catch (error) {
    log(`Git setup failed: ${error}`);
    throw error;
  }
}

/**
 * Build the prompt for the AI agent based on step input
 */
function buildStepPrompt(
  input: WorkerStepInput,
  resolvedRefs: string[],
  unresolvedInstructions: string[]
): string {
  const { step, contextSidecar, fullPlan, currentStepIndex, totalSteps } = input;
  const verificationStrategy = VERIFICATION_STRATEGIES[step.verificationType];

  const parts: string[] = [];

  // Header
  parts.push(`***REMOVED*** V2 Pipeline Step ${currentStepIndex + 1}/${totalSteps}: ${step.title}`);
  parts.push("");

  // Architectural context
  parts.push("***REMOVED******REMOVED*** Project Context");
  parts.push(fullPlan.architecturalSummary);
  parts.push("");
  parts.push(`**Tech Stack:** ${fullPlan.techStack.language} / ${fullPlan.techStack.framework}`);
  if (fullPlan.techStack.styling) {
    parts.push(`**Styling:** ${fullPlan.techStack.styling}`);
  }
  if (fullPlan.techStack.database) {
    parts.push(`**Database:** ${fullPlan.techStack.database}`);
  }
  parts.push("");

  // Step details
  parts.push("***REMOVED******REMOVED*** Your Task");
  parts.push(step.description);
  parts.push("");

  // Target files
  parts.push("***REMOVED******REMOVED*** Target Files (create/modify)");
  for (const file of step.targetFiles) {
    parts.push(`- ${file}`);
  }
  parts.push("");

  // Reference files
  if (resolvedRefs.length > 0 || unresolvedInstructions.length > 0) {
    parts.push("***REMOVED******REMOVED*** Reference Files (read for context)");

    if (resolvedRefs.length > 0) {
      parts.push("**Files to read:**");
      for (const file of resolvedRefs) {
        parts.push(`- ${file}`);
      }
    }

    if (unresolvedInstructions.length > 0) {
      parts.push("");
      parts.push("**Files to find:**");
      for (const instruction of unresolvedInstructions) {
        parts.push(`- ${instruction}`);
      }
    }
    parts.push("");
  }

  // Verification
  parts.push("***REMOVED******REMOVED*** Verification Requirements");
  parts.push(`**Type:** ${step.verificationType}`);
  parts.push(`**Strategy:** ${verificationStrategy}`);
  parts.push("");
  parts.push("**Specific Instructions:**");
  parts.push(step.verificationInstructions);
  parts.push("");

  // Context sidecar (learned constraints)
  if (contextSidecar.length > 0) {
    parts.push("***REMOVED******REMOVED*** IMPORTANT: Learned Constraints");
    parts.push("These constraints were learned from previous failures. You MUST follow them:");
    parts.push("");
    for (const constraint of contextSidecar) {
      parts.push(`- ${constraint}`);
    }
    parts.push("");
  }

  // Completion instructions
  parts.push("***REMOVED******REMOVED*** Completion");
  parts.push("When you complete this step successfully:");
  parts.push("1. Ensure all verification requirements pass");
  parts.push("2. Commit your changes with a descriptive message");
  parts.push("3. Output the marker: `::step_result::STEP_COMPLETE`");
  parts.push("4. Output the commit hash: `::step_commit::<hash>`");
  parts.push("");
  parts.push("If you cannot complete this step:");
  parts.push("1. Output `::step_result::STEP_FAILED`");
  parts.push("2. Output `::step_error::<description of what failed>`");
  parts.push("3. Optionally suggest a constraint: `::step_constraint::<lesson learned>`");
  parts.push("");

  return parts.join("\n");
}

/**
 * Main V2 step processor
 */
async function main(): Promise<void> {
  const workDir = process.cwd();
  log(`Starting V2 step processor in ${workDir}`);

  // Parse step input
  let input: WorkerStepInput;
  try {
    input = await parseStepInput();
    log(`Processing step ${input.currentStepIndex + 1}/${input.totalSteps}: ${input.step.title}`);
  } catch (error) {
    console.error(`Failed to parse step input: ${error}`);
    console.log("::step_result::STEP_FAILED");
    console.log("::step_error::Failed to parse V2 step input");
    process.exit(1);
  }

  // Execute git setup command (handles rewinds with git clean)
  try {
    executeGitSetup(input.gitSetupCommand, workDir);
  } catch (error) {
    console.log("::step_result::STEP_FAILED");
    console.log(`::step_error::Git setup failed: ${error}`);
    process.exit(1);
  }

  // Resolve reference file patterns
  let resolvedRefs: string[] = [];
  let unresolvedInstructions: string[] = [];

  if (input.step.referenceFiles && input.step.referenceFiles.length > 0) {
    log("Resolving reference file patterns...");
    const resolution = await resolveReferenceFiles(input.step.referenceFiles, workDir);
    resolvedRefs = resolution.resolvedPaths;
    unresolvedInstructions = resolution.unresolvedInstructions;

    log(`Resolved ${resolvedRefs.length} files, ${unresolvedInstructions.length} need agent search`);
    for (const line of resolution.log) {
      log(line);
    }
  }

  // Build the step prompt
  const prompt = buildStepPrompt(input, resolvedRefs, unresolvedInstructions);

  // Write prompt to file for the main entrypoint to use
  const promptFile = "/tmp/v2_step_prompt.txt";
  await fs.writeFile(promptFile, prompt, "utf-8");
  log(`Step prompt written to ${promptFile}`);

  // Output the prompt file path for the entrypoint
  console.log(`V2_PROMPT_FILE=${promptFile}`);

  // Output step metadata for logging
  console.log(`V2_STEP_INDEX=${input.currentStepIndex}`);
  console.log(`V2_STEP_TITLE=${input.step.title}`);
  console.log(`V2_STEP_PERSONA=${input.step.persona}`);
  console.log(`V2_STEP_VERIFICATION=${input.step.verificationType}`);
  console.log(`V2_TOTAL_STEPS=${input.totalSteps}`);
}

main().catch((error) => {
  console.error(`V2 step processor error: ${error}`);
  console.log("::step_result::STEP_FAILED");
  console.log(`::step_error::Step processor crashed: ${error}`);
  process.exit(1);
});
