/**
 * WorkerMill MCP Prompts
 *
 * Predefined prompts that guide AI assistants through common workflows
 * like troubleshooting failed tasks, creating and monitoring tasks,
 * and setting up new repositories for WorkerMill.
 */

import type { Prompt } from "@modelcontextprotocol/sdk/types.js";

export const PROMPT_DEFINITIONS: Prompt[] = [
  {
    name: "troubleshoot_task",
    description:
      "Debug a failed WorkerMill task step-by-step. Analyzes logs, identifies failure reasons, and suggests fixes.",
    arguments: [
      {
        name: "task_id",
        description: "The ID of the task to troubleshoot",
        required: true,
      },
    ],
  },
  {
    name: "create_and_monitor_task",
    description:
      "Create a task from a Jira issue and monitor it through completion. Guides through the full lifecycle.",
    arguments: [
      {
        name: "jira_key",
        description: "The Jira issue key (e.g., OCS-123)",
        required: true,
      },
    ],
  },
  {
    name: "review_epic_progress",
    description:
      "Review the progress of an Epic/PRD task with multiple stories. Shows expert collaboration and completion status.",
    arguments: [
      {
        name: "task_id",
        description: "The parent Epic/PRD task ID",
        required: true,
      },
    ],
  },
  {
    name: "optimize_worker_settings",
    description:
      "Review current settings and suggest optimizations for cost, performance, and reliability.",
    arguments: [],
  },
];

/**
 * Get the content for a prompt based on its name and arguments
 */
export function getPromptContent(
  promptName: string,
  args: Record<string, string>
): string {
  switch (promptName) {
    case "troubleshoot_task":
      return TROUBLESHOOT_TASK_PROMPT.replace(
        "{task_id}",
        args.task_id || "the task"
      );
    case "create_and_monitor_task":
      return CREATE_AND_MONITOR_PROMPT.replace(
        "{jira_key}",
        args.jira_key || "the Jira issue"
      );
    case "review_epic_progress":
      return REVIEW_EPIC_PROMPT.replace(
        "{task_id}",
        args.task_id || "the Epic task"
      );
    case "optimize_worker_settings":
      return OPTIMIZE_SETTINGS_PROMPT;
    default:
      return `Unknown prompt: ${promptName}`;
  }
}

const TROUBLESHOOT_TASK_PROMPT = `You are helping troubleshoot a failed WorkerMill task with ID: {task_id}

## Troubleshooting Steps

### Step 1: Get Task Details
Use \`workermill_get_task\` with id: "{task_id}" to fetch the full task details.

Review:
- **Status**: Should be "failed" - if not, clarify with the user
- **Exit code**: 137 = Spot interruption, 1 = Error, 0 = Success
- **Result**: The ::result:: marker output
- **Error message**: Any error details
- **Model used**: Which AI model was running
- **Persona**: Which worker role was assigned

### Step 2: Analyze Logs
Use \`workermill_get_task_logs\` with taskId: "{task_id}" to fetch execution logs.

Look for:
- **Error patterns**: Stack traces, "Error:", "Failed:"
- **Tool failures**: Git errors, API failures, permission issues
- **Context issues**: Missing files, wrong branch, merge conflicts
- **Resource issues**: Memory, timeouts, rate limits

### Step 3: Check if Epic/PRD Task
If the task has \`parentTaskId\` or \`pipelineVersion: "v2"\`, it's part of an Epic workflow.

Use \`workermill_get_coordination_feed\` with parentTaskId to see:
- Expert collaboration messages
- Decisions made by other personas
- Any blockers or questions
- Story completion status

### Step 4: Common Failure Patterns

| Pattern | Likely Cause | Fix |
|---------|--------------|-----|
| Exit 137 | AWS Spot interruption | Retry - use \`workermill_retry_task\` |
| "rate limit" in logs | API throttling | Wait and retry |
| "merge conflict" | Branch out of sync | Manual resolution needed |
| "authentication failed" | Token expired | Check GitHub/Jira tokens in settings |
| "command not found" | Missing tool in container | Check worker Dockerfile |
| Empty logs | Task never started | Check orchestrator status |

### Step 5: Suggested Actions

Based on the failure type:

**If retriable error (Spot, rate limit, transient):**
- Use \`workermill_retry_task\` to retry

**If configuration issue:**
- Check \`workermill_get_settings\` for misconfiguration
- Check \`workermill_get_integrations\` for broken integrations

**If code/logic issue:**
- The Jira ticket may need clarification
- Suggest updating acceptance criteria

### Step 6: Document Findings
Summarize:
1. Root cause of failure
2. Whether retry will help
3. Any manual intervention needed
4. Recommendations for preventing future failures
`;

const CREATE_AND_MONITOR_PROMPT = `You are helping create and monitor a WorkerMill task for Jira issue: {jira_key}

## Task Lifecycle Steps

### Step 1: Verify Prerequisites
Before creating the task, verify:
1. Orchestrator is running: \`workermill_orchestrator_status\`
2. Integrations are healthy: \`workermill_get_integrations\`

If orchestrator is stopped, ask if user wants to start it with \`workermill_start_orchestrator\`.

### Step 2: Create the Task
Use \`workermill_create_task\` with:
- jiraIssueKey: "{jira_key}"

Ask the user if they want to customize:
- **workerModel**: haiku (fast/cheap), sonnet (balanced), opus (powerful)
- **workerPersona**: backend_developer, frontend_developer, devops_engineer, etc.
- **deploymentEnabled**: Auto-deploy after PR approval?
- **skipManagerReview**: Skip virtual manager review?

### Step 3: Monitor Initial Status
After creation, the task will be queued. Use \`workermill_get_task\` to check status.

Task status flow:
\`\`\`
queued → running → completed/failed
         ↓
    (if Epic) planning → executing → review_requested
\`\`\`

### Step 4: Monitor Execution
Poll task status periodically:
- Use \`workermill_get_task\` to check current status
- Use \`workermill_get_task_logs\` to see real-time progress

For Epic/PRD tasks (multiple stories):
- Use \`workermill_get_plan\` to see the execution plan
- Use \`workermill_get_children\` to see child story tasks
- Use \`workermill_get_coordination_feed\` to see expert collaboration

### Step 5: Handle Completion States

**If completed successfully:**
- Check the PR URL in task details
- The task output will show ::result:: and ::pr_url:: markers

**If review_requested:**
- A PR was created and needs human review
- After approving the PR on GitHub, the webhook will trigger deployment

**If failed:**
- Use the troubleshoot_task prompt to debug
- Consider \`workermill_retry_task\` for transient errors

### Step 6: Post-Completion
After task completes:
- Review the PR on GitHub
- Check \`workermill_dashboard_stats\` for cost impact
- The Jira ticket should be updated automatically

## Tips
- Epic mode (default) creates multiple stories executed in parallel
- Add \`deploy\` label to Jira for auto-deployment without PR approval
- Add \`review\` label to require virtual manager review
- Use \`workermill_cancel_task\` if you need to stop a running task
`;

const REVIEW_EPIC_PROMPT = `You are helping review the progress of an Epic/PRD task with ID: {task_id}

## Epic Review Steps

### Step 1: Get Parent Task Overview
Use \`workermill_get_task\` with id: "{task_id}" to get the Epic task details.

Verify it's an Epic task by checking:
- \`pipelineVersion: "v2"\`
- \`executionMode: "epic"\` or \`executionMode: "multi-provider"\`

### Step 2: Review the Execution Plan
Use \`workermill_get_plan\` with id: "{task_id}" to see:
- Stories planned by the Planning Agent
- Dependencies between stories
- Assigned personas for each story
- Target files for each story

### Step 3: Check Child Task Status
Use \`workermill_get_children\` with id: "{task_id}" to see all story tasks.

For each child task, note:
- Status (queued, running, completed, failed)
- Assigned persona
- Story index and dependencies

### Step 4: Review Expert Collaboration
Use \`workermill_get_coordination_feed\` with parentTaskId: "{task_id}" to see real-time collaboration.

Look for message types:
- **decision**: Important choices made by experts
- **question**: Experts asking for clarification
- **consultation**: Expert-to-expert questions
- **answer**: Responses to questions
- **completion**: Stories finishing
- **blocker**: Issues preventing progress
- **file_created/file_modified**: Code changes

### Step 5: Identify Issues

**Blocked stories:**
- Check for unanswered questions
- Look for blocker messages
- Verify dependencies are completing

**Failed stories:**
- Use \`workermill_get_task\` on the child task ID
- Review child task logs
- Consider retry or manual intervention

**Stalled progress:**
- Check if experts are waiting for input
- Look for consultation messages without answers
- Verify no circular dependencies

### Step 6: Take Action

**If questions need answers:**
- Questions appear in the coordination feed
- Dashboard users can answer via the UI
- Answers unblock waiting experts

**If a story failed:**
- Analyze the failure
- Consider retrying the child task
- May need to cancel and restart the Epic

**If all stories complete:**
- The parent task should transition to completed
- A consolidated PR should be created
- Review the PR on GitHub

### Summary Format
Provide a summary showing:
1. Overall Epic status
2. Story completion progress (X of Y complete)
3. Any blocked or failed stories
4. Pending questions needing answers
5. Recommended next steps
`;

const OPTIMIZE_SETTINGS_PROMPT = `You are helping optimize WorkerMill settings for cost, performance, and reliability.

## Optimization Analysis Steps

### Step 1: Get Current Settings
Use \`workermill_get_settings\` to fetch current organization settings.

Key settings to review:
- \`maxConcurrentWorkers\`: How many workers run in parallel
- \`defaultWorkerModel\`: Default AI model (haiku/sonnet/opus)
- \`defaultWorkerPersona\`: Default worker role
- \`defaultMaxRetries\`: Retry attempts for failed tasks
- \`taskCooldownSeconds\`: Delay before re-processing same ticket
- \`logRetentionDays\`: How long logs are kept
- \`taskRetentionDays\`: How long tasks are kept
- \`costAlertThresholdUsd\`: Cost alert trigger

### Step 2: Get Usage Statistics
Use \`workermill_dashboard_stats\` to understand current usage:
- Task counts by status
- Cost breakdown
- Recent activity

### Step 3: Get Provider/Model Info
Use \`workermill_get_models\` and \`workermill_get_providers\` to understand available options.

### Step 4: Cost Optimization Recommendations

| Setting | Cost Impact | Recommendation |
|---------|-------------|----------------|
| defaultWorkerModel | High | Use haiku for simple tasks, sonnet for complex |
| maxConcurrentWorkers | Medium | Lower = slower but cheaper |
| defaultMaxRetries | Low | 2-3 is usually sufficient |

**Model cost comparison (approximate):**
- Haiku: $0.25/task average
- Sonnet: $1.50/task average
- Opus: $15/task average

### Step 5: Performance Optimization

| Setting | Performance Impact | Recommendation |
|---------|-------------------|----------------|
| maxConcurrentWorkers | High | More workers = faster parallel execution |
| taskCooldownSeconds | Medium | Lower = faster re-processing |

### Step 6: Reliability Optimization

| Setting | Reliability Impact | Recommendation |
|---------|-------------------|----------------|
| defaultMaxRetries | High | 3 handles most transient failures |
| costAlertThresholdUsd | Medium | Set to catch runaway costs |

### Step 7: Suggest Changes
Based on the analysis, recommend specific \`workermill_update_settings\` calls.

Example optimizations:
\`\`\`
# For cost-conscious teams
workermill_update_settings({
  defaultWorkerModel: "claude-haiku-4-5",
  maxConcurrentWorkers: 2,
  costAlertThresholdUsd: 50
})

# For speed-focused teams
workermill_update_settings({
  defaultWorkerModel: "claude-sonnet-4",
  maxConcurrentWorkers: 5,
  defaultMaxRetries: 2
})
\`\`\`

### Step 8: Verify Integration Health
Use \`workermill_get_integrations\` to check all integrations are working.

Flag any issues:
- Jira: Token expiration, permissions
- GitHub: Token scope, rate limits
- Slack: Webhook configuration
`;
