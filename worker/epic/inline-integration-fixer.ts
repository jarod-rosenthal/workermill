/**
 * Inline Integration Fix Agent for Epic Mode
 *
 * Runs quality gates on the consolidated feature branch after all story branches
 * are merged but BEFORE the Tech Lead review. If gates fail, spawns a fix agent
 * with full access to the consolidated branch to resolve cross-story integration issues.
 * Follows the InlineCIFixer pattern.
 */

import type { AxiosInstance } from "axios";
import { createLogsApi } from "../lib/api-client.js";
import { execSync, spawn } from "child_process";
import { existsSync, readdirSync, statSync } from "fs";
import { runAgent, type AgentOptions, type AgentResult } from "./agent-sdk.js";
import { runGateCommand, loadRepoContext, isDockerDaemonReachable } from "./gate-utils.js";
import type { ContextMessage, EpicConfig, StreamMessage } from "./types.js";
import {
  createAIClient,
  type AIClient,
  type AIClientOptions,
  type AIProvider,
} from "./ai-client-types.js";

/**
 * Integration fix decision from the agent.
 */
export type IntegrationFixDecision = "passed" | "fixed" | "unfixable";

/**
 * Result of an inline integration fix attempt.
 */
export interface IntegrationFixResult {
  success: boolean;
  decision: IntegrationFixDecision;
  summary: string;
  error?: string;
}

/**
 * System prompt for the Integration Fix Agent.
 */
const INTEGRATION_FIX_SYSTEM_PROMPT = `You are an Integration Fix Agent. Multiple AI experts worked on separate story branches in parallel. Their code has been merged into a consolidated branch, but the merge introduced integration issues.

Fix ALL quality gate failures. You have access to ALL files in the repository.

## Common Integration Issues

- Missing props/types from one story expected by another
- Duplicate test query selectors or test IDs
- Conflicting imports or re-exports
- Merge artifacts (<<<< ==== >>>>)
- Incompatible function signatures across story boundaries
- Missing dependencies that one story assumed another would provide
- Service startup failures (missing env vars, database not seeded, wrong port bindings)
- Middleware configuration errors (wrong order, missing CORS, auth misconfiguration)

## Service Logs

When available, service logs from docker compose are included in the failure output.
These logs often reveal the ROOT CAUSE of E2E failures — check them FIRST before looking at test output.
Common patterns:
- "connection refused" → service not started or wrong port
- "relation does not exist" → missing database migration
- "unauthorized" / "403" → auth/middleware misconfiguration
- "ECONNREFUSED" → service dependency not ready

## Rules

- Fix EVERY failing command, not just the first
- Run each command after fixing to verify
- Do NOT refactor beyond what's needed to pass gates
- Commit with message "fix: resolve integration issues from story consolidation"
- Push to current branch
- **NEVER change language versions** (Go version in go.mod/Dockerfile, Node.js version, Python version, etc.). Version pins are intentional architectural decisions from the project specification. Fix the code to work with the specified version — do NOT downgrade the language.
- **NEVER change framework or dependency major versions** unless the error explicitly shows an incompatibility that cannot be resolved any other way.
- **NEVER modify configuration files** (pyproject.toml, tsconfig.json, .eslintrc, ruff.toml, etc.) to suppress lint/type errors. Fix the CODE that triggers the error — change variable names, add type annotations, remove unused imports, etc. Configuration files are set by the project specification and must not be altered.

## Organization Guidelines

If the following org-level guidelines were provided, follow them:

{{ORG_GUIDELINES}}

## Output Format

After fixing (or determining it's unfixable), you MUST output these markers:

\`\`\`
INTEGRATION_FIX_DECISION: passed | fixed | unfixable
\`\`\`

Then add:
\`\`\`
INTEGRATION_FIX_SUMMARY: <description of what you fixed or why it's unfixable>
\`\`\`

## Communication Style

Write in a professional, direct tone. Do NOT open messages with filler words or pleasantries like "Perfect!", "Great!", "Awesome!", "Sure!", "Absolutely!", or similar. Start with the substance — what you found, your assessment, or what needs to change. Be concise and informative.
`;

/**
 * Inline Integration Fix Agent for Epic mode.
 *
 * Runs quality gates on the consolidated branch after PR creation.
 * If gates fail, spawns an agent to fix cross-story integration issues.
 */
export class InlineIntegrationFixer {
  private config: EpicConfig;
  private repoPath: string;
  private logsApi: AxiosInstance;
  private allOutput: string = "";
  private aiClient: AIClient | null = null;
  private model: string;

  constructor(config: EpicConfig, repoPath: string) {
    this.config = config;
    this.repoPath = repoPath;
    this.model = process.env.MANAGER_MODEL || config.model || "";

    this.logsApi = createLogsApi(config);

    if (config.useUnifiedClient) {
      const provider = (config.workerProvider || "anthropic") as AIProvider;
      const isAnthropic = provider === "anthropic";
      this.aiClient = createAIClient({
        provider,
        apiKeys: {
          anthropic: isAnthropic ? config.anthropicApiKey : undefined,
          ollamaHost: provider === "ollama" ? (process.env.OLLAMA_HOST || "http://localhost:11434") : undefined,
        },
        apiConfig: {
          baseUrl: config.apiBaseUrl,
          orgApiKey: config.orgApiKey,
        },
        useAgentSdk: isAnthropic,
        githubToken: config.githubToken,
        oauthToken: isAnthropic && !config.anthropicApiKey ? "mounted" : undefined,
      });
    }
  }

  /**
   * Execute an agent using either the unified AIClient or legacy runAgent.
   */
  private async executeAgent(
    options: AgentOptions,
    storyId: string,
    onMessage?: (msg: StreamMessage) => void
  ): Promise<AgentResult> {
    if (
      this.config.useUnifiedClient &&
      this.aiClient &&
      options.expertConfig
    ) {
      const clientOptions: AIClientOptions = {
        prompt: options.prompt,
        systemPrompt: options.expertConfig.systemPrompt,
        persona: options.expertConfig.persona,
        model: options.expertConfig.model,
        workingDir: options.repoPath,
        storyId,
        parentTaskId: this.config.parentTaskId,
        env: options.env,
        tools: options.expertConfig.tools,
        onMessage,
      };
      const result = await this.aiClient.execute(clientOptions);
      return {
        success: result.success,
        messages: result.messages,
        error: result.error,
        structuredOutput: result.structuredOutput,
        rateLimited: result.rateLimited,
      };
    }
    return runAgent(this.config, { ...options, onMessage });
  }

  /**
   * Post a log message to the WorkerMill dashboard.
   */
  private async postLog(
    message: string,
    type: "system" | "manager" | "tool" | "output" | "error" = "output"
  ): Promise<void> {
    const prefix = "[🔗integration_agent🤖]";
    console.log(`${prefix} ${message}`);

    try {
      await this.logsApi.post("/api/control-center/logs", {
        taskId: this.config.parentTaskId,
        type,
        message: `${prefix} ${message}`,
        severity: type === "error" ? "error" : "info",
      });
    } catch {
      // Fire and forget - don't block on log failures
    }
  }

  /**
   * Run quality gates on the consolidated branch and fix if needed.
   */
  async fix(
    prNumber: number,
    qualityGateCommands: NonNullable<EpicConfig["qualityGateCommands"]>,
    maxRetries: number,
    completions?: ContextMessage[]
  ): Promise<IntegrationFixResult> {
    this.allOutput = "";

    if (!qualityGateCommands || qualityGateCommands.length === 0) {
      return { success: true, decision: "passed", summary: "No quality gates configured" };
    }

    await this.postLog("Starting integration quality gate check", "system");
    await this.postLog(`PR #${prNumber} — checking ${qualityGateCommands.length} gate(s)`, "system");

    try {
      await this.installSubdirectoryDeps();
      this.runToolInstaller();

      const gateResult = await this.runAllGates(qualityGateCommands);

      if (gateResult.passed) {
        await this.postLog("All integration gates passed", "system");
        return { success: true, decision: "passed", summary: "All quality gates passed on consolidated branch" };
      }

      // Gates failed — enter fix-retry loop
      let lastOutput = gateResult.output;
      let lastFailedCommand = gateResult.failedCommand;
      const failureHistory: string[] = [lastOutput];

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const ownershipContext = completions?.length
          ? this.buildOwnershipContext(lastOutput, completions)
          : "";

        if (ownershipContext) {
          await this.postLog(
            `Identified story ownership for failing files — enriching fix agent with context`,
            "system"
          );
        }

        await this.postLog(
          `Integration gate failed: ${lastFailedCommand} — spawning fix agent (attempt ${attempt}/${maxRetries})`,
          "error"
        );

        const fixResult = await this.runFixAgent(
          prNumber,
          qualityGateCommands,
          failureHistory.join("\n\n---\n\n"),
          lastFailedCommand,
          ownershipContext
        );

        if (!fixResult.success) {
          await this.postLog(`Fix agent failed: ${fixResult.error}`, "error");
          if (fixResult.error?.includes("unfixable")) {
            return {
              success: false,
              decision: "unfixable",
              summary: `Fix agent reports unfixable: ${fixResult.error}`,
              error: fixResult.error,
            };
          }
          continue;
        }

        // Verify gates pass after fix
        await this.postLog(`Verifying gates after fix attempt ${attempt}...`, "system");
        const verifyResult = await this.runAllGates(qualityGateCommands);

        if (verifyResult.passed) {
          await this.postLog(`All gates passing after fix attempt ${attempt}`, "system");
          return {
            success: true,
            decision: "fixed",
            summary: this.parseSummary() || `Fixed on attempt ${attempt}/${maxRetries}`,
          };
        }

        lastOutput = verifyResult.output;
        lastFailedCommand = verifyResult.failedCommand;
        failureHistory.push(lastOutput);
        await this.postLog(
          `Gates still failing after attempt ${attempt} — ${lastFailedCommand}`,
          "error"
        );
      }

      // All retries exhausted
      return {
        success: false,
        decision: "unfixable",
        summary: `Integration gates still failing after ${maxRetries} fix attempts: ${lastFailedCommand}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.postLog(`Integration fix failed: ${errorMessage}`, "error");
      return {
        success: false,
        decision: "unfixable",
        summary: `Integration fix error: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  /**
   * Run quality gates on a specific branch. Used by incremental integration
   * to validate each story merge independently.
   */
  async runGatesOnBranch(
    branch: string,
    qualityGateCommands: NonNullable<EpicConfig["qualityGateCommands"]>
  ): Promise<{ passed: boolean; output: string; failedCommand: string }> {
    // Checkout the branch
    try {
      execSync(`git fetch origin && git checkout ${branch} && git reset --hard origin/${branch}`, {
        cwd: this.repoPath,
        encoding: "utf-8",
        timeout: 120_000,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { passed: false, output: `Failed to checkout ${branch}: ${msg}`, failedCommand: "git checkout" };
    }

    // Install dependencies and run gates
    await this.installSubdirectoryDeps();
    this.runToolInstaller();
    return this.runAllGates(qualityGateCommands);
  }

  /**
   * Run all quality gate commands (not filtered by trigger — full integration check).
   */
  private async runAllGates(
    gates: NonNullable<EpicConfig["qualityGateCommands"]>
  ): Promise<{ passed: boolean; output: string; failedCommand: string }> {
    for (const gate of gates) {
      // Skip gate if none of the trigger directories exist in the repo.
      // Prevents failures like `cd web && npm run lint` when the `web/` directory
      // hasn't been created yet by any story in this run.
      // Triggers can be comma-separated: "src/**,tests/**" → check "src" OR "tests".
      // Extract directory prefix from each glob: "src/**/*.ts" → "src",
      // "**/*.{ts,tsx}" → "" (root), "web/*.js" → "web"
      const extractPrefix = (glob: string) =>
        glob
          .replace(/\/?\*\*.*$/g, "")   // strip /** and everything after (handles **, **/, **/*.ts)
          .replace(/\/?\*\..*/g, "")    // strip /*.ext patterns
          .replace(/\/?\{[^}]*\}.*/g, "") // strip /{...} patterns
          .replace(/\/?\*$/g, "")       // strip trailing *
          .replace(/\/+$/, "");         // strip trailing slashes
      const triggerParts = gate.trigger.split(",").map((t) => t.trim());
      const triggerPrefixes = triggerParts.map(extractPrefix);
      // Gate should run if ANY trigger directory exists (or if any trigger resolves to root "")
      const hasRootTrigger = triggerPrefixes.some((p) => p === "");
      const hasExistingDir = triggerPrefixes.some((p) => p && existsSync(`${this.repoPath}/${p}`));
      if (!hasRootTrigger && !hasExistingDir) {
        const missing = triggerPrefixes.filter(Boolean).join(", ");
        await this.postLog(`[Integration Gate] ⏭️ ${gate.name} gate skipped — no trigger directories found (${missing})`, "system");
        continue;
      }
      // Use first non-empty prefix for Go/Node checks below
      const triggerPrefix = triggerPrefixes.find((p) => p && existsSync(`${this.repoPath}/${p}`)) || "";

      // For Go gates, skip if go.mod doesn't exist in the target directory.
      const hasGoCommand = gate.commands.some((c) => /\bgo\s+(vet|test|build)\b/.test(c));
      if (hasGoCommand) {
        const goModPath = triggerPrefix
          ? `${this.repoPath}/${triggerPrefix}/go.mod`
          : `${this.repoPath}/go.mod`;
        if (!existsSync(goModPath)) {
          await this.postLog(`[Integration Gate] ⏭️ ${gate.name} gate skipped — no go.mod found`, "system");
          continue;
        }
      }

      // Skip gates requiring docker compose if docker daemon isn't reachable (sandbox containers)
      const hasDockerCompose = gate.commands.some((c) => /docker\s+compose/i.test(c));
      if (hasDockerCompose && !isDockerDaemonReachable()) {
        await this.postLog(`[Integration Gate] ⏭️ ${gate.name} gate skipped — Docker daemon not reachable`, "system");
        continue;
      }

      // For Node.js gates, skip if package.json doesn't exist in the target directory.
      const hasNpmCommand = gate.commands.some((c) => /\bnpm\s+run\b/.test(c));
      if (hasNpmCommand) {
        const pkgPath = triggerPrefix
          ? `${this.repoPath}/${triggerPrefix}/package.json`
          : `${this.repoPath}/package.json`;
        if (!existsSync(pkgPath)) {
          await this.postLog(`[Integration Gate] ⏭️ ${gate.name} gate skipped — no package.json found`, "system");
          continue;
        }
      }

      await this.postLog(`[Integration Gate] Running ${gate.name} (${gate.commands.length} commands)`, "system");

      for (let cmd of gate.commands) {
        // Fix common LLM mistake: gofmt doesn't support Go's "..." wildcard
        cmd = cmd.replace(
          /\bgofmt\b(.+?)\.\/([^\s]*)\.\.\./g,
          "gofmt$1./$2"
        );

        try {
          const result = await this.runGateCommand(cmd, this.repoPath, 300_000);
          const output = [result.stdout, result.stderr]
            .filter(Boolean)
            .join("\n");

          // Handle watch-mode processes
          const wasWatchMode =
            /waiting for file changes|press [hq] to/i.test(output);
          if (wasWatchMode) {
            const testsPassedPatterns = [
              /Tests?\s+\d+\s+passed/i,
              /Test Files?\s+\d+\s+passed/i,
              /Test Suites?:\s+\d+\s+passed/i,
            ];
            if (
              testsPassedPatterns.some((p) => p.test(output)) &&
              !/\d+\s+failed/i.test(output)
            ) {
              await this.postLog(`[Integration Gate] ✅ ${cmd}`, "system");
            } else {
              await this.postLog(`[Integration Gate] ❌ ${cmd}\n${output}`, "error");
              // Capture service logs if docker compose is running
              let enrichedOutput = output;
              if (isDockerDaemonReachable()) {
                try {
                  const serviceLogs = execSync("docker compose logs --tail=100 2>&1", {
                    cwd: this.repoPath,
                    encoding: "utf-8",
                    timeout: 10_000,
                  });
                  if (serviceLogs.trim()) {
                    enrichedOutput += "\n\n### Service Logs (docker compose logs)\n\n" + serviceLogs;
                  }
                } catch { /* ignore — best effort */ }
              }
              return { passed: false, output: enrichedOutput, failedCommand: cmd };
            }
          } else {
            await this.postLog(`[Integration Gate] ✅ ${cmd}`, "system");
          }
        } catch (error: unknown) {
          const stderr =
            error instanceof Error && "stderr" in error
              ? String((error as { stderr: unknown }).stderr).slice(0, 2000)
              : String(error).slice(0, 2000);
          const stdout =
            error instanceof Error && "stdout" in error
              ? String((error as { stdout: unknown }).stdout).slice(0, 2000)
              : "";
          const output = [stdout, stderr].filter(Boolean).join("\n");

          // "No test files found" is not a real failure
          const noTestsPatterns = [
            /no test files found/i,
            /no tests found/i,
            /no test suites found/i,
            /no tests to run/i,
            /collected 0 items/i,
          ];
          if (noTestsPatterns.some((p) => p.test(output))) {
            await this.postLog(`[Integration Gate] ⏭️ ${cmd} — no test files, skipping`, "system");
            continue;
          }

          await this.postLog(`[Integration Gate] ❌ ${cmd}\n${output}`, "error");
          // Capture service logs if docker compose is running
          let enrichedOutput = output;
          if (isDockerDaemonReachable()) {
            try {
              const serviceLogs = execSync("docker compose logs --tail=100 2>&1", {
                cwd: this.repoPath,
                encoding: "utf-8",
                timeout: 10_000,
              });
              if (serviceLogs.trim()) {
                enrichedOutput += "\n\n### Service Logs (docker compose logs)\n\n" + serviceLogs;
              }
            } catch { /* ignore — best effort */ }
          }
          return { passed: false, output: enrichedOutput, failedCommand: cmd };
        }
      }
    }

    return { passed: true, output: "", failedCommand: "" };
  }

  /**
   * Delegate to shared gate-utils.ts runGateCommand.
   */
  private runGateCommand(
    cmd: string,
    cwd: string,
    timeoutMs: number = 300_000
  ): Promise<{ stdout: string; stderr: string }> {
    return runGateCommand(cmd, cwd, timeoutMs);
  }

  /**
   * Install npm/yarn/pnpm deps in subdirectories that have package.json but no node_modules.
   * Reused from executor.ts findSubdirsNeedingInstall pattern.
   */
  private async installSubdirectoryDeps(): Promise<void> {
    try {
      const dirsToInstall = this.findSubdirsNeedingInstall(this.repoPath, 3);
      for (const dir of dirsToInstall) {
        const lockType = existsSync(`${dir}/pnpm-lock.yaml`)
          ? "pnpm"
          : existsSync(`${dir}/yarn.lock`)
            ? "yarn"
            : "npm";
        const installCmd =
          lockType === "pnpm"
            ? "pnpm install --frozen-lockfile"
            : lockType === "yarn"
              ? "yarn install --frozen-lockfile"
              : "npm ci";
        const relDir = dir.replace(this.repoPath + "/", "");
        await this.postLog(`[Integration Gate] Installing deps in ${relDir} (${lockType})`, "system");
        try {
          execSync(installCmd, {
            cwd: dir,
            encoding: "utf-8",
            timeout: 120_000,
            stdio: ["pipe", "pipe", "pipe"],
          });
        } catch {
          await this.postLog(`[Integration Gate] Warning: dep install failed in ${relDir}`, "system");
        }
      }
    } catch {
      // Scan itself failed — proceed without installing
    }
  }

  /**
   * Find subdirectories with package.json that need dep installation.
   * Always includes directories with package.json — even if node_modules/ exists —
   * because a partial node_modules can leave gate tools like eslint missing.
   */
  private findSubdirsNeedingInstall(
    root: string,
    maxDepth: number
  ): string[] {
    const results: string[] = [];
    const scan = (dir: string, depth: number) => {
      if (depth > maxDepth) return;
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry === "node_modules" || entry === ".git" || entry === ".next" || entry === "dist" || entry === "build") continue;
        const full = `${dir}/${entry}`;
        try {
          if (!statSync(full).isDirectory()) continue;
        } catch {
          continue;
        }
        if (existsSync(`${full}/package.json`)) {
          results.push(full);
        }
        scan(full, depth + 1);
      }
    };
    scan(root, 1);
    return results;
  }

  /**
   * Re-run tool installer if available (Docker containers only).
   */
  private runToolInstaller(): void {
    try {
      const fs = require("fs");
      fs.accessSync("/app/install-tools.sh");
      execSync(`/app/install-tools.sh "${this.repoPath}"`, {
        cwd: this.repoPath,
        encoding: "utf-8",
        timeout: 120_000,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      // Best effort — script missing (native agent) or install failed
    }
  }

  /**
   * Spawn the fix agent to resolve integration issues.
   */
  private async runFixAgent(
    prNumber: number,
    gates: NonNullable<EpicConfig["qualityGateCommands"]>,
    failureOutput: string,
    failedCommand: string,
    ownershipContext?: string
  ): Promise<AgentResult> {
    const prompt = this.buildFixPrompt(prNumber, gates, failureOutput, failedCommand, ownershipContext);

    const systemPrompt = INTEGRATION_FIX_SYSTEM_PROMPT.replace(
      "{{ORG_GUIDELINES}}",
      this.config.orgGuidelines
        ? this.config.orgGuidelines
        : "(none set — skip this section)"
    );

    const fixConfig = {
      persona: "qa_engineer" as const,
      description: "Integration fix specialist — cross-story issue resolution",
      systemPrompt,
      tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
      model: this.model,
      specialties: ["testing", "integration", "quality"],
      maxTurns: this.config.maxAgentTurns,
    };

    return this.executeAgent(
      {
        prompt,
        expertConfig: fixConfig,
        repoPath: this.repoPath,
        storyId: `integration-fix-${prNumber}`,
      },
      `integration-fix-${prNumber}`,
      (msg) => this.handleMessage(msg)
    );
  }

  /**
   * Build the user prompt for the fix agent.
   */
  private buildFixPrompt(
    prNumber: number,
    gates: NonNullable<EpicConfig["qualityGateCommands"]>,
    failureOutput: string,
    failedCommand: string,
    ownershipContext?: string
  ): string {
    const maxLogLength = 8 * 1024;
    const truncatedOutput =
      failureOutput.length > maxLogLength
        ? failureOutput.substring(failureOutput.length - maxLogLength)
        : failureOutput;

    const allCommands = gates
      .flatMap((g) => g.commands.map((c) => `  - ${c} (${g.name})`))
      .join("\n");

    const repoContext = loadRepoContext(this.repoPath);
    const repoContextSection = repoContext
      ? `\n### Repository Context (from AGENTS.md / CLAUDE.md)\n\n${repoContext}\n`
      : "";

    const ownershipSection = ownershipContext ? `\n${ownershipContext}\n` : "";

    const requirementsSection = this.config.jiraRequirements
      ? `\n### Project Requirements (PRD)\n\n${this.config.jiraRequirements}\n`
      : "";

    return `## Integration Gate Failure on PR #${prNumber}

**Repository:** ${this.config.targetRepo}
${repoContextSection}${requirementsSection}${ownershipSection}
### Failed Command

\`${failedCommand}\`

### Failure Output

\`\`\`
${truncatedOutput}
\`\`\`

### All Quality Gate Commands

${allCommands}

### Instructions

This is a consolidated branch where multiple expert story branches have been merged.
The failure is likely caused by cross-story integration issues, not a bug in any single story.

1. Diagnose the root cause of the failure
2. Fix ALL integration issues (there may be more than what the first failing command shows)
3. Run each quality gate command to verify your fixes
4. Commit with message "fix: resolve integration issues from story consolidation"
5. Push to the current branch`;
  }

  /**
   * Normalize a file path for comparison. Gate failure output emits paths in
   * many forms: absolute (/workspace/api/src/foo.ts), relative with dot prefix
   * (./src/foo.ts), or plain relative (src/foo.ts). Git metadata uses
   * repo-root-relative paths. This strips common prefixes so suffix matching works.
   */
  normalizePath(p: string): string {
    return p
      .replace(/^\.\//, "")
      .replace(/^\/.*?\/(workspace|repo)\//, "");
  }

  /**
   * Check if two paths refer to the same file using suffix matching.
   */
  pathsMatch(a: string, b: string): boolean {
    const na = this.normalizePath(a);
    const nb = this.normalizePath(b);
    return na === nb || na.endsWith("/" + nb) || nb.endsWith("/" + na);
  }

  /**
   * Build ownership context from gate failure output and story completions.
   * Returns a formatted section describing which stories own which failing files,
   * or empty string if no ownership could be determined.
   */
  buildOwnershipContext(
    failureOutput: string,
    completions: ContextMessage[]
  ): string {
    const knownExtensions = /\.(py|ts|tsx|js|jsx|go|rs|java|rb|vue|svelte|css|scss|sql|sh|yaml|yml|json|toml)\b/;
    const filePathPattern = /([\w./-]+\/[\w./-]+\.\w+)/gm;
    const failedFiles = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = filePathPattern.exec(failureOutput)) !== null) {
      const candidate = match[1];
      if (knownExtensions.test(candidate)) {
        failedFiles.add(candidate);
      }
    }

    if (failedFiles.size === 0) return "";

    const storyContext: string[] = [];

    for (const completion of completions) {
      const meta = completion.metadata || {};
      const storyIndex = meta.storyIndex as number;
      const description = (meta.description as string) || completion.content;
      const filesModified = (meta.filesModified as string[]) || [];
      const targetFiles = (meta.targetFiles as string[]) || [];
      const allStoryFiles = [...filesModified, ...targetFiles];

      const overlap = [...failedFiles].filter(f =>
        allStoryFiles.some(sf => this.pathsMatch(f, sf))
      );

      if (overlap.length > 0) {
        storyContext.push(
          `- **Story ${storyIndex}** (${completion.persona}): "${description}"\n` +
          `  Files in failure output: ${overlap.join(", ")}\n` +
          `  All files modified: ${filesModified.join(", ")}`
        );
      }
    }

    if (storyContext.length === 0) return "";

    return `### Story Ownership (which expert wrote what)\n\n` +
      `The following stories' code appears in the failure output. ` +
      `Focus your investigation on these files and understand the original intent:\n\n` +
      storyContext.join("\n\n");
  }

  /**
   * Parse INTEGRATION_FIX_DECISION from agent output.
   */
  private parseDecision(): IntegrationFixDecision {
    const match = this.allOutput.match(
      /INTEGRATION_FIX_DECISION:\s*(passed|fixed|unfixable)/i
    );
    if (match) {
      return match[1].toLowerCase() as IntegrationFixDecision;
    }
    return "unfixable";
  }

  /**
   * Parse INTEGRATION_FIX_SUMMARY from agent output.
   */
  private parseSummary(): string {
    const match = this.allOutput.match(/INTEGRATION_FIX_SUMMARY:\s*(.+)/i);
    if (match) {
      return match[1].trim();
    }
    return "No summary provided";
  }

  /**
   * Handle streaming messages from the agent.
   */
  private handleMessage(msg: StreamMessage): void {
    if (msg.type === "thinking" && msg.content) {
      this.postLog(`[THINKING] ${msg.content}`, "output");
    } else if (msg.type === "tool_use" && msg.toolName) {
      let toolMsg = `Tool: ${msg.toolName}`;
      if (msg.toolInput) {
        const input = msg.toolInput;
        if (input.command)
          toolMsg += ` -> ${String(input.command).substring(0, 500)}`;
        else if (input.file_path) toolMsg += ` -> ${input.file_path}`;
      }
      this.postLog(toolMsg, "tool");
    } else if (msg.type === "text" && msg.content) {
      this.allOutput += msg.content + "\n";
      if (msg.content.length > 20) {
        this.postLog(msg.content, "output");
      }
    } else if (msg.type === "result" && msg.content) {
      this.allOutput += msg.content + "\n";
      this.postLog(msg.content, "output");
    }
  }
}
