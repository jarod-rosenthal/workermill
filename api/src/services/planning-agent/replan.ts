/**
 * Planning Agent Replan
 *
 * Re-run planning with user feedback when a plan is rejected.
 */

import { generateText } from "ai";
import { Organization } from "../../models/Organization.js";
import { WorkerTask } from "../../models/WorkerTask.js";
import { AppDataSource } from "../../db/connection.js";
import { logger } from "../../utils/logger.js";
import { getProviderCredentials } from "../../config/index.js";
import type { ExecutionPlan } from "./types.js";
import { DEFAULT_PLANNING_CONFIG } from "./types.js";
import { getPlanningConfig, createModel } from "./config.js";
import { calculateComplexity, formatComplexityConstraint, formatComplexityBreakdown } from "./complexity.js";
import { fetchCodebaseContextForTask, addPlanningLog, parseExecutionPlanJson } from "./helpers.js";
import { validatePlan } from "./planner-v1.js";

// Import the PLANNING_PROMPT - we need it for replan
// Since it's a large constant, we reference it here as well
const PLANNING_PROMPT = `You are a technical planning agent for WorkerMill. Analyze this PRD and create an execution plan.

## CRITICAL: COMPLEXITY CONSTRAINT

{{COMPLEXITY_CONSTRAINT}}

**YOU MUST FOLLOW THIS CONSTRAINT.** Your plan MUST align with the recommendation.

## Repository Structure and Context

This is the ACTUAL codebase you are working with. Use ONLY files that exist here.

### File Tree (2 levels)
\`\`\`
{{FILE_TREE}}
\`\`\`

### Tech Stack Detection
{{TECH_STACK}}

### Project Overview (README)
\`\`\`
{{README_SUMMARY}}
\`\`\`

**CRITICAL: targetFiles MUST be real paths from the File Tree above. Do NOT invent files.**

## Output Instructions

**You MUST respond with ONLY a valid JSON object (no markdown code blocks, no explanation before or after).**

**JSON Schema:**
{
  "strategy": "single" | "multi",
  "reasoning": "string",
  "primaryPersona": "string",
  "qualityGates": ["gate1", "gate2"],
  "stories": [...]
}

Now analyze the PRD and output your execution plan as JSON.`;

/**
 * Re-run planning with user feedback
 *
 * When a user requests changes to the plan, we re-run the planning agent
 * with the original PRD plus the user's feedback.
 */
export async function replanWithFeedback(
  task: WorkerTask,
  feedback: string
): Promise<ExecutionPlan> {
  logger.info("Re-running planning agent with feedback", {
    taskId: task.id,
    jiraKey: task.jiraIssueKey,
    feedbackLength: feedback.length,
  });

  // Log start - visible in dashboard
  await addPlanningLog(task.id, `🔄 Re-planning with user feedback: ${task.jiraIssueKey}`);
  await addPlanningLog(task.id, `📝 Feedback: ${feedback.slice(0, 200)}${feedback.length > 200 ? "..." : ""}`);

  // Recalculate complexity for the revised plan
  const complexity = await calculateComplexity(
    task.summary || "",
    task.description || "",
    (task.jiraFields?.labels as string[] | undefined) || [],
    task.orgId
  );

  // Accumulate complexity scoring tokens for cost tracking
  if (complexity.tokenUsage) {
    task.planningInputTokens = (task.planningInputTokens || 0) + complexity.tokenUsage.inputTokens;
    task.planningOutputTokens = (task.planningOutputTokens || 0) + complexity.tokenUsage.outputTokens;
  }

  // Fetch codebase context again (may have changed)
  let codebaseContext = {
    fileTree: "Unable to fetch (no repository context)",
    readme: null as string | null,
    techStack: null as Record<string, unknown> | null,
  };

  if (task.githubRepo) {
    try {
      codebaseContext = await fetchCodebaseContextForTask(task.githubRepo, task.orgId);
      await addPlanningLog(task.id, `✅ Retrieved updated repository structure`);
    } catch (error) {
      logger.warn("Failed to fetch codebase context during replan", {
        taskId: task.id,
        repo: task.githubRepo,
        error,
      });
      await addPlanningLog(task.id, `⚠️ Could not fetch updated codebase context`);
    }
  }

  // Format tech stack info for prompt
  let techStackStr = "No tech stack detected";
  if (codebaseContext.techStack) {
    if (codebaseContext.techStack.type === "Node.js/JavaScript") {
      const deps = codebaseContext.techStack.dependencies as Record<string, unknown> | undefined;
      const depKeys = deps ? Object.keys(deps).slice(0, 10).join(", ") : "";
      techStackStr = `Node.js/JavaScript project\nKey dependencies: ${depKeys}`;
    } else if (codebaseContext.techStack.type === "Python") {
      techStackStr = `Python project (${codebaseContext.techStack.configFile as string})`;
    }
  }

  const readmeSummary = codebaseContext.readme
    ? codebaseContext.readme.slice(0, 1500)
    : "No README found";

  // Build prompt with feedback AND complexity constraints
  const prompt =
    PLANNING_PROMPT.replace("{{JIRA_KEY}}", task.jiraIssueKey || "Unknown")
      .replace("{{SUMMARY}}", task.summary || "No summary")
      .replace("{{DESCRIPTION}}", task.description || "No description")
      .replace("{{LABELS}}", JSON.stringify(task.jiraFields?.labels || []))
      .replace("{{REPO}}", task.githubRepo || "Not specified")
      .replace("{{COMPLEXITY_CONSTRAINT}}", formatComplexityConstraint(complexity))
      .replace("{{COMPLEXITY_BREAKDOWN}}", formatComplexityBreakdown(complexity))
      .replace("{{FILE_TREE}}", codebaseContext.fileTree)
      .replace("{{TECH_STACK}}", techStackStr)
      .replace("{{README_SUMMARY}}", readmeSummary)
      .replace(/\{\{MAX_STORIES\}\}/g, String(complexity.maxStories)) +
    `

## Previous Plan Feedback

The previous plan was rejected. Here is the user's feedback:

${feedback}

Please create a revised plan that addresses this feedback while still respecting the complexity constraints above.
Respond with ONLY the JSON object (no markdown, no explanation).`;

  // Get org planning config
  const orgRepo = AppDataSource.getRepository(Organization);
  const org = await orgRepo.findOne({ where: { id: task.orgId } });
  const planningConfig = org ? getPlanningConfig(org) : DEFAULT_PLANNING_CONFIG;

  // Get org-specific API credentials (skip for ollama which doesn't need keys)
  const apiKey = planningConfig.provider === "ollama"
    ? ""
    : await getProviderCredentials(task.orgId, planningConfig.provider as "anthropic" | "openai" | "google");

  const model = createModel(planningConfig.provider, planningConfig.model, apiKey, planningConfig.ollamaBaseUrl);
  const response = await generateText({
    model,
    prompt,
    maxOutputTokens: 16384,
    temperature: 0,
  });

  // Post the raw LLM analysis text to dashboard logs
  {
    const rawText = response.text;
    const LOG_PREFIX = "[💡 planning_agent 🤖]";
    const MAX_LOG_BYTES = 10_000;
    let loggedBytes = 0;
    for (const line of rawText.split("\n")) {
      if (!line.trim()) continue;
      if (loggedBytes + line.length > MAX_LOG_BYTES) {
        await addPlanningLog(task.id, `${LOG_PREFIX} ... (output truncated at ${MAX_LOG_BYTES} chars)`);
        break;
      }
      await addPlanningLog(task.id, `${LOG_PREFIX} ${line}`);
      loggedBytes += line.length;
    }
  }

  // Parse JSON response
  const plan = parseExecutionPlanJson(response.text);
  validatePlan(plan);

  // Log the revised plan details
  await addPlanningLog(task.id, `✅ Revised plan created: ${plan.strategy.toUpperCase()} strategy`);
  if (plan.strategy === "single") {
    await addPlanningLog(task.id, `👤 Primary Persona: ${plan.primaryPersona}`);
  } else if (plan.stories && plan.stories.length > 0) {
    await addPlanningLog(task.id, `📚 Stories planned: ${plan.stories.length}`);
    for (const story of plan.stories) {
      await addPlanningLog(task.id, `  ${story.index + 1}. [${story.persona}] ${story.title}`);
    }
  }
  await addPlanningLog(task.id, `⏳ Awaiting revised plan approval...`);

  // Store the revised plan with updated complexity
  const taskRepo = AppDataSource.getRepository(WorkerTask);
  task.planJson = {
    ...plan,
    _complexity: complexity, // Store for audit/debugging
  } as unknown as Record<string, unknown>;
  // Atomic update for revised plan approval
  await taskRepo
    .createQueryBuilder()
    .update(WorkerTask)
    .set({
      planJson: task.planJson,
      planStatus: "pending_approval",
      status: "pending_plan_approval",
      planFeedback: feedback,
    } as Record<string, unknown>)
    .where("id = :id", { id: task.id })
    .execute();

  logger.info("Revised plan created", {
    taskId: task.id,
    jiraKey: task.jiraIssueKey,
    strategy: plan.strategy,
  });

  return plan;
}
