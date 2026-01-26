/**
 * Inline DevOps Deployer for Epic Mode
 *
 * Runs deployment inline in the same container after Tech Lead approval.
 * Merges the PR and triggers/monitors GitHub Actions deployment.
 */

import axios from "axios";
import { runAgent } from "./agent-sdk.js";
import type { EpicConfig, StreamMessage } from "./types.js";

/**
 * Deployment decision from DevOps Engineer.
 */
export type DeploymentDecision = "deployed" | "failed" | "blocked";

/**
 * Result of an inline deployment.
 */
export interface InlineDeploymentResult {
  success: boolean;
  decision: DeploymentDecision;
  summary: string;
  workflowRunUrl?: string;
  error?: string;
}

/**
 * System prompt for the DevOps Engineer deployer.
 */
const DEVOPS_SYSTEM_PROMPT = `You are a DevOps Engineer for WorkerMill, responsible for deploying code changes made by AI Workers.

Your role combines deployment expertise with operational responsibilities:
- **PR Merging**: Merge approved PRs to trigger deployment
- **GitHub Actions**: Monitor and verify deployment workflows
- **Deployment Verification**: Ensure deployments complete successfully
- **Rollback Awareness**: Know when to flag issues for human intervention

***REMOVED******REMOVED*** Your Capabilities

You have access to these tools:
- **Bash**: Run shell commands including \`gh\` CLI for GitHub operations
- **Read**: Read files from the repository
- **Glob**: Find files by pattern
- **Grep**: Search file contents

***REMOVED******REMOVED*** Deployment Process

1. **Merge the PR** using squash merge:
   \`\`\`bash
   gh pr merge <PR_NUMBER> --squash --delete-branch
   \`\`\`

2. **Wait for GitHub Actions** to trigger (usually automatic on merge to main)

3. **Monitor the workflow run**:
   \`\`\`bash
   ***REMOVED*** List recent workflow runs
   gh run list --limit 5

   ***REMOVED*** Watch a specific run
   gh run watch <RUN_ID>

   ***REMOVED*** Check run status
   gh run view <RUN_ID>
   \`\`\`

4. **Verify deployment success** by checking workflow status

***REMOVED******REMOVED*** Decision Criteria

***REMOVED******REMOVED******REMOVED*** DEPLOYED when:
- PR merged successfully
- GitHub Actions workflow completed with success
- No deployment errors detected

***REMOVED******REMOVED******REMOVED*** FAILED when:
- PR merge failed (conflicts, branch protection)
- GitHub Actions workflow failed
- Deployment errors occurred

***REMOVED******REMOVED******REMOVED*** BLOCKED when:
- Cannot proceed due to external issues
- Requires human intervention
- Infrastructure problems detected

***REMOVED******REMOVED*** Output Format

After completing deployment, you MUST output these markers:

\`\`\`
DEPLOYMENT_DECISION: deployed
\`\`\`
OR
\`\`\`
DEPLOYMENT_DECISION: failed
\`\`\`
OR
\`\`\`
DEPLOYMENT_DECISION: blocked
\`\`\`

Then add:
\`\`\`
WORKFLOW_RUN_URL: https://github.com/owner/repo/actions/runs/12345
DEPLOYMENT_SUMMARY: Brief description of what happened
\`\`\`

***REMOVED******REMOVED*** Important Notes

- Always use squash merge to keep history clean
- Delete the branch after merging (--delete-branch flag)
- Wait for workflow to complete before declaring success
- If no CI/CD workflow exists, just merge and report success
- Report any issues clearly in the summary
`;

/**
 * Inline DevOps deployer for Epic mode.
 */
export class InlineDeployer {
  private config: EpicConfig;
  private repoPath: string;
  private logsApi: ReturnType<typeof axios.create>;
  private allOutput: string = "";

  constructor(config: EpicConfig, repoPath: string) {
    this.config = config;
    this.repoPath = repoPath;

    // Create axios instance for posting logs
    this.logsApi = axios.create({
      baseURL: config.apiBaseUrl,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.orgApiKey,
      },
      timeout: 5000,
    });
  }

  /**
   * Post a log message to the WorkerMill dashboard.
   */
  private async postLog(
    message: string,
    type: "system" | "manager" | "tool" | "output" | "error" = "output"
  ): Promise<void> {
    console.log(`[devops_engineer] ${message}`);

    try {
      await this.logsApi.post("/api/control-center/logs", {
        taskId: this.config.parentTaskId,
        type,
        message: `[devops_engineer] ${message}`,
        severity: type === "error" ? "error" : "info",
      });
    } catch {
      // Fire and forget - don't block on log failures
    }
  }

  /**
   * Execute inline deployment.
   */
  async deploy(
    prUrl: string,
    prNumber: number
  ): Promise<InlineDeploymentResult> {
    this.allOutput = ""; // Reset output accumulator

    await this.postLog("Starting inline deployment", "system");
    await this.postLog(`PR: ${prUrl}`, "system");
    await this.postLog(`Jira: ${this.config.jiraIssueKey}`, "system");

    try {
      // Build the deployment prompt
      const prompt = this.buildDeploymentPrompt(prUrl, prNumber);

      // Use haiku for faster deployment (simple merge + monitor)
      const model = "haiku";
      await this.postLog(`Using model: ${model}`, "system");

      // Create devops_engineer expert config for the deployer
      const devopsConfig = {
        persona: "devops_engineer" as const,
        description: "DevOps specialist - CI/CD, deployment",
        systemPrompt: DEVOPS_SYSTEM_PROMPT,
        tools: ["Read", "Glob", "Grep", "Bash"],
        model,
        specialties: ["deployment", "cicd", "github-actions"],
      };

      // Run the agent using Epic's agent SDK
      const result = await runAgent(this.config, {
        prompt,
        expertConfig: devopsConfig,
        repoPath: this.repoPath,
        storyId: `deploy-${prNumber}`,
        onMessage: (msg) => this.handleMessage(msg),
      });

      if (!result.success) {
        await this.postLog(`Deployment agent failed: ${result.error}`, "error");
        return {
          success: false,
          decision: "failed",
          summary: `Deployment failed: ${result.error}`,
          error: result.error,
        };
      }

      // Parse decision from output
      const decision = this.parseDecision();
      const summary = this.parseSummary();
      const workflowRunUrl = this.parseWorkflowRunUrl();

      await this.postLog(`Decision: ${decision}`, "system");
      await this.postLog(`Summary: ${summary}`, "system");
      if (workflowRunUrl) {
        await this.postLog(`Workflow: ${workflowRunUrl}`, "system");
      }

      return {
        success: decision === "deployed",
        decision,
        summary,
        workflowRunUrl,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.postLog(`Deployment failed: ${errorMessage}`, "error");

      return {
        success: false,
        decision: "failed",
        summary: `Deployment error: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  /**
   * Build the deployment prompt with PR context.
   */
  private buildDeploymentPrompt(prUrl: string, prNumber: number): string {
    return `***REMOVED*** Deployment Task

***REMOVED******REMOVED*** Context
- **Jira Issue**: ${this.config.jiraIssueKey}
- **PR URL**: ${prUrl}
- **PR Number**: ${prNumber}

The PR has been approved by the Tech Lead and is ready for deployment.

***REMOVED******REMOVED*** Instructions

1. **Merge the PR** using squash merge:
   \`\`\`bash
   gh pr merge ${prNumber} --squash --delete-branch
   \`\`\`

2. **Check if GitHub Actions workflow triggered**:
   \`\`\`bash
   ***REMOVED*** Wait a few seconds for workflow to start
   sleep 5

   ***REMOVED*** List recent workflow runs on main branch
   gh run list --branch main --limit 3
   \`\`\`

3. **If a deployment workflow started, monitor it**:
   \`\`\`bash
   ***REMOVED*** Get the latest run ID and watch it
   gh run list --branch main --limit 1 --json databaseId --jq '.[0].databaseId'

   ***REMOVED*** Then watch it (replace RUN_ID)
   gh run watch <RUN_ID>
   \`\`\`

4. **Output your decision** using these exact markers:
   \`\`\`
   DEPLOYMENT_DECISION: deployed
   WORKFLOW_RUN_URL: <url if available>
   DEPLOYMENT_SUMMARY: Brief description of what happened
   \`\`\`

**Note**: If no CI/CD workflow is configured, just merge the PR and report success.

Begin the deployment now.`;
  }

  /**
   * Handle messages from agent execution.
   */
  private handleMessage(msg: StreamMessage): void {
    if (msg.type === "thinking" && msg.content) {
      console.log(`[devops_engineer] [THINKING] ${msg.content.substring(0, 200)}...`);
    } else if (msg.type === "tool_use" && msg.toolName) {
      let toolMsg = `Tool: ${msg.toolName}`;
      if (msg.toolInput) {
        const input = msg.toolInput;
        if (input.command) toolMsg += ` -> ${String(input.command).substring(0, 100)}`;
        else if (input.file_path) toolMsg += ` -> ${input.file_path}`;
      }
      console.log(`[devops_engineer] ${toolMsg}`);
      this.postLog(toolMsg, "tool");
    } else if (msg.type === "text" && msg.content) {
      // Accumulate all text output for decision parsing
      this.allOutput += msg.content + "\n";

      // Log meaningful output
      if (msg.content.length > 20) {
        console.log(`[devops_engineer] ${msg.content}`);
        this.postLog(msg.content.substring(0, 500), "output");
      }
    } else if (msg.type === "result" && msg.content) {
      this.allOutput += msg.content + "\n";
      console.log(`[devops_engineer] Result: ${msg.content.substring(0, 200)}...`);
    }
  }

  /**
   * Parse the deployment decision from agent output.
   */
  private parseDecision(): DeploymentDecision {
    // Look for DEPLOYMENT_DECISION: marker
    const decisionMatch = this.allOutput.match(/DEPLOYMENT_DECISION:\s*(deployed|failed|blocked)/i);
    if (decisionMatch) {
      return decisionMatch[1].toLowerCase() as DeploymentDecision;
    }

    // Check for merge success indicators
    if (this.allOutput.includes("Squash and merge") ||
        this.allOutput.includes("merged") ||
        this.allOutput.includes("Pull request ***REMOVED***")) {
      return "deployed";
    }

    // Default to failed if no explicit decision
    console.log("[devops_engineer] No explicit decision found, defaulting to failed");
    return "failed";
  }

  /**
   * Parse deployment summary from agent output.
   */
  private parseSummary(): string {
    // Look for DEPLOYMENT_SUMMARY: marker
    const summaryMatch = this.allOutput.match(/DEPLOYMENT_SUMMARY:\s*(.+?)(?=\n(?:DEPLOYMENT_DECISION|WORKFLOW_RUN_URL)|$)/is);
    if (summaryMatch) {
      return summaryMatch[1].trim();
    }

    // Try to extract from merge output
    const mergeMatch = this.allOutput.match(/✓\s*(.+merged.+)/i);
    if (mergeMatch) {
      return mergeMatch[1].trim();
    }

    return "Deployment completed";
  }

  /**
   * Parse workflow run URL from agent output.
   */
  private parseWorkflowRunUrl(): string | undefined {
    // Look for WORKFLOW_RUN_URL: marker
    const urlMatch = this.allOutput.match(/WORKFLOW_RUN_URL:\s*(https:\/\/[^\s]+)/i);
    if (urlMatch) {
      return urlMatch[1].trim();
    }

    // Try to extract from gh output
    const ghUrlMatch = this.allOutput.match(/(https:\/\/github\.com\/[^\/]+\/[^\/]+\/actions\/runs\/\d+)/);
    if (ghUrlMatch) {
      return ghUrlMatch[1];
    }

    return undefined;
  }
}
