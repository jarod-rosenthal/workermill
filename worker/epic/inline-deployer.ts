/**
 * Inline DevOps Deployer for Epic Mode
 *
 * Runs deployment inline in the same container after Tech Lead approval.
 * Merges the PR and triggers/monitors GitHub Actions deployment.
 */

import type { AxiosInstance } from "axios";
import { createLogsApi } from "../lib/api-client.js";
import * as fs from "fs";
import * as path from "path";
import { runAgent, type AgentOptions, type AgentResult } from "./agent-sdk.js";
import { CoordinationClient } from "./coordination-client.js";
import { getTicketLabel, type EpicConfig, type StreamMessage } from "./types.js";
import { createAIClient, type AIClient, type AIClientOptions, type AIProvider } from "./ai-client-types.js";

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

## Phase 1: Assessment

Your task is to check if the repository has CI/CD workflows, determine their trigger type, and identify what components are affected by the PR.

### Step 1: Check for Existing Workflows

\`\`\`bash
ls -la .github/workflows/ 2>/dev/null || echo "NO_WORKFLOWS_DIRECTORY"
\`\`\`

If workflows exist, examine them carefully - pay attention to the \`on:\` trigger section:
\`\`\`bash
cat .github/workflows/*.yml 2>/dev/null
\`\`\`

### Step 2: Detect Project Stack and Changed Components

\`\`\`bash
# Check project structure
ls package.json pyproject.toml requirements.txt go.mod Dockerfile docker-compose.yml 2>/dev/null

# Check what directories exist (to understand component structure)
ls -d */ 2>/dev/null
\`\`\`

### Step 3: Check PR Changed Files

\`\`\`bash
# See what files were changed in the PR to determine deployment scope
gh pr view <PR_NUMBER> --json files --jq '.files[].path' | head -50
\`\`\`

### Step 4: Analyze and Report

**CRITICAL: Identify the workflow trigger type by examining the \`on:\` section:**

- \`on: push:\` or \`on: [push]\` = **auto-trigger** (runs automatically on merge)
- \`on: workflow_dispatch:\` ONLY = **manual-trigger** (requires \`gh workflow run\`)
- \`on: workflow_call:\` = **reusable workflow** (called by other workflows)

**If deployment workflows EXIST with AUTO-TRIGGER (push to main):**
\`\`\`
WORKFLOWS_EXIST: true
TRIGGER_TYPE: auto
DEPLOYMENT_SUMMARY: Found auto-triggered workflow(s): <list workflow files>
\`\`\`

**If deployment workflows EXIST with MANUAL-TRIGGER ONLY (workflow_dispatch):**
\`\`\`
WORKFLOWS_EXIST: true
TRIGGER_TYPE: manual
WORKFLOW_FILE: <primary deploy workflow filename, e.g., deploy.yml>
CHANGED_COMPONENTS: <comma-separated list of affected components based on changed files, e.g., mobile, frontend, backend, infra>
WORKFLOW_INPUTS: <JSON object of available inputs from workflow_dispatch, e.g., {"deploy_backend": "boolean", "deploy_frontend": "boolean", "deploy_mobile_ota": "boolean"}>
DEPLOYMENT_SUMMARY: Found manual-triggered workflow: <workflow file>. Components affected: <components>
\`\`\`

**If NO deployment workflows exist:**
\`\`\`
WORKFLOW_CREATION_NEEDED: true
DETECTED_STACK: <node|python|go|docker|unknown>
PROPOSED_WORKFLOW: <brief description of what workflow you would create>
\`\`\`

## Component Detection Rules

Based on changed file paths, identify components:
- \`mobile/\` → mobile
- \`frontend/\` or \`web/\` or \`client/\` → frontend
- \`backend/\` or \`api/\` or \`server/\` → backend
- \`infrastructure/\` or \`terraform/\` or \`infra/\` → infra

## Important

- Do NOT create any files in this phase
- Do NOT merge the PR in this phase
- Only assess and report what you find
- Be specific about trigger types - this determines the deployment strategy
`;

/**
 * System prompt for the DevOps Engineer deployer (Phase 2: Execute with AUTO-TRIGGERED workflows).
 */
const DEVOPS_SYSTEM_PROMPT_DEPLOY_AUTO = `You are a DevOps Engineer for WorkerMill. The repository has CI/CD workflows that auto-trigger on push to main.

## Your Task: Validate, Merge, and Monitor Deployment

### Step 1: Pre-Merge Local Validation (MANDATORY)

CI may only run AFTER merge (on push to main). You MUST validate locally BEFORE merging.

\`\`\`bash
# Install dependencies (if not already done)
npm install --ignore-scripts 2>/dev/null || yarn install 2>/dev/null || true
# Go dependencies (if go.mod exists)
test -f go.mod && go mod download 2>/dev/null || true

# 1. Build check — does the code compile?
npm run build 2>&1 || echo "BUILD_FAILED"
# Go build (if go.mod exists)
test -f go.mod && go build ./... 2>&1 || true

# 2. Lint check
npm run lint 2>&1 || echo "LINT_FAILED"
# Go lint (if go.mod exists)
test -f go.mod && go vet ./... 2>&1 || true
test -f go.mod && golangci-lint run ./... 2>&1 || true

# 3. Security audit — check for critical/high vulnerabilities
npm audit --audit-level=critical 2>&1 || echo "AUDIT_CRITICAL_FOUND"

# 4. Prisma validation (if prisma is used)
npx prisma validate 2>/dev/null || true

# 5. Type check (if separate from build)
npx tsc --noEmit 2>/dev/null || true
# Go format check
test -f go.mod && gofmt -l . 2>&1 || true

# 6. Tests (if fast enough — skip if > 5 minutes)
npm test 2>&1 || echo "TESTS_FAILED"
# Go tests
test -f go.mod && go test ./... -count=1 2>&1 || true
\`\`\`

**If ANY check fails, DO NOT merge.** Report \`DEPLOYMENT_DECISION: FAILURE\` with the failing check names and output.

### Step 2: Validate Workflow Secrets (MANDATORY)

Workflows that reference GitHub Actions secrets (e.g. secrets.XYZ) will fail if those secrets don't exist. Check BEFORE merging:
\`\`\`bash
# List all secrets referenced in workflow files
grep -roh 'secrets\\.[A-Z_]*' .github/workflows/ 2>/dev/null | sort -u || echo "NO_SECRETS_REFERENCED"

# List all secrets configured in the repo
gh secret list 2>&1 || echo "CANNOT_LIST_SECRETS"
\`\`\`
**Compare the two lists.** If any workflow references a secret that is NOT in \`gh secret list\`, DO NOT merge — report \`DEPLOYMENT_DECISION: FAILURE\` with the missing secrets.

### Step 3: Check PR CI Status (if available)

Some repos also run CI on pull_request events. Check and wait:
\`\`\`bash
# Check if any PR checks exist
gh pr checks <PR_NUMBER> 2>&1 || echo "NO_PR_CHECKS"
\`\`\`
If PR checks exist and are running, wait: \`gh pr checks <PR_NUMBER> --watch\`
If no PR checks exist, that's OK — you already validated locally in Step 1.

### Step 4: Merge the PR

Only after ALL local checks pass, secrets are verified, and PR checks pass (if they exist):
\`\`\`bash
gh pr merge <PR_NUMBER> --squash --delete-branch
\`\`\`

### Step 5: Monitor Deployment

Wait for and monitor the post-merge workflow:
\`\`\`bash
sleep 10
gh run list --branch main --limit 5
RUN_ID=$(gh run list --branch main --limit 1 --json databaseId --jq '.[0].databaseId')
echo "Monitoring run: $RUN_ID"
gh run watch $RUN_ID
\`\`\`

### Step 6: Verify Health

\`\`\`bash
gh run view $RUN_ID --json conclusion --jq '.conclusion'
gh run view $RUN_ID --log-failed 2>/dev/null || echo "No failures"
gh run view $RUN_ID --json url --jq '.url'
\`\`\`

### Step 7: Output Decision

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

## Critical Rules

- **NEVER merge without passing local validation first**
- **NEVER merge if workflow YAML references secrets that don't exist in the repo**
- **NEVER declare DEPLOYED without watching the workflow complete**
- **ALWAYS verify conclusion is "success" before declaring DEPLOYED**
- If \`npm audit\` finds critical vulnerabilities, DO NOT merge — report FAILURE
`;

/**
 * System prompt for the DevOps Engineer deployer (Phase 2: Execute with MANUAL-TRIGGERED workflows).
 */
const DEVOPS_SYSTEM_PROMPT_DEPLOY_MANUAL = `You are a DevOps Engineer for WorkerMill. The repository has CI/CD workflows that require MANUAL triggering via workflow_dispatch.

## Your Task: Validate, Merge PR, Trigger Workflow, and Monitor Deployment

### Step 1: Pre-Merge Local Validation (MANDATORY)

You MUST validate locally BEFORE merging to catch issues early.

\`\`\`bash
npm install --ignore-scripts 2>/dev/null || yarn install 2>/dev/null || true
test -f go.mod && go mod download 2>/dev/null || true
npm run build 2>&1 || echo "BUILD_FAILED"
test -f go.mod && go build ./... 2>&1 || true
npm run lint 2>&1 || echo "LINT_FAILED"
test -f go.mod && go vet ./... 2>&1 || true
test -f go.mod && golangci-lint run ./... 2>&1 || true
npm audit --audit-level=critical 2>&1 || echo "AUDIT_CRITICAL_FOUND"
npx prisma validate 2>/dev/null || true
npx tsc --noEmit 2>/dev/null || true
test -f go.mod && gofmt -l . 2>&1 || true
npm test 2>&1 || echo "TESTS_FAILED"
test -f go.mod && go test ./... -count=1 2>&1 || true
\`\`\`

**If ANY check fails, DO NOT merge.** Report \`DEPLOYMENT_DECISION: FAILURE\` with details.

### Step 2: Validate Workflow Secrets (MANDATORY)

Workflows that reference GitHub Actions secrets (e.g. secrets.XYZ) will fail if those secrets don't exist. Check BEFORE merging:
\`\`\`bash
# List all secrets referenced in workflow files
grep -roh 'secrets\\.[A-Z_]*' .github/workflows/ 2>/dev/null | sort -u || echo "NO_SECRETS_REFERENCED"

# List all secrets configured in the repo
gh secret list 2>&1 || echo "CANNOT_LIST_SECRETS"
\`\`\`
**Compare the two lists.** If any workflow references a secret that is NOT in \`gh secret list\`, DO NOT merge — report \`DEPLOYMENT_DECISION: FAILURE\` with the missing secrets.

### Step 3: Check PR CI Status (if available)

\`\`\`bash
gh pr checks <PR_NUMBER> 2>&1 || echo "NO_PR_CHECKS"
\`\`\`
If PR checks exist and are running, wait: \`gh pr checks <PR_NUMBER> --watch\`
If no PR checks exist, that's OK — you already validated locally.

### Step 4: Merge the PR

Only after ALL validations pass and secrets are verified:
\`\`\`bash
gh pr merge <PR_NUMBER> --squash --delete-branch
\`\`\`

### Step 5: Trigger the Deployment Workflow

Since this workflow uses \`workflow_dispatch\`, manually trigger it. Only enable components that were changed.

Example:
\`\`\`bash
gh workflow run deploy.yml -f deploy_backend=true -f deploy_frontend=false
\`\`\`

### Step 6: Monitor the Triggered Workflow

\`\`\`bash
sleep 5
gh run list --workflow=deploy.yml --limit 5
RUN_ID=$(gh run list --workflow=deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId')
echo "Monitoring run: $RUN_ID"
gh run watch $RUN_ID
\`\`\`

### Step 7: Verify Health

\`\`\`bash
gh run view $RUN_ID --json conclusion --jq '.conclusion'
gh run view $RUN_ID --log-failed 2>/dev/null || echo "No failures"
gh run view $RUN_ID --json url --jq '.url'
\`\`\`

### Step 8: Output Decision

\`\`\`
DEPLOYMENT_DECISION: deployed
WORKFLOW_RUN_URL: <actual URL>
DEPLOYMENT_SUMMARY: PR merged, manually triggered workflow for <components>, completed with conclusion: success
\`\`\`

OR if failed:
\`\`\`
DEPLOYMENT_DECISION: failed
WORKFLOW_RUN_URL: <actual URL>
DEPLOYMENT_SUMMARY: <what failed>
\`\`\`

## Critical Rules

- **NEVER merge without passing local validation first**
- **NEVER merge if workflow YAML references secrets that don't exist in the repo**
- **NEVER declare DEPLOYED without watching the workflow complete**
- **ALWAYS verify conclusion is "success" before declaring DEPLOYED**
- **Only deploy the components that were actually changed**
- **Use the correct workflow filename** - it may be deploy.yml, ci.yml, or something else
- If \`npm audit\` finds critical vulnerabilities, DO NOT merge — report FAILURE
`;

/**
 * System prompt for the DevOps Engineer deployer (Phase 2: Create workflows then deploy).
 */
const DEVOPS_SYSTEM_PROMPT_CREATE = `You are a DevOps Engineer for WorkerMill. You have been APPROVED to create GitHub Actions workflows.

## Your Task: Create Workflow, Merge, and Monitor

### Step 1: Create the Deployment Workflow

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
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - run: npm run build --if-present
      - run: npm test --if-present
\`\`\`

**For Go projects**, create \`.github/workflows/deploy.yml\`:
\`\`\`yaml
name: CI

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  api:
    name: Go — Lint, Test, Build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      - name: Lint
        uses: golangci/golangci-lint-action@v6
        with:
          working-directory: api
      - name: Test
        working-directory: api
        run: go test ./... -v -count=1 -race
      - name: Build
        working-directory: api
        run: CGO_ENABLED=0 go build -o /dev/null ./cmd/server
\`\`\`

**For Python projects**, create appropriate workflow with pip/pytest.

**For Docker projects**, create workflow with docker build/push.

### Step 2: Commit the Workflow

\`\`\`bash
git add .github/workflows/
git commit -m "ci: Add deployment workflow"
git push
\`\`\`

### Step 3: Pre-Merge Local Validation (MANDATORY)

Before merging, validate the code locally to catch failures before they reach main:

\`\`\`bash
npm install --ignore-scripts 2>/dev/null || yarn install 2>/dev/null || true
test -f go.mod && go mod download 2>/dev/null || true
npm run build 2>&1 || echo "BUILD_FAILED"
test -f go.mod && go build ./... 2>&1 || true
npm run lint 2>&1 || echo "LINT_FAILED"
test -f go.mod && go vet ./... 2>&1 || true
test -f go.mod && golangci-lint run ./... 2>&1 || true
npm audit --audit-level=critical 2>&1 || echo "AUDIT_CRITICAL_FOUND"
npx prisma validate 2>/dev/null || true
test -f go.mod && gofmt -l . 2>&1 || true
npm test 2>&1 || echo "TESTS_FAILED"
test -f go.mod && go test ./... -count=1 2>&1 || true
\`\`\`

**If ANY check fails, DO NOT merge.** Report \`DEPLOYMENT_DECISION: FAILURE\` with details.

### Step 4: Validate Workflow Secrets (MANDATORY)

Workflows that reference GitHub Actions secrets (e.g. secrets.XYZ) will fail if those secrets don't exist. Check BEFORE merging:
\`\`\`bash
# List all secrets referenced in workflow files (including the one you just created)
grep -roh 'secrets\\.[A-Z_]*' .github/workflows/ 2>/dev/null | sort -u || echo "NO_SECRETS_REFERENCED"

# List all secrets configured in the repo
gh secret list 2>&1 || echo "CANNOT_LIST_SECRETS"
\`\`\`
**Compare the two lists.** If any workflow references a secret that is NOT in \`gh secret list\`, DO NOT merge — report \`DEPLOYMENT_DECISION: FAILURE\` with the missing secrets.

### Step 5: Merge the PR

Only after all local validations pass and secrets are verified:
\`\`\`bash
gh pr merge <PR_NUMBER> --squash --delete-branch
\`\`\`

### Step 6: Monitor Deployment

\`\`\`bash
sleep 10
RUN_ID=$(gh run list --branch main --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch $RUN_ID
\`\`\`

### Step 7: Verify and Report

\`\`\`bash
gh run view $RUN_ID --json conclusion,url --jq '{conclusion, url}'
\`\`\`

Output:
\`\`\`
DEPLOYMENT_DECISION: deployed
WORKFLOW_RUN_URL: <url>
DEPLOYMENT_SUMMARY: Created workflow, PR merged, deployment succeeded
\`\`\`

## Critical Rules

- **NEVER merge without passing local validation first**
- **NEVER merge if workflow YAML references secrets that don't exist in the repo**
- Create the workflow file BEFORE merging
- Monitor workflow to completion
- Verify success before declaring DEPLOYED
- If \`npm audit\` finds critical vulnerabilities, DO NOT merge — report FAILURE
`;

/**
 * Inline DevOps deployer for Epic mode.
 */
export class InlineDeployer {
  private config: EpicConfig;
  private repoPath: string;
  private logsApi: AxiosInstance;
  private coordination: CoordinationClient;
  private allOutput: string = "";
  private aiClient: AIClient | null = null;
  private model: string;

  // 10 minute timeout for workflow creation approval
  private static readonly APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

  private prompts: { phase1: string; deployAuto: string; deployManual: string; create: string };

  constructor(config: EpicConfig, repoPath: string, serverPrompts?: {
    phase1?: string; deployAuto?: string; deployManual?: string; create?: string;
  }) {
    this.config = config;
    this.repoPath = repoPath;
    this.model = process.env.MANAGER_MODEL || config.model || "";
    this.prompts = {
      phase1: serverPrompts?.phase1 ?? DEVOPS_SYSTEM_PROMPT_PHASE1,
      deployAuto: serverPrompts?.deployAuto ?? DEVOPS_SYSTEM_PROMPT_DEPLOY_AUTO,
      deployManual: serverPrompts?.deployManual ?? DEVOPS_SYSTEM_PROMPT_DEPLOY_MANUAL,
      create: serverPrompts?.create ?? DEVOPS_SYSTEM_PROMPT_CREATE,
    };

    // Create axios instance for posting logs
    this.logsApi = createLogsApi(config);

    // Initialize coordination client for approval questions
    this.coordination = new CoordinationClient(config);

    // Initialize AIClient if unified client is enabled
    if (config.useUnifiedClient) {
      const provider = (config.workerProvider || "anthropic") as AIProvider;
      const isAnthropic = provider === "anthropic";
      this.aiClient = createAIClient({
        provider,
        apiKeys: {
          anthropic: isAnthropic ? config.anthropicApiKey : undefined,
          ollamaHost: provider === "ollama" ? (process.env.OLLAMA_HOST || "http://localhost:11434") : undefined,
        },
        apiConfig: { baseUrl: config.apiBaseUrl, orgApiKey: config.orgApiKey },
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
    if (this.config.useUnifiedClient && this.aiClient && options.expertConfig) {
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
    const prefix = "[🔧devops_engineer🤖]";
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
   * Execute inline deployment with two-phase approval flow.
   */
  async deploy(
    prUrl: string,
    prNumber: number
  ): Promise<InlineDeploymentResult> {
    this.allOutput = ""; // Reset output accumulator

    await this.postLog("Starting inline deployment", "system");
    await this.postLog(`PR: ${prUrl}`, "system");
    await this.postLog(`${getTicketLabel(this.config.ticketSystem)}: ${this.config.jiraIssueKey}`, "system");

    try {
      // ============================================
      // PHASE 1: Assessment - Check for workflows
      // ============================================
      await this.postLog("Phase 1: Assessing CI/CD workflows...", "system");

      const phase1Result = await this.runPhase1Assessment(prUrl, prNumber);

      if (!phase1Result.success) {
        await this.postLog(`Phase 1 raw output:\n${this.allOutput}`, "system");
        return {
          success: false,
          decision: "failed",
          summary: `Assessment failed: ${phase1Result.error}`,
          error: phase1Result.error,
        };
      }

      // Log raw assessment output for debugging failed marker parsing
      await this.postLog(`Phase 1 raw output:\n${this.allOutput}`, "system");

      // Check if workflows exist
      let workflowsExist = this.parseWorkflowsExist();
      let workflowCreationNeeded = this.parseWorkflowCreationNeeded();
      const triggerType = this.parseTriggerType();

      await this.postLog(`Workflows exist: ${workflowsExist}`, "system");
      await this.postLog(`Trigger type: ${triggerType}`, "system");
      await this.postLog(`Creation needed: ${workflowCreationNeeded}`, "system");

      // ============================================
      // PHASE 2: Deploy or Request Approval
      // ============================================

      if (workflowsExist) {
        if (triggerType === "manual") {
          // Manual-trigger workflows - need to use gh workflow run
          const workflowFile = this.parseWorkflowFile();
          const changedComponents = this.parseChangedComponents();
          const workflowInputs = this.parseWorkflowInputs();

          await this.postLog(`Workflow file: ${workflowFile}`, "system");
          await this.postLog(`Changed components: ${changedComponents.join(", ")}`, "system");
          await this.postLog(`Available inputs: ${JSON.stringify(workflowInputs)}`, "system");
          await this.postLog("Phase 2: Deploying with manual-trigger workflow...", "system");

          return await this.runPhase2DeployManual(prUrl, prNumber, workflowFile, changedComponents, workflowInputs);
        } else {
          // Auto-trigger workflows - merge and wait
          await this.postLog("Phase 2: Deploying with auto-trigger workflows...", "system");
          return await this.runPhase2Deploy(prUrl, prNumber);
        }
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

      // LLM parsing failed — fall back to direct filesystem check
      await this.postLog("LLM markers not found, checking filesystem directly...", "system");

      const workflowsDir = path.join(this.repoPath, ".github", "workflows");
      if (fs.existsSync(workflowsDir)) {
        const files = fs.readdirSync(workflowsDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
        if (files.length > 0) {
          await this.postLog(`Filesystem fallback: found ${files.length} workflow(s): ${files.join(", ")}`, "system");
          await this.postLog("Phase 2: Deploying with auto-trigger workflows (filesystem fallback)...", "system");
          return await this.runPhase2Deploy(prUrl, prNumber);
        }
      }

      // No workflows on disk either — treat as creation needed
      await this.postLog("Filesystem fallback: no workflows found, requesting approval to create...", "system");
      const detectedStack = this.parseDetectedStack() || "unknown";
      const proposedWorkflow = this.parseProposedWorkflow();

      const approved = await this.requestWorkflowApproval(detectedStack, proposedWorkflow);
      if (!approved) {
        return {
          success: false,
          decision: "escalated",
          summary: "No CI/CD workflows found. Workflow creation requires human approval.",
        };
      }

      await this.postLog("Approval received - creating workflows and deploying...", "system");
      return await this.runPhase2Create(prUrl, prNumber, detectedStack);

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
      systemPrompt: this.prompts.phase1,
      tools: ["Read", "Glob", "Grep", "Bash", "TodoWrite"],
      model: this.model,
      specialties: ["deployment", "cicd", "github-actions"],
    };

    const result = await this.executeAgent(
      {
        prompt,
        expertConfig: devopsConfig,
        repoPath: this.repoPath,
        storyId: `deploy-assess-${prNumber}`,
      },
      `deploy-assess-${prNumber}`,
      (msg) => this.handleMessage(msg)
    );

    return { success: result.success, error: result.error };
  }

  /**
   * Run Phase 2: Deploy with auto-triggered workflows (push to main).
   */
  private async runPhase2Deploy(
    prUrl: string,
    prNumber: number
  ): Promise<InlineDeploymentResult> {
    this.allOutput = ""; // Reset for phase 2

    const prompt = this.buildPhase2DeployAutoPrompt(prUrl, prNumber);

    const devopsConfig = {
      persona: "devops_engineer" as const,
      description: "DevOps specialist - deployment execution (auto-trigger)",
      systemPrompt: this.prompts.deployAuto,
      tools: ["Read", "Glob", "Grep", "Bash", "TodoWrite"],
      model: this.model,
      specialties: ["deployment", "cicd", "github-actions"],
    };

    const result = await this.executeAgent(
      {
        prompt,
        expertConfig: devopsConfig,
        repoPath: this.repoPath,
        storyId: `deploy-exec-${prNumber}`,
      },
      `deploy-exec-${prNumber}`,
      (msg) => this.handleMessage(msg)
    );

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
   * Run Phase 2: Deploy with manual-triggered workflows (workflow_dispatch).
   */
  private async runPhase2DeployManual(
    prUrl: string,
    prNumber: number,
    workflowFile: string,
    changedComponents: string[],
    workflowInputs: Record<string, string>
  ): Promise<InlineDeploymentResult> {
    this.allOutput = ""; // Reset for phase 2

    const prompt = this.buildPhase2DeployManualPrompt(prUrl, prNumber, workflowFile, changedComponents, workflowInputs);

    const devopsConfig = {
      persona: "devops_engineer" as const,
      description: "DevOps specialist - deployment execution (manual-trigger)",
      systemPrompt: this.prompts.deployManual,
      tools: ["Read", "Glob", "Grep", "Bash", "TodoWrite"],
      model: this.model,
      specialties: ["deployment", "cicd", "github-actions"],
    };

    const result = await this.executeAgent(
      {
        prompt,
        expertConfig: devopsConfig,
        repoPath: this.repoPath,
        storyId: `deploy-manual-${prNumber}`,
      },
      `deploy-manual-${prNumber}`,
      (msg) => this.handleMessage(msg)
    );

    if (!result.success) {
      return {
        success: false,
        decision: "failed",
        summary: `Manual deployment execution failed: ${result.error}`,
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
      systemPrompt: this.prompts.create,
      tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
      model: this.model,
      specialties: ["deployment", "cicd", "github-actions"],
    };

    const result = await this.executeAgent(
      {
        prompt,
        expertConfig: devopsConfig,
        repoPath: this.repoPath,
        storyId: `deploy-create-${prNumber}`,
      },
      `deploy-create-${prNumber}`,
      (msg) => this.handleMessage(msg)
    );

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
    const targetRepo = process.env.TARGET_REPO || process.env.GITHUB_REPO || "";
    const repoFlag = targetRepo ? ` -R ${targetRepo}` : "";
    return `# Deployment Assessment Task

## Context
- **Jira Issue**: ${this.config.jiraIssueKey}
- **PR URL**: ${prUrl}
- **PR Number**: ${prNumber}

The PR has been approved by the Tech Lead. Your job is to assess if the repository has CI/CD workflows and determine the deployment strategy.

## Instructions

1. Check if GitHub Actions workflows exist in \`.github/workflows/\`
2. **CRITICAL**: Examine the workflow files to determine the trigger type:
   - Look at the \`on:\` section
   - \`on: push:\` = auto-trigger (report TRIGGER_TYPE: auto)
   - \`on: workflow_dispatch:\` only = manual-trigger (report TRIGGER_TYPE: manual)
3. If manual-trigger, identify available workflow inputs from the \`workflow_dispatch.inputs\` section
4. Check which files changed in PR #${prNumber} using \`gh pr view ${prNumber}${repoFlag} --json files\`
5. Determine which components are affected (mobile, frontend, backend, infra)
6. Report your findings using the required markers

**Do NOT create any files or merge the PR in this phase.**

Begin the assessment now.`;
  }

  /**
   * Build Phase 2 deployment prompt (for auto-triggered workflows).
   */
  private buildPhase2DeployAutoPrompt(prUrl: string, prNumber: number): string {
    const targetRepo = process.env.TARGET_REPO || process.env.GITHUB_REPO || "";
    const repoFlag = targetRepo ? ` -R ${targetRepo}` : "";
    return `# Deployment Execution Task (Auto-Trigger Workflow)

## Context
- **Jira Issue**: ${this.config.jiraIssueKey}
- **PR URL**: ${prUrl}
- **PR Number**: ${prNumber}

The repository has CI/CD workflows that auto-trigger on push to main.

## Instructions

1. **Run local pre-merge validation.** CI may only run AFTER merge, so you MUST catch failures locally first:
   \`\`\`bash
   npm install --ignore-scripts 2>/dev/null || yarn install 2>/dev/null || true
   npm run build 2>&1
   npm run lint 2>&1
   npm audit --audit-level=critical 2>&1
   npx prisma validate 2>/dev/null || true
   npm test 2>&1
   \`\`\`
   If ANY check fails (build, lint, audit critical, tests), DO NOT merge. Report \`DEPLOYMENT_DECISION: FAILURE\` with the failing output.

2. **Validate workflow secrets.** Check that all secrets referenced in workflow YAML actually exist:
   \`\`\`bash
   grep -roh 'secrets\\.[A-Z_]*' .github/workflows/ 2>/dev/null | sort -u
   gh secret list${repoFlag} 2>&1
   \`\`\`
   If any referenced secret is NOT in \`gh secret list\`, DO NOT merge — report FAILURE with the missing secrets.

3. **Check PR CI status (if available):**
   \`\`\`bash
   gh pr checks ${prNumber}${repoFlag} 2>&1 || echo "NO_PR_CHECKS"
   \`\`\`
   If checks exist and are running, wait with \`gh pr checks ${prNumber}${repoFlag} --watch\`.
   If no PR checks exist, that's OK — your local validation in step 1 is the gate.

4. Only after ALL validations pass and secrets are verified, merge: \`gh pr merge ${prNumber}${repoFlag} --squash --delete-branch\`
5. Wait for deployment workflow to start (sleep 10)
6. Monitor the workflow run to completion
7. Verify the workflow succeeded
8. Report your decision

**CRITICAL: Never merge without passing local validation AND verifying workflow secrets. The pre-merge gate is mandatory.**

Begin the deployment now.`;
  }

  /**
   * Build Phase 2 deployment prompt (for manual-triggered workflows).
   */
  private buildPhase2DeployManualPrompt(
    prUrl: string,
    prNumber: number,
    workflowFile: string,
    changedComponents: string[],
    workflowInputs: Record<string, string>
  ): string {
    // Build the workflow run command with appropriate flags
    const componentFlags = this.buildWorkflowFlags(changedComponents, workflowInputs);
    const targetRepo = process.env.TARGET_REPO || process.env.GITHUB_REPO || "";
    const repoFlag = targetRepo ? ` -R ${targetRepo}` : "";

    return `# Deployment Execution Task (Manual-Trigger Workflow)

## Context
- **Jira Issue**: ${this.config.jiraIssueKey}
- **PR URL**: ${prUrl}
- **PR Number**: ${prNumber}
- **Workflow File**: ${workflowFile}
- **Changed Components**: ${changedComponents.join(", ")}

The repository has a manual-trigger workflow (workflow_dispatch). You must merge the PR first, then trigger the workflow.

## Available Workflow Inputs
\`\`\`json
${JSON.stringify(workflowInputs, null, 2)}
\`\`\`

## Recommended Workflow Command

Based on the changed components (${changedComponents.join(", ")}), use:

\`\`\`bash
gh workflow run ${workflowFile}${repoFlag} ${componentFlags}
\`\`\`

## Instructions

1. **Run local pre-merge validation.** The deploy workflow only runs AFTER merge, so you MUST catch failures locally first:
   \`\`\`bash
   npm install --ignore-scripts 2>/dev/null || yarn install 2>/dev/null || true
   npm run build 2>&1
   npm run lint 2>&1
   npm audit --audit-level=critical 2>&1
   npx prisma validate 2>/dev/null || true
   npm test 2>&1
   \`\`\`
   If ANY check fails (build, lint, audit critical, tests), DO NOT merge. Report \`DEPLOYMENT_DECISION: FAILURE\` with the failing output.

2. **Validate workflow secrets.** Check that all secrets referenced in workflow YAML actually exist:
   \`\`\`bash
   grep -roh 'secrets\\.[A-Z_]*' .github/workflows/ 2>/dev/null | sort -u
   gh secret list${repoFlag} 2>&1
   \`\`\`
   If any referenced secret is NOT in \`gh secret list\`, DO NOT merge — report FAILURE with the missing secrets.

3. **Check PR CI status (if available):**
   \`\`\`bash
   gh pr checks ${prNumber}${repoFlag} 2>&1 || echo "NO_PR_CHECKS"
   \`\`\`
   If checks exist and are running, wait with \`gh pr checks ${prNumber}${repoFlag} --watch\`.
   If no PR checks exist, that's OK — your local validation in step 1 is the gate.

4. Only after ALL validations pass and secrets are verified, merge: \`gh pr merge ${prNumber}${repoFlag} --squash --delete-branch\`
5. Trigger the deployment workflow with the command above (adjust flags if needed based on actual workflow inputs)
6. Wait for workflow to start (sleep 5)
7. Monitor the workflow run to completion using \`gh run list${repoFlag} --workflow=${workflowFile}\`
8. Verify the workflow succeeded
9. Report your decision

**CRITICAL: Never merge without passing local validation. The pre-merge gate is mandatory.**
**IMPORTANT:** Only deploy the components that were actually changed. Do not trigger unnecessary deployments.

Begin the deployment now.`;
  }

  /**
   * Build workflow run flags based on changed components and available inputs.
   */
  private buildWorkflowFlags(changedComponents: string[], workflowInputs: Record<string, string>): string {
    const flags: string[] = [];
    const inputKeys = Object.keys(workflowInputs);

    // Common mappings from component names to workflow input patterns
    const componentMappings: Record<string, string[]> = {
      mobile: ["deploy_mobile", "deploy_mobile_ota", "mobile"],
      frontend: ["deploy_frontend", "frontend"],
      backend: ["deploy_backend", "backend", "deploy_api", "api"],
      infra: ["deploy_infra", "infrastructure", "terraform"],
    };

    // For each possible input, determine if it should be true or false
    for (const inputKey of inputKeys) {
      const inputLower = inputKey.toLowerCase();

      // Check if this input relates to any changed component
      let shouldEnable = false;
      for (const component of changedComponents) {
        const patterns = componentMappings[component.toLowerCase()] || [component.toLowerCase()];
        if (patterns.some(p => inputLower.includes(p))) {
          shouldEnable = true;
          break;
        }
      }

      // Only add boolean flags
      if (workflowInputs[inputKey] === "boolean") {
        flags.push(`-f ${inputKey}=${shouldEnable}`);
      }
    }

    // If no specific flags were set, return empty (let the workflow use defaults)
    if (flags.length === 0) {
      return "";
    }

    return flags.join(" ");
  }

  /**
   * Build Phase 2 workflow creation prompt (after approval).
   */
  private buildPhase2CreatePrompt(prUrl: string, prNumber: number, detectedStack: string): string {
    const targetRepo = process.env.TARGET_REPO || process.env.GITHUB_REPO || "";
    const repoFlag = targetRepo ? ` -R ${targetRepo}` : "";
    return `# Workflow Creation and Deployment Task

## Context
- **Jira Issue**: ${this.config.jiraIssueKey}
- **PR URL**: ${prUrl}
- **PR Number**: ${prNumber}
- **Detected Stack**: ${detectedStack}

You have been **APPROVED** to create GitHub Actions workflows for this repository.

## Instructions

1. Create appropriate deployment workflow for ${detectedStack} stack
2. Commit and push the workflow to the PR branch
3. **Run local pre-merge validation (MANDATORY):**
   \`\`\`bash
   npm install --ignore-scripts 2>/dev/null || yarn install 2>/dev/null || true
   npm run build 2>&1
   npm run lint 2>&1
   npm audit --audit-level=critical 2>&1
   npx prisma validate 2>/dev/null || true
   npm test 2>&1
   \`\`\`
   If ANY check fails, DO NOT merge. Report \`DEPLOYMENT_DECISION: FAILURE\` with details.
4. **Validate workflow secrets.** Check that all secrets referenced in workflow YAML (including the one you just created) actually exist:
   \`\`\`bash
   grep -roh 'secrets\\.[A-Z_]*' .github/workflows/ 2>/dev/null | sort -u
   gh secret list${repoFlag} 2>&1
   \`\`\`
   If any referenced secret is NOT in \`gh secret list\`, DO NOT merge — report FAILURE with the missing secrets.
5. Only after all validations pass and secrets are verified, merge: \`gh pr merge ${prNumber}${repoFlag} --squash --delete-branch\`
6. Monitor the workflow run to completion
7. Verify deployment succeeded
8. Report your decision

**CRITICAL: Never merge without passing local validation.**

Begin creating the workflow and deploying now.`;
  }

  /**
   * Handle messages from agent execution.
   */
  private handleMessage(msg: StreamMessage): void {
    if (msg.type === "thinking" && msg.content) {
      // postLog handles both console.log and API POST — don't double-log
      this.postLog(`[THINKING] ${msg.content}`, "output");
    } else if (msg.type === "tool_use" && msg.toolName) {
      let toolMsg = `Tool: ${msg.toolName}`;
      if (msg.toolInput) {
        const input = msg.toolInput;
        if (input.command) toolMsg += ` -> ${String(input.command).substring(0, 500)}`;
        else if (input.file_path) toolMsg += ` -> ${input.file_path}`;
      }
      this.postLog(toolMsg, "tool");
    } else if (msg.type === "text" && msg.content) {
      // Accumulate all text output for decision parsing
      this.allOutput += msg.content + "\n";

      // Log meaningful output
      if (msg.content.length > 20) {
        this.postLog(msg.content, "output");
      }
    } else if (msg.type === "result" && msg.content) {
      this.allOutput += msg.content + "\n";
      this.postLog(`Result: ${msg.content.substring(0, 500)}...`, "output");
    }
  }

  /**
   * Parse the deployment decision from agent output.
   */
  private parseDecision(): DeploymentDecision {
    // Look for DEPLOYMENT_DECISION: marker
    const decisionMatch = this.allOutput.match(/\*{0,2}DEPLOYMENT_DECISION\*{0,2}:\s*(deployed|failed|failure|blocked|escalated)/i);
    if (decisionMatch) {
      const raw = decisionMatch[1].toLowerCase();
      // Normalize "failure" → "failed" (prompts sometimes say FAILURE instead of failed)
      return (raw === "failure" ? "failed" : raw) as DeploymentDecision;
    }

    // Check for merge success indicators
    if (this.allOutput.includes("Squash and merge") ||
        this.allOutput.includes("merged") ||
        this.allOutput.includes("Pull request #")) {
      return "deployed";
    }

    // Default to failed if no explicit decision — log output tail for debugging
    const outputTail = this.allOutput.slice(-500).replace(/\n/g, " ").trim();
    console.log(`[devops_engineer] No explicit DEPLOYMENT_DECISION found in output, defaulting to failed. Output tail: ${outputTail}`);
    return "failed";
  }

  /**
   * Parse if workflows exist from Phase 1 assessment output.
   */
  private parseWorkflowsExist(): boolean {
    return /\*{0,2}WORKFLOWS_EXIST\*{0,2}:\s*true/i.test(this.allOutput);
  }

  /**
   * Parse if workflow creation is needed from Phase 1 assessment output.
   */
  private parseWorkflowCreationNeeded(): boolean {
    return /\*{0,2}WORKFLOW_CREATION_NEEDED\*{0,2}:\s*true/i.test(this.allOutput);
  }

  /**
   * Parse the trigger type from Phase 1 assessment output.
   * Returns "auto" for push-triggered, "manual" for workflow_dispatch only.
   */
  private parseTriggerType(): "auto" | "manual" | "unknown" {
    if (/\*{0,2}TRIGGER_TYPE\*{0,2}:\s*manual/i.test(this.allOutput)) {
      return "manual";
    }
    if (/\*{0,2}TRIGGER_TYPE\*{0,2}:\s*auto/i.test(this.allOutput)) {
      return "auto";
    }
    // Default to auto if workflows exist but no explicit type (backward compatibility)
    if (this.parseWorkflowsExist()) {
      return "auto";
    }
    return "unknown";
  }

  /**
   * Parse the workflow file name from Phase 1 assessment output.
   */
  private parseWorkflowFile(): string {
    const match = this.allOutput.match(/\*{0,2}WORKFLOW_FILE\*{0,2}:\s*([^\s\n]+)/i);
    return match ? match[1].trim() : "deploy.yml";
  }

  /**
   * Parse the changed components from Phase 1 assessment output.
   */
  private parseChangedComponents(): string[] {
    const match = this.allOutput.match(/\*{0,2}CHANGED_COMPONENTS\*{0,2}:\s*([^\n]+)/i);
    if (match) {
      return match[1].split(",").map(c => c.trim()).filter(c => c.length > 0);
    }
    // Default to empty if not found - agent will need to figure it out
    return [];
  }

  /**
   * Parse the workflow inputs from Phase 1 assessment output.
   */
  private parseWorkflowInputs(): Record<string, string> {
    const match = this.allOutput.match(/\*{0,2}WORKFLOW_INPUTS\*{0,2}:\s*(\{[^}]+\})/i);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {
        // Failed to parse JSON, return empty
        console.log("[devops_engineer] Failed to parse WORKFLOW_INPUTS JSON");
      }
    }
    return {};
  }

  /**
   * Parse the detected stack from Phase 1 assessment output.
   */
  private parseDetectedStack(): string {
    const match = this.allOutput.match(/\*{0,2}DETECTED_STACK\*{0,2}:\s*(\w+)/i);
    return match ? match[1].trim() : "unknown";
  }

  /**
   * Parse the proposed workflow description from Phase 1 assessment output.
   */
  private parseProposedWorkflow(): string {
    const match = this.allOutput.match(/\*{0,2}PROPOSED_WORKFLOW\*{0,2}:\s*(.+?)(?=\n(?:\*{0,2}DETECTED_STACK|WORKFLOW_CREATION_NEEDED)|$)/is);
    return match ? match[1].trim() : "Standard CI/CD workflow";
  }

  /**
   * Parse deployment summary from agent output.
   */
  private parseSummary(): string {
    // Look for DEPLOYMENT_SUMMARY: marker
    const summaryMatch = this.allOutput.match(/\*{0,2}DEPLOYMENT_SUMMARY\*{0,2}:\s*(.+?)(?=\n(?:\*{0,2}(?:DEPLOYMENT_DECISION|WORKFLOW_RUN_URL))|$)/is);
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
    const urlMatch = this.allOutput.match(/\*{0,2}WORKFLOW_RUN_URL\*{0,2}:\s*(https:\/\/[^\s]+)/i);
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
