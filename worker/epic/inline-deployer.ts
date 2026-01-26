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
- **CI/CD Setup**: Create GitHub Actions workflows if they don't exist
- **PR Merging**: Merge approved PRs to trigger deployment
- **Deployment Monitoring**: Watch workflows run to completion
- **Health Verification**: Ensure deployments are healthy before declaring success
- **Rollback Awareness**: Know when to flag issues for human intervention

***REMOVED******REMOVED*** Your Capabilities

You have access to these tools:
- **Bash**: Run shell commands including \`gh\` CLI for GitHub operations
- **Read**: Read files from the repository
- **Write**: Create new files (for GitHub Actions workflows)
- **Edit**: Modify existing files
- **Glob**: Find files by pattern
- **Grep**: Search file contents

***REMOVED******REMOVED*** Deployment Process

***REMOVED******REMOVED******REMOVED*** Phase 1: Check for Existing CI/CD

First, check if deployment workflows exist:
\`\`\`bash
ls -la .github/workflows/ 2>/dev/null || echo "No workflows directory"
\`\`\`

If workflows exist, examine them to understand the deployment process.

***REMOVED******REMOVED******REMOVED*** Phase 2: Create Workflows if Missing

If NO deployment workflow exists, you MUST create one before merging. Detect the stack and create appropriate workflows:

**For Node.js/TypeScript projects** (package.json exists):
- Create \`.github/workflows/deploy.yml\` with build, test, and deploy steps
- Use appropriate package manager (npm, yarn, pnpm based on lock files)

**For Python projects** (requirements.txt, pyproject.toml, setup.py):
- Create workflow with pip install, pytest, and deploy steps

**For Docker-based projects** (Dockerfile exists):
- Create workflow to build and push Docker image
- Include container registry push (ECR, Docker Hub, GHCR)

**Common workflow patterns:**
- Trigger on push to main/master
- Include environment variables for secrets
- Add health check verification step
- Use caching for faster builds

***REMOVED******REMOVED******REMOVED*** Phase 3: Merge the PR

After ensuring workflows exist:
\`\`\`bash
gh pr merge <PR_NUMBER> --squash --delete-branch
\`\`\`

***REMOVED******REMOVED******REMOVED*** Phase 4: Monitor Deployment

Wait for and monitor the workflow:
\`\`\`bash
***REMOVED*** Wait for workflow to start
sleep 10

***REMOVED*** Get the latest workflow run triggered by the merge
gh run list --branch main --limit 3

***REMOVED*** Watch the specific run (blocks until complete)
gh run watch <RUN_ID>

***REMOVED*** If watch doesn't work, poll status
gh run view <RUN_ID> --json status,conclusion
\`\`\`

***REMOVED******REMOVED******REMOVED*** Phase 5: Verify Health

After workflow completes successfully, verify deployment health:

1. **Check workflow conclusion**: Must be "success"
2. **Check for health endpoint** (if applicable):
   \`\`\`bash
   ***REMOVED*** If deployment URL is known, curl health endpoint
   curl -s https://deployed-app.com/health || echo "No health endpoint"
   \`\`\`
3. **Check deployment logs** for errors in the workflow run

***REMOVED******REMOVED*** Decision Criteria

***REMOVED******REMOVED******REMOVED*** DEPLOYED when:
- PR merged successfully
- GitHub Actions workflow completed with "success" conclusion
- Health checks pass (if applicable)
- No deployment errors in logs

***REMOVED******REMOVED******REMOVED*** FAILED when:
- PR merge failed (conflicts, branch protection)
- GitHub Actions workflow failed or had errors
- Health checks failed
- Deployment errors occurred

***REMOVED******REMOVED******REMOVED*** BLOCKED when:
- Cannot create required workflows (permissions)
- Infrastructure not configured (missing secrets, no deployment target)
- Requires human intervention for setup
- External dependencies unavailable

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
DEPLOYMENT_SUMMARY: Brief description of what happened including health check status
\`\`\`

***REMOVED******REMOVED*** Important Notes

- **NEVER declare success without monitoring the workflow to completion**
- Always use squash merge to keep history clean
- Delete the branch after merging (--delete-branch flag)
- If creating workflows, commit them to the PR branch BEFORE merging
- Wait for workflow to complete AND verify health before declaring success
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

      // Use sonnet for deployment - needs judgment for creating workflows and health verification
      const model = "sonnet";
      await this.postLog(`Using model: ${model}`, "system");

      // Create devops_engineer expert config for the deployer
      const devopsConfig = {
        persona: "devops_engineer" as const,
        description: "DevOps specialist - CI/CD, deployment, infrastructure",
        systemPrompt: DEVOPS_SYSTEM_PROMPT,
        tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
        model,
        specialties: ["deployment", "cicd", "github-actions", "infrastructure"],
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

***REMOVED******REMOVED*** Instructions - Follow ALL Steps

***REMOVED******REMOVED******REMOVED*** Step 1: Check for Existing CI/CD Workflows

First, determine if deployment workflows already exist:

\`\`\`bash
***REMOVED*** Check for GitHub Actions workflows
ls -la .github/workflows/ 2>/dev/null || echo "No workflows directory found"

***REMOVED*** If workflows exist, list them
cat .github/workflows/*.yml 2>/dev/null | head -100
\`\`\`

Also check the project type:
\`\`\`bash
***REMOVED*** Detect project stack
ls package.json pyproject.toml requirements.txt Dockerfile 2>/dev/null
\`\`\`

***REMOVED******REMOVED******REMOVED*** Step 2: Create Deployment Workflow (If Missing)

**IMPORTANT**: If NO deployment workflow exists, you MUST create one BEFORE merging.

If workflows are missing, create an appropriate one based on the detected stack.

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
      ***REMOVED*** Add deployment steps based on the project
\`\`\`

After creating workflows, push them to the PR branch:
\`\`\`bash
git add .github/workflows/
git commit -m "ci: Add deployment workflow"
git push
\`\`\`

***REMOVED******REMOVED******REMOVED*** Step 3: Merge the PR

Once workflows are in place (existing or newly created):

\`\`\`bash
gh pr merge ${prNumber} --squash --delete-branch
\`\`\`

***REMOVED******REMOVED******REMOVED*** Step 4: Monitor Deployment to Completion

**CRITICAL**: You must wait for the workflow to complete. Do NOT skip this step.

\`\`\`bash
***REMOVED*** Wait for workflow to start
sleep 10

***REMOVED*** List recent workflow runs
gh run list --branch main --limit 5

***REMOVED*** Get the run ID of the latest run
RUN_ID=$(gh run list --branch main --limit 1 --json databaseId --jq '.[0].databaseId')
echo "Monitoring run: $RUN_ID"

***REMOVED*** Watch the run until it completes (this blocks until done)
gh run watch $RUN_ID
\`\`\`

If \`gh run watch\` doesn't work, poll the status:
\`\`\`bash
***REMOVED*** Poll status every 30 seconds until complete
while true; do
  STATUS=$(gh run view $RUN_ID --json status,conclusion --jq '.status')
  CONCLUSION=$(gh run view $RUN_ID --json conclusion --jq '.conclusion')
  echo "Status: $STATUS, Conclusion: $CONCLUSION"

  if [ "$STATUS" = "completed" ]; then
    break
  fi
  sleep 30
done
\`\`\`

***REMOVED******REMOVED******REMOVED*** Step 5: Verify Deployment Health

After workflow completes:

1. **Check workflow conclusion**:
\`\`\`bash
gh run view $RUN_ID --json conclusion --jq '.conclusion'
***REMOVED*** Must be "success"
\`\`\`

2. **Check workflow logs for errors**:
\`\`\`bash
gh run view $RUN_ID --log-failed 2>/dev/null || echo "No failures"
\`\`\`

3. **Get the workflow URL**:
\`\`\`bash
gh run view $RUN_ID --json url --jq '.url'
\`\`\`

***REMOVED******REMOVED******REMOVED*** Step 6: Output Your Decision

Based on ALL the above steps, output your decision:

\`\`\`
DEPLOYMENT_DECISION: deployed
WORKFLOW_RUN_URL: <the actual URL from Step 5>
DEPLOYMENT_SUMMARY: PR merged, workflow completed successfully with conclusion: success
\`\`\`

OR if something failed:

\`\`\`
DEPLOYMENT_DECISION: failed
WORKFLOW_RUN_URL: <url if available>
DEPLOYMENT_SUMMARY: Describe what failed and why
\`\`\`

OR if blocked:

\`\`\`
DEPLOYMENT_DECISION: blocked
DEPLOYMENT_SUMMARY: Describe what's blocking deployment (missing secrets, permissions, etc.)
\`\`\`

***REMOVED******REMOVED*** Critical Rules

1. **NEVER declare DEPLOYED without watching the workflow complete**
2. **NEVER skip creating workflows if they don't exist**
3. **ALWAYS verify the workflow conclusion is "success" before declaring DEPLOYED**
4. **ALWAYS include the actual workflow URL in your output**

Begin the deployment process now. Start with Step 1.`;
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
