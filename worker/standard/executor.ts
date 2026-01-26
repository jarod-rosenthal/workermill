/**
 * Standard Executor
 *
 * SDK-based executor for standard (non-Epic) WorkerMill tasks.
 * Uses Claude Agent SDK for execution with inline review/deploy/improve phases.
 *
 * Mirrors Epic mode functionality but for single-task execution.
 */

import axios from "axios";
import * as fs from "fs/promises";
import { simpleGit, SimpleGit } from "simple-git";
import { runAgent } from "../epic/agent-sdk.js";
import { InlineReviewer } from "../epic/inline-reviewer.js";
import { InlineDeployer } from "../epic/inline-deployer.js";
import { InlineImprover } from "../epic/inline-improver.js";
import type { EpicConfig, StreamMessage, ExpertConfig } from "../epic/types.js";
import type { StandardConfig, StandardResult, StandardExpertConfig } from "./types.js";

/**
 * Standard task executor using Claude Agent SDK.
 */
export class StandardExecutor {
  private config: StandardConfig;
  private epicConfig: EpicConfig;
  private logsApi: ReturnType<typeof axios.create>;
  private git: SimpleGit;
  private repoPath: string = "/workspace";
  private allOutput: string = "";

  constructor(config: StandardConfig) {
    this.config = config;

    // Build EpicConfig for compatibility with inline phases
    this.epicConfig = {
      parentTaskId: config.taskId,
      apiBaseUrl: config.apiBaseUrl,
      orgApiKey: config.orgApiKey,
      anthropicApiKey: config.anthropicApiKey,
      githubToken: config.githubToken,
      githubReviewerToken: config.githubReviewerToken,
      targetRepo: config.targetRepo,
      model: config.model,
      jiraIssueKey: config.jiraIssueKey,
      reviewEnabled: config.reviewEnabled,
      deploymentEnabled: config.deploymentEnabled,
      improvementEnabled: config.improvementEnabled,
      reviewFeedback: config.reviewFeedback,
    };

    // Create axios instance for posting logs
    this.logsApi = axios.create({
      baseURL: config.apiBaseUrl,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.orgApiKey,
      },
      timeout: 5000,
    });

    this.git = simpleGit();
  }

  /**
   * Post a log message to the WorkerMill dashboard.
   */
  private async postLog(
    message: string,
    type: "system" | "manager" | "tool" | "output" | "error" = "output"
  ): Promise<void> {
    console.log(`[Standard] ${message}`);

    try {
      await this.logsApi.post("/api/control-center/logs", {
        taskId: this.config.taskId,
        type,
        message: `[${this.config.persona}] ${message}`,
        severity: type === "error" ? "error" : "info",
      });
    } catch {
      // Fire and forget - don't block on log failures
    }
  }

  /**
   * Update task status in the WorkerMill API.
   */
  private async updateTaskStatus(
    status: "running" | "completed" | "failed",
    result?: string
  ): Promise<void> {
    try {
      await this.logsApi.put(`/api/control-center/tasks/${this.config.taskId}/status`, {
        status,
        result,
      });
    } catch (error) {
      console.error("[Standard] Failed to update task status:", error);
    }
  }

  /**
   * Clone the target repository.
   */
  private async cloneRepository(): Promise<void> {
    await this.postLog(`Cloning repository: ${this.config.targetRepo}`, "system");

    // Extract owner and repo from full repo path
    const [owner, repo] = this.config.targetRepo.split("/").slice(-2);
    const cloneUrl = `https://x-access-token:${this.config.githubToken}@github.com/${owner}/${repo}.git`;

    // Clean workspace and clone
    await fs.rm(this.repoPath, { recursive: true, force: true });
    await fs.mkdir(this.repoPath, { recursive: true });

    this.git = simpleGit(this.repoPath);
    await this.git.clone(cloneUrl, this.repoPath);

    // Configure git
    await this.git.addConfig("user.email", "worker@workermill.com");
    await this.git.addConfig("user.name", "WorkerMill AI");

    await this.postLog("Repository cloned successfully", "system");
  }

  /**
   * Create a feature branch for the task.
   */
  private async createFeatureBranch(): Promise<string> {
    const branchName =
      this.config.branchName ||
      `feature/${this.config.jiraIssueKey || this.config.taskId}-${Date.now()}`;

    await this.git.checkoutLocalBranch(branchName);
    await this.postLog(`Created branch: ${branchName}`, "system");

    return branchName;
  }

  /**
   * Load directive content for the persona.
   */
  private async loadDirective(): Promise<string> {
    const directivePath = `/app/directives/${this.config.persona}/README.md`;

    try {
      const content = await fs.readFile(directivePath, "utf-8");
      await this.postLog(`Loaded directive for ${this.config.persona} (${content.length} chars)`, "system");
      return content;
    } catch {
      await this.postLog(`No directive found for ${this.config.persona}, using default`, "system");
      return "";
    }
  }

  /**
   * Load common directive content.
   */
  private async loadCommonDirective(): Promise<string> {
    const commonPath = "/app/directives/common/README.md";

    try {
      const content = await fs.readFile(commonPath, "utf-8");
      return content;
    } catch {
      return "";
    }
  }

  /**
   * Load AGENTS.md workflow instructions.
   */
  private async loadAgentsMd(): Promise<string> {
    const agentsMdPath = "/app/AGENTS.md";

    try {
      const content = await fs.readFile(agentsMdPath, "utf-8");
      return content;
    } catch {
      return "";
    }
  }

  /**
   * Build the task prompt.
   */
  private async buildPrompt(branchName: string): Promise<string> {
    const directive = await this.loadDirective();
    const commonDirective = await this.loadCommonDirective();
    const agentsMd = await this.loadAgentsMd();

    // Build target files section
    let targetFilesSection = "- Not specified (you choose based on task)";
    if (this.config.targetFiles && this.config.targetFiles.length > 0) {
      targetFilesSection = this.config.targetFiles.map((f) => `- ${f}`).join("\n");
    }

    // Build reference files section
    let referenceFilesSection = "- None specified";
    if (this.config.referenceFiles && this.config.referenceFiles.length > 0) {
      referenceFilesSection = this.config.referenceFiles.map((f) => `- ${f}`).join("\n");
    }

    // Build revision section if this is a revision run
    let revisionSection = "";
    if (this.config.reviewFeedback) {
      revisionSection = `
## ⚠️ REVISION REQUIRED - Manager Feedback ⚠️

**THIS IS A REVISION RUN.** Your previous PR was reviewed and changes were requested.

**You MUST address the following feedback from the Tech Lead/Manager:**

${this.config.reviewFeedback}

---

**Instructions for this revision:**
1. **Read the feedback carefully** - understand what issues were identified
2. **Check your existing PR branch** - your previous code is still there
3. **Fix the specific issues mentioned** - focus on the feedback points
4. **Do not start from scratch** - improve your existing implementation
5. **Update the PR** - commit fixes and push to update the existing PR

**The reviewer will specifically check if you addressed each point above.**
`;
    }

    const prompt = `You are an AI Worker executing a task from WorkerMill.

## Task Information
- **Ticket**: ${this.config.jiraIssueKey || "N/A"}
- **Summary**: ${this.config.ticketSummary || "N/A"}
- **Persona**: ${this.config.persona}
- **Branch**: ${branchName}
- **Deploy Label**: ${this.config.deploymentEnabled || false}
- **Review Label**: ${this.config.reviewEnabled || false}

## Task Description
${this.config.ticketDescription || "No description provided."}
${revisionSection}

## File Targeting (Cost-First Optimization)

The planning agent has identified specific files to focus on. Use this guidance:

**Target Files (files to modify):**
${targetFilesSection}

**Reference Files (files to read for context/patterns):**
${referenceFilesSection}

Use these target files to scope your work efficiently. If target files are empty, analyze the task and choose the most important files to modify.

## Your Role & Directives

You are acting as a **${this.config.persona}**. Follow these directives:

${directive}

## Common Guidelines

${commonDirective}

## Agent Workflow

${agentsMd}

## Environment Variables Available
- TICKET_KEY=${this.config.jiraIssueKey || ""}
- TICKET_SUMMARY=${this.config.ticketSummary || ""}
- GITHUB_TOKEN is configured
- DEPLOYMENT_ENABLED=${this.config.deploymentEnabled || false}

## Output Markers
When complete, output these markers (the orchestrator parses them):
- ::result::review_requested (if you created a PR needing review)
- ::result::deployed (if you deployed)
- ::result::failed (if something went wrong)
- ::pr_url::<url> (the PR URL)
- ::input_tokens::<count> for token tracking
- ::output_tokens::<count> for token tracking

## Instructions

1. Analyze the task and understand what needs to be done
2. Read the relevant codebase files to understand context
3. Make the necessary code changes
4. Create a PR with your changes
5. Output the appropriate result markers

Begin working on this task now.`;

    return prompt;
  }

  /**
   * Build expert configuration for the agent.
   */
  private buildExpertConfig(): StandardExpertConfig {
    const model = this.config.model || "sonnet";

    return {
      persona: this.config.persona,
      description: `${this.config.persona} executing standard task`,
      systemPrompt: `You are a ${this.config.persona} working on a coding task. You have full access to the repository and can make code changes, run tests, and create PRs.

Work methodically:
1. Understand the task requirements
2. Explore the codebase to understand existing patterns
3. Make targeted, minimal changes
4. Test your changes where possible
5. Create a clean PR with descriptive commit messages

Be conservative and avoid over-engineering. Only make changes that are directly requested.`,
      tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
      model,
      specialties: [],
    };
  }

  /**
   * Handle messages from agent execution.
   */
  private handleMessage(msg: StreamMessage): void {
    if (msg.type === "thinking" && msg.content) {
      // Log abbreviated thinking
      console.log(`[Standard] [THINKING] ${msg.content.substring(0, 150)}...`);
    } else if (msg.type === "tool_use" && msg.toolName) {
      let toolMsg = `Tool: ${msg.toolName}`;
      if (msg.toolInput) {
        const input = msg.toolInput;
        if (input.command) toolMsg += ` -> ${String(input.command).substring(0, 80)}`;
        else if (input.file_path) toolMsg += ` -> ${input.file_path}`;
      }
      console.log(`[Standard] ${toolMsg}`);
      this.postLog(toolMsg, "tool");
    } else if (msg.type === "text" && msg.content) {
      // Accumulate all text output
      this.allOutput += msg.content + "\n";

      // Log meaningful output
      if (msg.content.length > 20) {
        console.log(`[Standard] ${msg.content}`);
        this.postLog(msg.content.substring(0, 500), "output");
      }
    } else if (msg.type === "result" && msg.content) {
      this.allOutput += msg.content + "\n";
      console.log(`[Standard] Result: ${msg.content.substring(0, 200)}...`);
    }
  }

  /**
   * Parse PR URL from agent output.
   */
  private parsePrUrl(): string | undefined {
    const match = this.allOutput.match(/::pr_url::(\S+)/);
    return match ? match[1] : undefined;
  }

  /**
   * Parse result status from agent output.
   */
  private parseResultStatus(): string {
    const match = this.allOutput.match(/::result::(\w+)/);
    return match ? match[1] : "unknown";
  }

  /**
   * Run the standard task execution.
   */
  async execute(): Promise<StandardResult> {
    this.allOutput = "";

    await this.postLog("Starting standard SDK-based execution", "system");
    await this.postLog(`Task ID: ${this.config.taskId}`, "system");
    await this.postLog(`Persona: ${this.config.persona}`, "system");
    await this.postLog(`Target Repo: ${this.config.targetRepo}`, "system");

    try {
      // Update task status to running
      await this.updateTaskStatus("running");

      // Clone repository
      await this.cloneRepository();

      // Create feature branch
      const branchName = await this.createFeatureBranch();

      // Build prompt
      const prompt = await this.buildPrompt(branchName);

      // Build expert config
      const expertConfig = this.buildExpertConfig();

      await this.postLog(`Using model: ${expertConfig.model}`, "system");

      // Run the agent
      const result = await runAgent(this.epicConfig, {
        prompt,
        expertConfig: expertConfig as ExpertConfig,
        repoPath: this.repoPath,
        storyId: this.config.taskId,
        onMessage: (msg) => this.handleMessage(msg),
      });

      if (!result.success) {
        await this.postLog(`Task execution failed: ${result.error}`, "error");
        await this.updateTaskStatus("failed", "failed");
        return {
          success: false,
          error: result.error,
        };
      }

      // Parse results
      const prUrl = this.parsePrUrl();
      const resultStatus = this.parseResultStatus();

      await this.postLog(`Task execution completed with status: ${resultStatus}`, "system");
      if (prUrl) {
        await this.postLog(`PR URL: ${prUrl}`, "system");
      }

      // Initialize result
      const standardResult: StandardResult = {
        success: true,
        prUrl,
      };

      // Run inline phases if enabled and PR was created
      if (prUrl) {
        // Extract PR number from URL (format: https://github.com/owner/repo/pull/123)
        const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
        const prNumber = prNumberMatch ? parseInt(prNumberMatch[1], 10) : 0;

        if (prNumber === 0) {
          await this.postLog(`Could not extract PR number from URL: ${prUrl}`, "error");
        }

        // Inline Review
        if (this.config.reviewEnabled && prNumber > 0) {
          await this.postLog("Running inline review...", "system");
          try {
            const reviewer = new InlineReviewer(this.epicConfig, this.repoPath);
            const reviewResult = await reviewer.review(prUrl, prNumber);
            standardResult.reviewResult = reviewResult.decision;
            await this.postLog(`Review result: ${reviewResult.decision}`, "system");

            // If revision needed, don't proceed to deploy
            if (reviewResult.decision === "revision_needed") {
              await this.updateTaskStatus("completed", "revision_needed");
              return standardResult;
            }
          } catch (reviewError) {
            await this.postLog(`Review failed (non-fatal): ${reviewError}`, "error");
            standardResult.reviewResult = "skipped";
          }
        }

        // Inline Deploy
        if (this.config.deploymentEnabled && prNumber > 0) {
          await this.postLog("Running inline deployment...", "system");
          try {
            const deployer = new InlineDeployer(this.epicConfig, this.repoPath);
            const deployResult = await deployer.deploy(prUrl, prNumber);
            standardResult.deployResult = deployResult.success ? "deployed" : "failed";
            await this.postLog(`Deploy result: ${standardResult.deployResult}`, "system");
          } catch (deployError) {
            await this.postLog(`Deploy failed (non-fatal): ${deployError}`, "error");
            standardResult.deployResult = "failed";
          }
        }
      }

      // Inline Improve (runs regardless of PR)
      if (this.config.improvementEnabled) {
        await this.postLog("Running inline improvement analysis...", "system");
        try {
          const improver = new InlineImprover(this.epicConfig);
          const improveResult = await improver.improve();
          standardResult.improveResult = {
            improvementsApplied: improveResult.improvementsApplied,
            summary: improveResult.summary,
            changedFiles: improveResult.changedFiles,
          };
          await this.postLog(`Improve result: ${improveResult.improvementsApplied} improvements`, "system");
        } catch (improveError) {
          await this.postLog(`Improve failed (non-fatal): ${improveError}`, "error");
        }
      }

      // Determine final status
      const finalStatus = standardResult.deployResult === "deployed" ? "deployed" : "review_requested";
      await this.updateTaskStatus("completed", finalStatus);

      return standardResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.postLog(`Execution failed: ${errorMessage}`, "error");
      await this.updateTaskStatus("failed", "failed");

      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}
