"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const resolve_reference_files_1 = require("./resolve-reference-files");
const VERIFICATION_STRATEGIES = {
    logic: "Strict TDD: Write failing test first, then implement until test passes",
    ui: "Structural: Ensure build passes, component mounts without errors",
    docs: "Linting: Run markdown linter, validate all links work",
    config: "Validation: Ensure config parses correctly with no syntax errors",
};
/**
 * Log helper that outputs to stderr (stdout is for markers)
 */
function log(message) {
    console.error(`[v2-step] ${message}`);
}
/**
 * Run a shell command and return output
 */
function runCommand(cmd, cwd) {
    log(`Running: ${cmd}`);
    try {
        return (0, child_process_1.execSync)(cmd, {
            cwd,
            encoding: "utf-8",
            stdio: ["inherit", "pipe", "pipe"],
        });
    }
    catch (error) {
        const execError = error;
        throw new Error(`Command failed: ${cmd}\n${execError.stderr || execError.message}`);
    }
}
/**
 * Parse the step input from environment variable or stdin
 */
async function parseStepInput() {
    // Check for V2_STEP_INPUT environment variable (set by entrypoint)
    const envInput = process.env.V2_STEP_INPUT;
    if (envInput) {
        log("Parsing step input from V2_STEP_INPUT environment variable");
        return JSON.parse(envInput);
    }
    // Fall back to stdin
    log("Parsing step input from stdin");
    const chunks = [];
    for await (const chunk of process.stdin) {
        chunks.push(chunk);
    }
    const input = Buffer.concat(chunks).toString("utf-8");
    return JSON.parse(input);
}
/**
 * Execute git setup command (reset + clean for rewinds)
 */
function executeGitSetup(gitSetupCommand, workDir) {
    if (!gitSetupCommand) {
        log("No git setup command needed");
        return;
    }
    log(`Executing git setup: ${gitSetupCommand}`);
    try {
        runCommand(gitSetupCommand, workDir);
        log("Git setup completed successfully");
    }
    catch (error) {
        log(`Git setup failed: ${error}`);
        throw error;
    }
}
/**
 * Build the prompt for the AI agent based on step input
 */
function buildStepPrompt(input, resolvedRefs, unresolvedInstructions) {
    const { step, contextSidecar, fullPlan, currentStepIndex, totalSteps } = input;
    const verificationStrategy = VERIFICATION_STRATEGIES[step.verificationType];
    const parts = [];
    // Header
    parts.push(`# V2 Pipeline Step ${currentStepIndex + 1}/${totalSteps}: ${step.title}`);
    parts.push("");
    // Architectural context
    parts.push("## Project Context");
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
    parts.push("## Your Task");
    parts.push(step.description);
    parts.push("");
    // Target files
    parts.push("## Target Files (create/modify)");
    for (const file of step.targetFiles) {
        parts.push(`- ${file}`);
    }
    parts.push("");
    // Reference files
    if (resolvedRefs.length > 0 || unresolvedInstructions.length > 0) {
        parts.push("## Reference Files (read for context)");
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
    parts.push("## Verification Requirements");
    parts.push(`**Type:** ${step.verificationType}`);
    parts.push(`**Strategy:** ${verificationStrategy}`);
    parts.push("");
    parts.push("**Specific Instructions:**");
    parts.push(step.verificationInstructions);
    parts.push("");
    // Context sidecar (learned constraints)
    if (contextSidecar.length > 0) {
        parts.push("## IMPORTANT: Learned Constraints");
        parts.push("These constraints were learned from previous failures. You MUST follow them:");
        parts.push("");
        for (const constraint of contextSidecar) {
            parts.push(`- ${constraint}`);
        }
        parts.push("");
    }
    // Completion instructions
    parts.push("## Completion");
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
async function main() {
    const workDir = process.cwd();
    log(`Starting V2 step processor in ${workDir}`);
    // Parse step input
    let input;
    try {
        input = await parseStepInput();
        log(`Processing step ${input.currentStepIndex + 1}/${input.totalSteps}: ${input.step.title}`);
    }
    catch (error) {
        console.error(`Failed to parse step input: ${error}`);
        console.log("::step_result::STEP_FAILED");
        console.log("::step_error::Failed to parse V2 step input");
        process.exit(1);
    }
    // Execute git setup command (handles rewinds with git clean)
    try {
        executeGitSetup(input.gitSetupCommand, workDir);
    }
    catch (error) {
        console.log("::step_result::STEP_FAILED");
        console.log(`::step_error::Git setup failed: ${error}`);
        process.exit(1);
    }
    // Resolve reference file patterns
    let resolvedRefs = [];
    let unresolvedInstructions = [];
    if (input.step.referenceFiles && input.step.referenceFiles.length > 0) {
        log("Resolving reference file patterns...");
        const resolution = await (0, resolve_reference_files_1.resolveReferenceFiles)(input.step.referenceFiles, workDir);
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
    await fs_1.promises.writeFile(promptFile, prompt, "utf-8");
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
