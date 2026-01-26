/**
 * Inline DevOps Deployer for Epic Mode
 *
 * Runs deployment inline in the same container after Tech Lead approval.
 * Merges the PR and triggers/monitors GitHub Actions deployment.
 */

import axios from "axios";
import { runAgent } from "./agent-sdk.js";
import { CoordinationClient } from "./coordination-client.js";
import type { EpicConfig, StreamMessage } from "./types.js";

/**
 * Deployment decision from DevOps Engineer.
 */
export type DeploymentDecision = "deployed" | "failed" | "blocked" | "escalated";

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
 * System prompt for the DevOps Engineer deployer (Phase 1: Assessment).
 */
const DEVOPS_SYSTEM_PROMPT_PHASE1 = `You are a DevOps Engineer for WorkerMill, responsible for deploying code changes made by AI Workers.

***REMOVED******REMOVED*** Phase 1: Assessment

Your task is to check if the repository has CI/CD workflows and determine if deployment can proceed.

***REMOVED******REMOVED******REMOVED*** Step 1: Check for Existing Workflows

\`\`\`bash
ls -la .github/workflows/ 2>/dev/null || echo "NO_WORKFLOWS_DIRECTORY"
\`\`\`

If workflows exist, examine them:
\`\`\`bash
cat .github/workflows/*.yml 2>/dev/null | head -200
\`\`\`

***REMOVED******REMOVED******REMOVED*** Step 2: Detect Project Stack

\`\`\`bash
ls package.json pyproject.toml requirements.txt Dockerfile docker-compose.yml 2>/dev/null
\`\`\`

***REMOVED******REMOVED******REMOVED*** Step 3: Make Your Decision

**If deployment workflows EXIST:**
Output this marker and STOP:
\`\`\`
WORKFLOWS_EXIST: true
DEPLOYMENT_SUMMARY: Found existing workflow(s): <list workflow files>
\`\`\`

**If NO deployment workflows exist:**
Output this marker and STOP:
\`\`\`
WORKFLOW_CREATION_NEEDED: true
DETECTED_STACK: <node|python|docker|unknown>
PROPOSED_WORKFLOW: <brief description of what workflow you would create>
\`\`\`

***REMOVED******REMOVED*** Important

- Do NOT create any files in this phase
- Do NOT merge the PR in this phase
- Only assess and report what you find
- Be specific about what workflow files exist or don't exist
`;

/**
 * System prompt for the DevOps Engineer deployer (Phase 2: Execute with existing workflows).
 */
const DEVOPS_SYSTEM_PROMPT_DEPLOY = `You are a DevOps Engineer for WorkerMill. The repository has CI/CD workflows in place.

***REMOVED******REMOVED*** Your Task: Merge and Monitor Deployment

***REMOVED******REMOVED******REMOVED*** Step 1: Merge the PR

\`\`\`bash
gh pr merge <PR_NUMBER> --squash --delete-branch
\`\`\`

***REMOVED******REMOVED******REMOVED*** Step 2: Monitor Deployment

Wait for and monitor the workflow:
\`\`\`bash
***REMOVED*** Wait for workflow to start
sleep 10

***REMOVED*** List recent workflow runs
gh run list --branch main --limit 5

***REMOVED*** Get the run ID of the latest run
RUN_ID=$(gh run list --branch main --limit 1 --json databaseId --jq '.[0].databaseId')
echo "Monitoring run: $RUN_ID"

***REMOVED*** Watch the run until it completes
gh run watch $RUN_ID
\`\`\`

***REMOVED******REMOVED******REMOVED*** Step 3: Verify Health

\`\`\`bash
***REMOVED*** Check workflow conclusion
gh run view $RUN_ID --json conclusion --jq '.conclusion'

***REMOVED*** Check for failures
gh run view $RUN_ID --log-failed 2>/dev/null || echo "No failures"

***REMOVED*** Get workflow URL
gh run view $RUN_ID --json url --jq '.url'
\`\`\`

***REMOVED******REMOVED******REMOVED*** Step 4: Output Decision

\`\`\`
DEPLOYMENT_DECISION: deployed
WORKFLOW_RUN_URL: <actual URL>
DEPLOYMENT_SUMMARY: PR merged, workflow completed with conclusion: success
\`\`\`

OR if failed:
\`\`\`
DEPLOYMENT_DECISION: failed
WORKFLOW_RUN_URL: <actual URL>
DEPLOYMENT_SUMMARY: <what failed>
\`\`\`

***REMOVED******REMOVED*** Critical Rules

- **NEVER declare DEPLOYED without watching the workflow complete**
- **ALWAYS verify conclusion is "success" before declaring DEPLOYED**
`;

/**
 * System prompt for the DevOps Engineer deployer (Phase 2: Create workflows then deploy).
 */
const DEVOPS_SYSTEM_PROMPT_CREATE = `You are a DevOps Engineer for WorkerMill. You have been APPROVED to create GitHub Actions workflows.

***REMOVED******REMOVED*** Your Task: Create Workflow, Merge, and Monitor

***REMOVED******REMOVED******REMOVED*** Step 1: Create the Deployment Workflow

Based on the detected stack, create an appropriate workflow file.

**For Node.js projects**, create \`.github/workflows/deploy.yml\`:
\`\`\`yaml
name: Deploy

on:
  push:
    branches: [main, master]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build --if-present
      - run: npm test --if-present
\`\`\`

**For Python projects**, create appropriate workflow with pip/pytest.

**For Docker projects**, create workflow with docker build/push.

***REMOVED******REMOVED******REMOVED*** Step 2: Commit the Workflow

\`\`\`bash
git add .github/workflows/
git commit -m "ci: Add deployment workflow"
git push
\`\`\`

***REMOVED******REMOVED******REMOVED*** Step 3: Merge the PR

\`\`\`bash
gh pr merge <PR_NUMBER> --squash --delete-branch
\`\`\`

***REMOVED******REMOVED******REMOVED*** Step 4: Monitor Deployment

\`\`\`bash
sleep 10
RUN_ID=$(gh run list --branch main --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch $RUN_ID
\`\`\`

***REMOVED******REMOVED******REMOVED*** Step 5: Verify and Report

\`\`\`bash
gh run view $RUN_ID --json conclusion,url --jq '{conclusion, url}'
\`\`\`

Output:
\`\`\`
DEPLOYMENT_DECISION: deployed
WORKFLOW_RUN_URL: <url>
DEPLOYMENT_SUMMARY: Created workflow, PR merged, deployment succeeded
\`\`\`

***REMOVED******REMOVED*** Critical Rules

- Create the workflow file BEFORE merging
- Monitor workflow to completion
- Verify success before declaring DEPLOYED
`;

/**
 * Inline DevOps deployer for Epic mode.
 */
export class InlineDeployer {
  private config: EpicConfig;
  private repoPath: string;
  private logsApi: ReturnType<typeof axios.create>;
  private coordination: CoordinationClient;
  private allOutput: string = "";

  // 10 minute timeout for workflow creation approval
  private static readonly APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

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

    // Initialize coordination client for approval questions
    this.coordination = new CoordinationClient(config);
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
   * Execute inline deployment with two-phase approval flow.
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
      // ============================================
      // PHASE 1: Assessment - Check for workflows
      // ============================================
      await this.postLog("Phase 1: Assessing CI/CD workflows...", "system");

      const phase1Result = await this.runPhase1Assessment(prUrl, prNumber);

      if (!phase1Result.success) {
        return {
          success: false,
          decision: "failed",
          summary: `Assessment failed: ${phase1Result.error}`,
          error: phase1Result.error,
        };
      }

      // Check if workflows exist
      const workflowsExist = this.parseWorkflowsExist();
      const workflowCreationNeeded = this.parseWorkflowCreationNeeded();

      await this.postLog(`Workflows exist: ${workflowsExist}`, "system");
      await this.postLog(`Creation needed: ${workflowCreationNeeded}`, "system");

      // ============================================
      // PHASE 2: Deploy or Request Approval
      // ============================================

      if (workflowsExist) {
        // Workflows exist - proceed directly to deployment
        await this.postLog("Phase 2: Deploying with existing workflows...", "system");
        return await this.runPhase2Deploy(prUrl, prNumber);
      }

      if (workflowCreationNeeded) {
        // Need to create workflows - request human approval
        await this.postLog("Phase 2: Requesting approval to create workflows...", "system");

        const detectedStack = this.parseDetectedStack();
        const proposedWorkflow = this.parseProposedWorkflow();

        const approved = await this.requestWorkflowApproval(detectedStack, proposedWorkflow);

        if (!approved) {
          // Timeout or rejected - escalate
          await this.postLog("Workflow creation not approved - escalating", "system");
          return {
            success: false,
            decision: "escalated",
            summary: "Workflow creation requires human approval. No response received within 10 minutes.",
          };
        }

        // Approved - proceed with workflow creation and deployment
        await this.postLog("Approval received - creating workflows and deploying...", "system");
        return await this.runPhase2Create(prUrl, prNumber, detectedStack);
      }

      // Neither exists nor needs creation - blocked
      return {
        success: false,
        decision: "blocked",
        summary: "Unable to determine workflow status from assessment",
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
   * Run Phase 1: Assessment to check for existing workflows.
   */
  private async runPhase1Assessment(
    prUrl: string,
    prNumber: number
  ): Promise<{ success: boolean; error?: string }> {
    this.allOutput = ""; // Reset for phase 1

    const prompt = this.buildPhase1Prompt(prUrl, prNumber);

    const devopsConfig = {
      persona: "devops_engineer" as const,
      description: "DevOps specialist - CI/CD assessment",
      systemPrompt: DEVOPS_SYSTEM_PROMPT_PHASE1,
      tools: ["Read", "Glob", "Grep", "Bash"],
      model: "haiku" as const, // Fast model for simple assessment
      specialties: ["deployment", "cicd", "github-actions"],
    };

    const result = await runAgent(this.config, {
      prompt,
      expertConfig: devopsConfig,
      repoPath: this.repoPath,
      storyId: `deploy-assess-${prNumber}`,
      onMessage: (msg) => this.handleMessage(msg),
    });

    return { success: result.success, error: result.error };
  }

  /**
   * Run Phase 2: Deploy with existing workflows.
   */
  private async runPhase2Deploy(
    prUrl: string,
    prNumber: number
  ): Promise<InlineDeploymentResult> {
    this.allOutput = ""; // Reset for phase 2

    const prompt = this.buildPhase2DeployPrompt(prUrl, prNumber);

    const devopsConfig = {
      persona: "devops_engineer" as const,
      description: "DevOps specialist - deployment execution",
      systemPrompt: DEVOPS_SYSTEM_PROMPT_DEPLOY,
      tools: ["Read", "Glob", "Grep", "Bash"],
      model: "sonnet" as const, // Better model for monitoring and verification
      specialties: ["deployment", "cicd", "github-actions"],
    };

    const result = await runAgent(this.config, {
      prompt,
      expertConfig: devopsConfig,
      repoPath: this.repoPath,
      storyId: `deploy-exec-${prNumber}`,
      onMessage: (msg) => this.handleMessage(msg),
    });

    if (!result.success) {
      return {
        success: false,
        decision: "failed",
        summary: `Deployment execution failed: ${result.error}`,
        error: result.error,
      };
    }

    const decision = this.parseDecision();
    const summary = this.parseSummary();
    const workflowRunUrl = this.parseWorkflowRunUrl();

    return {
      success: decision === "deployed",
      decision,
      summary,
      workflowRunUrl,
    };
  }

  /**
   * Run Phase 2: Create workflows then deploy (after approval).
   */
  private async runPhase2Create(
    prUrl: string,
    prNumber: number,
    detectedStack: string
  ): Promise<InlineDeploymentResult> {
    this.allOutput = ""; // Reset for phase 2

    const prompt = this.buildPhase2CreatePrompt(prUrl, prNumber, detectedStack);

    const devopsConfig = {
      persona: "devops_engineer" as const,
      description: "DevOps specialist - workflow creation and deployment",
      systemPrompt: DEVOPS_SYSTEM_PROMPT_CREATE,
      tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
      model: "sonnet" as const, // Better model for creating workflows
      specialties: ["deployment", "cicd", "github-actions"],
    };

    const result = await runAgent(this.config, {
      prompt,
      expertConfig: devopsConfig,
      repoPath: this.repoPath,
      storyId: `deploy-create-${prNumber}`,
      onMessage: (msg) => this.handleMessage(msg),
    });

    if (!result.success) {
      return {
        success: false,
        decision: "failed",
        summary: `Workflow creation failed: ${result.error}`,
        error: result.error,
      };
    }

    const decision = this.parseDecision();
    const summary = this.parseSummary();
    const workflowRunUrl = this.parseWorkflowRunUrl();

    return {
      success: decision === "deployed",
      decision,
      summary,
      workflowRunUrl,
    };
  }

  /**
   * Request human approval to create GitHub Actions workflows.
   * Posts a question to the coordination feed and waits up to 10 minutes.
   */
  private async requestWorkflowApproval(
    detectedStack: string,
    proposedWorkflow: string
  ): Promise<boolean> {
    const questionContent = `🔧 **Workflow Creation Approval Required**

The repository does not have GitHub Actions deployment workflows.

**Detected Stack:** ${detectedStack}
**Proposed Workflow:** ${proposedWorkflow}

**Do you approve creating GitHub Actions workflows for this repository?**

Reply with "yes" or "approved" to proceed, or "no" to skip deployment.`;

    await this.postLog("Posting approval question to coordination feed...", "system");

    try {
      // Post question to coordination feed
      const question = await this.coordination.postContext(
        "question",
        questionContent,
        "devops_engineer",
        undefined,
        {
          requiresApproval: true,
          approvalType: "workflow_creation",
          detectedStack,
          proposedWorkflow,
        }
      );

      await this.postLog(`Question posted (ID: ${question.id}). Waiting up to 10 minutes for approval...`, "system");

      // Wait for answer with 10 minute timeout
      const answer = await this.coordination.waitForAnswer(
        question.id,
        InlineDeployer.APPROVAL_TIMEOUT_MS
      );

      if (!answer) {
        await this.postLog("No response received within 10 minutes", "system");
        return false;
      }

      await this.postLog(`Received answer: ${answer}`, "system");

      // Check if approved
      const lowerAnswer = answer.toLowerCase();
      const approved = lowerAnswer.includes("yes") ||
                       lowerAnswer.includes("approved") ||
                       lowerAnswer.includes("approve") ||
                       lowerAnswer.includes("proceed");

      return approved;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.postLog(`Error requesting approval: ${errorMessage}`, "error");
      return false;
    }
  }

  /**
   * Build Phase 1 assessment prompt.
   */
  private buildPhase1Prompt(prUrl: string, prNumber: number): string {
    return `***REMOVED*** Deployment Assessment Task

***REMOVED******REMOVED*** Context
- **Jira Issue**: ${this.config.jiraIssueKey}
- **PR URL**: ${prUrl}
- **PR Number**: ${prNumber}

The PR has been approved by the Tech Lead. Your job is to assess if the repository has CI/CD workflows.

***REMOVED******REMOVED*** Instructions

1. Check if GitHub Actions workflows exist
2. Detect the project stack
3. Report your findings using the required markers

**Do NOT create any files or merge the PR in this phase.**

Begin the assessment now.`;
  }

  /**
   * Build Phase 2 deployment prompt (for existing workflows).
   */
  private buildPhase2DeployPrompt(prUrl: string, prNumber: number): string {
    return `***REMOVED*** Deployment Execution Task

***REMOVED******REMOVED*** Context
- **Jira Issue**: ${this.config.jiraIssueKey}
- **PR URL**: ${prUrl}
- **PR Number**: ${prNumber}

The repository has existing CI/CD workflows. Proceed with deployment.

***REMOVED******REMOVED*** Instructions

1. Merge the PR: \`gh pr merge ${prNumber} --squash --delete-branch\`
2. Wait for workflow to start (sleep 10)
3. Monitor the workflow run to completion
4. Verify the workflow succeeded
5. Report your decision

Begin the deployment now.`;
  }

  /**
   * Build Phase 2 workflow creation prompt (after approval).
   */
  private buildPhase2CreatePrompt(prUrl: string, prNumber: number, detectedStack: string): string {
    return `***REMOVED*** Workflow Creation and Deployment Task

***REMOVED******REMOVED*** Context
- **Jira Issue**: ${this.config.jiraIssueKey}
- **PR URL**: ${prUrl}
- **PR Number**: ${prNumber}
- **Detected Stack**: ${detectedStack}

You have been **APPROVED** to create GitHub Actions workflows for this repository.

***REMOVED******REMOVED*** Instructions

1. Create appropriate deployment workflow for ${detectedStack} stack
2. Commit and push the workflow to the PR branch
3. Merge the PR: \`gh pr merge ${prNumber} --squash --delete-branch\`
4. Monitor the workflow run to completion
5. Verify deployment succeeded
6. Report your decision

Begin creating the workflow and deploying now.`;
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
        if (input.command) toolMsg += ` -> ${String(input.command).substring(0, 500)}`;
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
        this.postLog(msg.content, "output");
      }
    } else if (msg.type === "result" && msg.content) {
      this.allOutput += msg.content + "\n";
      console.log(`[devops_engineer] Result: ${msg.content.substring(0, 500)}...`);
    }
  }

  /**
   * Parse the deployment decision from agent output.
   */
  private parseDecision(): DeploymentDecision {
    // Look for DEPLOYMENT_DECISION: marker
    const decisionMatch = this.allOutput.match(/DEPLOYMENT_DECISION:\s*(deployed|failed|blocked|escalated)/i);
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
   * Parse if workflows exist from Phase 1 assessment output.
   */
  private parseWorkflowsExist(): boolean {
    return this.allOutput.includes("WORKFLOWS_EXIST: true") ||
           this.allOutput.includes("WORKFLOWS_EXIST:true");
  }

  /**
   * Parse if workflow creation is needed from Phase 1 assessment output.
   */
  private parseWorkflowCreationNeeded(): boolean {
    return this.allOutput.includes("WORKFLOW_CREATION_NEEDED: true") ||
           this.allOutput.includes("WORKFLOW_CREATION_NEEDED:true");
  }

  /**
   * Parse the detected stack from Phase 1 assessment output.
   */
  private parseDetectedStack(): string {
    const match = this.allOutput.match(/DETECTED_STACK:\s*(\w+)/i);
    return match ? match[1].trim() : "unknown";
  }

  /**
   * Parse the proposed workflow description from Phase 1 assessment output.
   */
  private parseProposedWorkflow(): string {
    const match = this.allOutput.match(/PROPOSED_WORKFLOW:\s*(.+?)(?=\n(?:DETECTED_STACK|WORKFLOW_CREATION_NEEDED)|$)/is);
    return match ? match[1].trim() : "Standard CI/CD workflow";
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
