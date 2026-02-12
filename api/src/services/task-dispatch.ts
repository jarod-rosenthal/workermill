/**
 * Task Dispatch — Multi-story plan dispatch, PRD constraints, and PR merging
 *
 * Extracted from orchestrator.ts.
 * Used by: orchestrator.ts (pollLoop), task-monitor.ts (checkParentTaskCompletion)
 *
 * Contains:
 * - postPrdConstraints(): Post tech stack constraints to coordination feed
 * - dispatchMultiStoryPlan(): Create child tasks from multi-story plan
 * - mergeStoryPRsInOrder(): Phase 3 — merge child PRs in dependency order
 */

import { AppDataSource } from "../db/connection.js";
import {
  WorkerTask,
  Organization,
  WorkerContext,
  type WorkerPersona,
} from "../models/index.js";
import { logger } from "../utils/logger.js";
import {
  createJiraSubtask,
  createJiraStory,
  convertToEpic,
} from "../utils/jira.js";
import { getScmProvider } from "../scm-providers/index.js";
import { TechStack } from "./planning-agent/index.js";
import {
  getTaskRepo,
  getOrgRepo,
  isDryRunTask,
  logTaskEvent,
  enforceFileDependencies,
} from "./orchestrator-utils.js";

/**
 * Extract and post PRD constraints to the coordination context.
 *
 * This function extracts tech stack constraints, framework requirements, and
 * other project-level constraints from the PRD description and posts them
 * as a "constraints" context message. All child workers will receive this
 * in their sibling context at startup, ensuring alignment on tech decisions.
 *
 * This MUST be called BEFORE spawning any child workers (as per Gemini 3 Pro's
 * recommendation for avoiding race conditions).
 */
async function postPrdConstraints(
  task: WorkerTask,
  techStack?: TechStack,
): Promise<void> {
  const contextRepo = AppDataSource.getRepository(WorkerContext);
  const allConstraints: string[] = [];

  // ==========================================================================
  // PRIORITY 1: Use techStack from Planning Agent (authoritative source)
  // ==========================================================================
  // When the planning agent provides techStack decisions, these take precedence
  // because they were explicitly decided with full context of the codebase and PRD.
  if (techStack) {
    // Build structured constraint messages from techStack
    const stackConstraints: string[] = [];

    // Language constraint
    stackConstraints.push(`**Language**: ${techStack.language}`);

    // Framework constraint (critical for "no framework" scenarios)
    if (
      techStack.framework === "none" ||
      techStack.framework === "vanilla"
    ) {
      stackConstraints.push(
        `**Framework**: NONE - Do NOT use any frameworks (React, Vue, Angular, etc.)`,
      );
    } else {
      stackConstraints.push(`**Framework**: ${techStack.framework}`);
    }

    // Styling constraint
    if (techStack.styling && techStack.styling !== "n/a") {
      if (
        techStack.styling === "vanilla-css" ||
        techStack.styling === "vanilla"
      ) {
        stackConstraints.push(
          `**Styling**: Vanilla CSS only - No CSS frameworks or preprocessors`,
        );
      } else {
        stackConstraints.push(`**Styling**: ${techStack.styling}`);
      }
    }

    // Database
    if (
      techStack.database &&
      techStack.database !== "none" &&
      techStack.database !== "n/a"
    ) {
      stackConstraints.push(`**Database**: ${techStack.database}`);
    }

    // Testing
    if (techStack.testing) {
      stackConstraints.push(`**Testing**: ${techStack.testing}`);
    }

    // Build tool
    if (techStack.buildTool) {
      stackConstraints.push(`**Build Tool**: ${techStack.buildTool}`);
    }

    // Add all structured constraints
    allConstraints.push(...stackConstraints);

    // Add verbatim PRD constraints if any
    if (techStack.prdConstraints && techStack.prdConstraints.length > 0) {
      allConstraints.push("");
      allConstraints.push(
        "**Verbatim PRD Constraints (must be followed exactly):**",
      );
      allConstraints.push(
        ...techStack.prdConstraints.map((c) => `- ${c}`),
      );
    }

    // Add rationale for transparency
    if (techStack.rationale) {
      allConstraints.push("");
      allConstraints.push(`_Rationale: ${techStack.rationale}_`);
    }

    logger.info("Using techStack from planning agent for constraints", {
      taskId: task.id,
      techStack,
    });
  }

  // ==========================================================================
  // PRIORITY 2: Fallback to regex extraction from PRD description
  // ==========================================================================
  // Only used if no techStack was provided (legacy path or single-story tasks)
  if (allConstraints.length === 0 && task.description) {
    const constraintPatterns = [
      /tech\s*stack[:\s]*([^\n]+(?:\n(?![A-Z#])[^\n]+)*)/gi,
      /(?:technical?\s*)?constraints?[:\s]*([^\n]+(?:\n(?![A-Z#])[^\n]+)*)/gi,
      /(?:no|don'?t|avoid|must\s+not)\s+(?:use\s+)?(?:any\s+)?(?:frameworks?|libraries?|react|vue|angular|jquery)[^\n]*/gi,
      /(?:pure|vanilla|plain)\s+(?:html|css|js|javascript)[^\n]*/gi,
      /(?:must|should|required?)\s+(?:use|be)\s+(?:only\s+)?(?:html|css|js|javascript|typescript|python|node)[^\n]*/gi,
    ];

    const description = task.description;

    for (const pattern of constraintPatterns) {
      const matches = description.matchAll(pattern);
      for (const match of matches) {
        const constraint = match[0].trim();
        if (constraint && !allConstraints.includes(constraint)) {
          allConstraints.push(constraint);
        }
      }
    }

    // Also look for explicit constraint sections
    const sectionMatch = description.match(
      /##?\s*(?:technical?\s*)?constraints?[:\s]*\n([\s\S]*?)(?=\n##|\n\n\n|$)/i,
    );
    if (sectionMatch) {
      const sectionContent = sectionMatch[1].trim();
      if (sectionContent && !allConstraints.includes(sectionContent)) {
        allConstraints.push(sectionContent);
      }
    }

    // If no explicit constraints found, include key parts of the description
    // that mention technology choices
    if (allConstraints.length === 0) {
      const techMentions = description.match(
        /(?:using|with|in)\s+(?:pure\s+)?(?:html|css|javascript|typescript|react|vue|angular|node|python)[^\n]*/gi,
      );
      if (techMentions) {
        allConstraints.push(...techMentions.map((m) => m.trim()));
      }
    }
  }

  // ==========================================================================
  // If no constraints found at all, skip posting
  // ==========================================================================
  if (allConstraints.length === 0) {
    logger.info(
      "No constraints found (no techStack and no PRD constraints)",
      {
        taskId: task.id,
        jiraKey: task.jiraIssueKey,
      },
    );
    return;
  }

  // Format constraints for context message
  const constraintsContent = techStack
    ? `## MANDATORY Tech Stack Constraints (from Planning Agent)

**ALL workers MUST follow these tech stack decisions. Deviating from these is NOT allowed.**

${allConstraints.join("\n")}

**VIOLATION OF THESE CONSTRAINTS WILL CAUSE YOUR WORK TO BE REJECTED.**
If you're unsure about a technology choice, ask via the sibling Q&A system.`
    : `## PRD Technical Constraints

The following constraints apply to ALL stories in this PRD. You MUST adhere to these:

${allConstraints.map((c) => `- ${c}`).join("\n")}

**IMPORTANT**: Do not deviate from these constraints. If you're unsure, ask via the sibling Q&A system.`;

  // Post to coordination context
  const context = contextRepo.create({
    parentTaskId: task.id,
    taskId: task.id, // Posted by the orchestrator (parent task)
    orgId: task.orgId,
    persona: "orchestrator", // Special persona for system messages
    messageType: "constraints" as const,
    content: constraintsContent,
    metadata: {
      extractedConstraints: allConstraints,
      techStack: techStack || null,
      source: techStack ? "planning-agent" : "prd-regex",
      prdJiraKey: task.jiraIssueKey,
      postedAt: new Date().toISOString(),
    },
  });

  await contextRepo.save(context);

  logger.info("Posted constraints to coordination context", {
    taskId: task.id,
    jiraKey: task.jiraIssueKey,
    constraintCount: allConstraints.length,
    source: techStack ? "planning-agent" : "prd-regex",
    techStack: techStack || null,
  });

  await logTaskEvent(
    task.id,
    "info",
    techStack
      ? `🔧 Posted tech stack constraints from planning agent (${techStack.language}/${techStack.framework})`
      : `📋 Posted ${allConstraints.length} PRD constraint(s) to worker coordination feed`,
  );
}

/**
 * Check if a task has a multi-story plan and dispatch child tasks
 * Returns true if child tasks were created, false otherwise
 */
export async function dispatchMultiStoryPlan(
  task: WorkerTask,
): Promise<boolean> {
  const taskRepo = AppDataSource.getRepository(WorkerTask);

  // Check if this task has an approved multi-story plan
  // Type matches PlannedStory from planning-agent.ts
  const planJson = task.planJson as {
    strategy?: string;
    executionMode?: string;
    featureBranch?: string; // Feature branch for multi-story workflow
    techStack?: TechStack; // Tech stack decisions from planning agent
    stories?: Array<{
      id?: string;
      index: number;
      title: string;
      persona: string;
      scope?: string;
      description?: string;
      acceptanceCriteria?: string[];
      dependencies?: (string | number)[];
      estimatedComplexity?: "small" | "medium" | "large";
      storyPoints?: number;
      targetFiles?: string[];
      referenceFiles?: string[];
    }>;
  } | null;

  if (
    !planJson ||
    planJson.strategy !== "multi" ||
    !planJson.stories?.length
  ) {
    // Not a multi-story plan, but may still need to update persona for single-story
    // PRD tasks start with project_manager persona for planning, but execution
    // should use the primaryPersona from the plan
    const singlePlan = task.planJson as {
      strategy?: string;
      primaryPersona?: string;
    } | null;
    if (singlePlan?.strategy === "single" && singlePlan.primaryPersona) {
      const oldPersona = task.workerPersona;
      const newPersona = singlePlan.primaryPersona as WorkerPersona;
      await taskRepo
        .createQueryBuilder()
        .update(WorkerTask)
        .set({ workerPersona: newPersona })
        .where("id = :id", { id: task.id })
        .execute();
      task.workerPersona = newPersona;

      logger.info("Updated single-story task persona from plan", {
        taskId: task.id,
        oldPersona,
        newPersona,
      });
    }
    return false;
  }

  // VALIDATION: Enforce file-based dependencies
  // Detects stories targeting the same file and adds synthetic dependencies
  // NOTE: We DON'T update parent task.planJson - keep original for UI display
  // The validated dependencies are only used internally for child task creation
  //
  // IMPORTANT: Deep clone the plan before validation because enforceFileDependencies
  // mutates the stories array in place. Without cloning, planJson would be modified.
  const planClone = JSON.parse(JSON.stringify(planJson));
  const validatedPlan = enforceFileDependencies(planClone);

  // Check if dependencies were added by comparing story dependencies
  const originalDeps =
    planJson.stories?.map((s) => s.dependencies?.length || 0) || [];
  const validatedDeps =
    validatedPlan.stories?.map(
      (s: any) => s.dependencies?.length || 0,
    ) || [];
  const hasNewDependencies =
    JSON.stringify(originalDeps) !== JSON.stringify(validatedDeps);

  if (hasNewDependencies) {
    logger.info(
      "Applied file-based dependencies for child task creation (not saved to parent)",
      {
        taskId: task.id,
        jiraKey: task.jiraIssueKey,
        originalDeps,
        validatedDeps,
      },
    );

    await logTaskEvent(
      task.id,
      "info",
      "📋 Applied file-based dependency validation for execution order",
    );
  }

  // Use validated plan (with file-based deps) for child task creation
  // Parent planJson remains unchanged so UI shows original parallel structure
  const executionPlan = { ...validatedPlan } as typeof planJson;

  // Use feature branch from approval if it exists, otherwise create one
  // This prevents creating duplicate branches (approval creates feature/OCS-123, we shouldn't create prd/ocs-123)
  let featureBranch = planJson.featureBranch as string | undefined;

  if (!featureBranch && task.githubBranch) {
    // Branch was created during approval and stored on task
    featureBranch = task.githubBranch;
  }

  logger.info("Dispatching multi-story PRD plan", {
    taskId: task.id,
    jiraIssueKey: task.jiraIssueKey,
    storyCount: planJson.stories.length,
    featureBranch: featureBranch || "(will create)",
  });

  // Log dispatch start
  await logTaskEvent(
    task.id,
    "status_change",
    `Dispatching ${planJson.stories.length} stories for parallel execution`,
  );

  // DRY-RUN: Simulate dispatch without creating real Jira stories, Git branches, etc.
  const isDryRun = isDryRunTask(task);
  if (isDryRun) {
    logger.info("[DRY RUN] Simulating multi-story dispatch", {
      taskId: task.id,
      jiraKey: task.jiraIssueKey,
      storyCount: planJson.stories.length,
    });

    // Set a simulated feature branch so isPrdWorkflow detection works for child unblocking
    const simulatedFeatureBranch = `feature/${task.jiraIssueKey}-dry-run`;
    task.githubBranch = simulatedFeatureBranch;

    await logTaskEvent(
      task.id,
      "info",
      `[DRY RUN] Would create feature branch: ${simulatedFeatureBranch}`,
    );
    await logTaskEvent(
      task.id,
      "info",
      `[DRY RUN] Would convert ${task.jiraIssueKey} to Epic`,
    );

    // Create simulated child tasks (in DB only, no Jira stories)
    // Use executionPlan.stories (validated with file-based dependencies) instead of planJson.stories
    const childTaskIds: string[] = [];
    for (let i = 0; i < executionPlan.stories!.length; i++) {
      const story = executionPlan.stories![i];
      const childTask = new WorkerTask();
      childTask.orgId = task.orgId;
      childTask.jiraIssueKey = `${task.jiraIssueKey}-DRY-S${i + 1}`;
      childTask.jiraIssueId = task.jiraIssueId;
      childTask.summary = `[DRY RUN] S${i + 1}: ${story.title}`;
      childTask.workerPersona = story.persona as WorkerPersona;
      childTask.workerModel = task.workerModel;
      childTask.workerProvider = task.workerProvider;

      // Stories with dependencies start as BLOCKED; stories without dependencies start as QUEUED
      const hasDependencies =
        story.dependencies && story.dependencies.length > 0;
      childTask.status = hasDependencies ? "blocked" : "queued";

      childTask.parentTaskId = task.id;
      childTask.githubRepo = task.githubRepo;
      childTask.jiraFields = {
        ...(task.jiraFields || {}),
        labels: [
          ...((
            (task.jiraFields as Record<string, unknown>)?.labels as
              | string[]
              | undefined
          ) || []),
        ],
        storyIndex: i + 1, // 1-based to match regular path
        storyDependencies:
          story.dependencies
            ?.map((depId: string | number) => {
              // Dependencies come as 0-based indices from the planning agent
              // Convert to 1-based storyIndex (storyIndex starts at 1)
              if (typeof depId === "number") {
                return depId + 1; // 0 -> 1, 1 -> 2, etc.
              }
              // Fallback: try to find by ID if it's a string
              const depIndex = executionPlan.stories!.findIndex(
                (s: { id?: string }) => s.id === depId,
              );
              return depIndex >= 0 ? depIndex + 1 : null;
            })
            .filter(
              (x: number | null): x is number =>
                x !== null && x !== undefined,
            ) || [],
        targetFiles: story.targetFiles || [],
      };

      const savedChild = await taskRepo.save(childTask);
      childTaskIds.push(savedChild.id);

      const statusNote = hasDependencies
        ? "(blocked - has dependencies)"
        : "(queued)";
      await logTaskEvent(
        task.id,
        "info",
        `[DRY RUN] Created simulated story ${i + 1}: ${story.title} ${statusNote}`,
      );
      logger.info("[DRY RUN] Created simulated child task", {
        parentTaskId: task.id,
        childTaskId: savedChild.id,
        storyIndex: i + 1,
        status: childTask.status,
        dependencies: childTask.jiraFields?.storyDependencies,
      });
    }

    // Update parent with child IDs — atomic update
    await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({
        childTaskIds: childTaskIds,
        status: "dispatching",
      } as Record<string, unknown>)
      .where("id = :id", { id: task.id })
      .execute();

    await logTaskEvent(
      task.id,
      "info",
      `[DRY RUN] Dispatch complete - ${childTaskIds.length} simulated stories queued`,
    );
    logger.info("[DRY RUN] Multi-story dispatch simulated", {
      taskId: task.id,
      childCount: childTaskIds.length,
    });

    return true;
  }

  // Only create feature branch if not already created during approval
  // Skip in local mode - git-ops.ts handles branch creation locally via direct git commands
  const isLocalMode = process.env.EXECUTION_MODE === "local";
  if (task.githubRepo && !featureBranch && !isLocalMode) {
    // Generate feature branch name: feature/<jira-key>
    featureBranch = `feature/${task.jiraIssueKey || task.id.slice(0, 8)}`;

    try {
      // Get the organization to determine the correct SCM provider
      const orgRepo = AppDataSource.getRepository(Organization);
      const org = await orgRepo.findOne({ where: { id: task.orgId } });

      if (org) {
        // Use SCM provider abstraction for multi-provider support (GitHub, GitLab, BitBucket)
        const scmProvider = getScmProvider(org);
        const repoId = scmProvider.parseRepoIdentifier(task.githubRepo);
        const branchCreated = await scmProvider.createBranch(
          repoId,
          featureBranch,
          "main",
        );

        if (branchCreated) {
          await logTaskEvent(
            task.id,
            "info",
            `📌 Created feature branch: ${featureBranch}`,
          );
          logger.info(
            "Created feature branch for multi-story workflow",
            {
              taskId: task.id,
              repo: task.githubRepo,
              featureBranch,
              scmProvider: org.scmProvider || "github",
            },
          );
        } else {
          await logTaskEvent(
            task.id,
            "info",
            `⚠️ Could not create feature branch ${featureBranch} - child PRs will target main`,
          );
          logger.warn("Failed to create feature branch", {
            taskId: task.id,
            repo: task.githubRepo,
            featureBranch,
            scmProvider: org.scmProvider || "github",
          });
          featureBranch = undefined;
        }
      } else {
        logger.warn(
          "Could not find org for task, skipping branch creation",
          { taskId: task.id },
        );
        featureBranch = undefined;
      }
    } catch (error) {
      logger.warn("Error creating feature branch", {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
      await logTaskEvent(
        task.id,
        "info",
        `⚠️ Error creating feature branch - PRs will target main`,
      );
      featureBranch = undefined;
    }

    // Store the feature branch in planJson for later use (final PR creation)
    planJson.featureBranch = featureBranch;
    task.planJson = planJson as unknown as Record<string, unknown>;
    task.githubBranch = featureBranch || null;
  } else if (featureBranch) {
    await logTaskEvent(
      task.id,
      "info",
      `📌 Using feature branch from approval: ${featureBranch}`,
    );
  }

  // Convert parent ticket to Epic before creating child Stories
  let useEpicWorkflow = false;
  if (task.jiraIssueKey) {
    const converted = await convertToEpic(
      task.orgId,
      task.jiraIssueKey,
    );
    if (converted) {
      useEpicWorkflow = true;
      await logTaskEvent(
        task.id,
        "info",
        `📌 Converted ${task.jiraIssueKey} to Epic for story tracking`,
      );
      logger.info("Converted PRD to Epic", {
        taskId: task.id,
        jiraKey: task.jiraIssueKey,
      });
    } else {
      logger.warn("Could not convert to Epic, will use sub-tasks", {
        taskId: task.id,
        jiraKey: task.jiraIssueKey,
      });
    }
  }

  // Idempotency check: if child tasks already exist, don't create duplicates
  // This handles the case where dispatch partially succeeded then failed
  const existingChildren = await taskRepo.find({
    where: { parentTaskId: task.id },
  });

  if (existingChildren.length > 0) {
    logger.warn(
      "Child tasks already exist for parent - skipping dispatch to prevent duplicates",
      {
        taskId: task.id,
        existingChildCount: existingChildren.length,
        expectedStoryCount: planJson.stories.length,
      },
    );

    // Update parent to dispatching state if not already — atomic update
    if (task.status !== "dispatching") {
      await taskRepo
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          status: "dispatching",
          childTaskIds: existingChildren.map((c) => c.id),
        } as Record<string, unknown>)
        .where("id = :id", { id: task.id })
        .execute();
    }

    return true; // Already dispatched
  }

  // ==========================================================================
  // POST PRD CONSTRAINTS TO COORDINATION FEED (BEFORE spawning any workers)
  // ==========================================================================
  // This ensures all workers see the tech stack constraints in their startup
  // context. Per Gemini 3 Pro's recommendation: this MUST be synchronous and
  // complete BEFORE any workers are spawned to avoid race conditions.
  //
  // When the planning agent provides techStack, it becomes the authoritative
  // source for technology decisions (language, framework, styling, etc.)
  await postPrdConstraints(
    task,
    executionPlan.techStack as TechStack | undefined,
  );

  // Create child tasks for each story
  // Use executionPlan.stories which has validated file-based dependencies
  const childTasks: WorkerTask[] = [];
  const childTaskIds: string[] = [];

  for (let i = 0; i < executionPlan.stories!.length; i++) {
    const story = executionPlan.stories![i];

    // Build a comprehensive description from story details
    // The planning agent provides: title, scope, acceptanceCriteria, dependencies
    const descriptionParts: string[] = [];

    // Include scope (what this story covers)
    if (story.scope) {
      descriptionParts.push(`## Scope\n${story.scope}`);
    }

    // Include acceptance criteria
    if (
      story.acceptanceCriteria &&
      story.acceptanceCriteria.length > 0
    ) {
      descriptionParts.push(
        `## Acceptance Criteria\n${story.acceptanceCriteria.map((ac: string) => `- ${ac}`).join("\n")}`,
      );
    }

    // Include estimated complexity
    if (story.estimatedComplexity) {
      descriptionParts.push(
        `## Complexity: ${story.estimatedComplexity}`,
      );
    }

    // Include dependency context if any
    if (story.dependencies && story.dependencies.length > 0) {
      const depTitles = story.dependencies
        .map((depId: string | number) => {
          const depStory = executionPlan.stories!.find(
            (s: { id?: string; index?: number }) =>
              s.id === depId || s.index === depId,
          );
          return depStory
            ? `Story ${depStory.index + 1}: ${depStory.title}`
            : null;
        })
        .filter(Boolean);
      if (depTitles.length > 0) {
        descriptionParts.push(
          `## Dependencies (completed before this story)\n${depTitles.map((t: string | null) => `- ${t}`).join("\n")}`,
        );
      }
    }

    // Reference to parent PRD for full context
    descriptionParts.push(
      `## Parent PRD\nSee ${task.jiraIssueKey} for full PRD context.`,
    );

    const fullDescription =
      descriptionParts.length > 0
        ? descriptionParts.join("\n\n")
        : story.title;

    // Create real Jira Story (linked to Epic) or Sub-task for this story
    let jiraStoryKey = `${task.jiraIssueKey}-S${i + 1}`; // Fallback synthetic key
    let jiraStoryId: string | null = null;

    if (task.jiraIssueKey) {
      // Try creating a Story linked to Epic first, fallback to sub-task
      if (useEpicWorkflow) {
        const story_result = await createJiraStory(
          task.orgId,
          task.jiraIssueKey,
          `S${i + 1}: ${story.title}`,
          fullDescription,
        );
        if (story_result) {
          jiraStoryKey = story_result.key;
          jiraStoryId = story_result.id;
          logger.info("Created Jira Story linked to Epic", {
            parentTaskId: task.id,
            storyIndex: i + 1,
            storyKey: story_result.key,
            epicKey: task.jiraIssueKey,
          });
        }
      }

      // Fallback to sub-task if Story creation failed or Epic workflow not available
      if (!jiraStoryId) {
        const subtask = await createJiraSubtask(
          task.orgId,
          task.jiraIssueKey,
          `S${i + 1}: ${story.title}`,
          fullDescription,
        );
        if (subtask) {
          jiraStoryKey = subtask.key;
          jiraStoryId = subtask.id;
          logger.info("Created Jira sub-task for story", {
            parentTaskId: task.id,
            storyIndex: i + 1,
            subtaskKey: subtask.key,
          });
        } else {
          logger.warn(
            "Failed to create Jira issue, using synthetic key",
            {
              parentTaskId: task.id,
              storyIndex: i + 1,
              syntheticKey: jiraStoryKey,
            },
          );
        }
      }
    }

    // Create child task
    const childTask = new WorkerTask();
    childTask.orgId = task.orgId;
    childTask.jiraIssueKey = jiraStoryKey;
    childTask.summary = story.title;
    childTask.description = fullDescription;
    childTask.workerPersona = story.persona as WorkerPersona;
    childTask.workerModel = task.workerModel;
    childTask.workerProvider = task.workerProvider;

    // Stories with dependencies start as BLOCKED and are unblocked when dependencies complete
    // Stories without dependencies start as QUEUED and can run immediately
    const hasDependencies =
      story.dependencies && story.dependencies.length > 0;
    childTask.status = hasDependencies ? "blocked" : "queued";

    childTask.parentTaskId = task.id;
    childTask.githubRepo = task.githubRepo; // Inherit repo from parent
    childTask.jiraIssueId = jiraStoryId || task.jiraIssueId; // Use story ID if created
    childTask.jiraFields = {
      ...(task.jiraFields || {}),
      storyIndex: i + 1,
      storyDependencies: story.dependencies
        ?.map((depId: string | number) => {
          // Dependencies come as 0-based indices from the planning agent
          // Convert to 1-based storyIndex (storyIndex starts at 1)
          if (typeof depId === "number") {
            return depId + 1; // 0 -> 1, 1 -> 2, etc.
          }
          // Fallback: try to find by ID if it's a string
          const depIndex = executionPlan.stories!.findIndex(
            (s: { id?: string }) => s.id === depId,
          );
          return depIndex >= 0 ? depIndex + 1 : null;
        })
        .filter(
          (x: number | null): x is number =>
            x !== null && x !== undefined,
        ),
      parentJiraKey: task.jiraIssueKey,
      // Feature branch workflow: child tasks PR to the feature branch, not main
      targetBranch: planJson.featureBranch || null,
      // Story-specific branch: each worker gets its own branch within feature workflow
      // Use dash (not slash) to avoid Git ref conflict: feature/OCS-495 + feature/OCS-495/story-1 is invalid
      // Git refs don't allow both a branch and a "subdirectory" branch with the same prefix
      storyBranch: `${planJson.featureBranch}-story-${i + 1}`,
      executionMode: planJson.executionMode || "autonomous",
      // Story decomposition details (passed to child task for reference)
      storyPoints: story.storyPoints,
      acceptanceCriteria: story.acceptanceCriteria,
      // File targeting from planning agent (Cost-first: max 3 files for Haiku)
      targetFiles: story.targetFiles || [],
      referenceFiles: story.referenceFiles || [],
    };

    // Save child task
    const savedChild = await taskRepo.save(childTask);
    childTasks.push(savedChild);
    childTaskIds.push(savedChild.id);

    const statusNote = hasDependencies
      ? `(blocked - depends on S${story.dependencies?.map((d: string | number) => (typeof d === "number" ? d + 1 : d)).join(", S")})`
      : "(queued)";
    await logTaskEvent(
      task.id,
      "info",
      `Created story ${i + 1}: ${story.title} (${story.persona}) ${statusNote}`,
    );

    logger.info("Created child task for story", {
      parentTaskId: task.id,
      childTaskId: savedChild.id,
      storyIndex: i + 1,
      persona: story.persona,
      summary: story.title,
      status: savedChild.status,
      dependencies: story.dependencies,
    });
  }

  // Update parent task with child task references — atomic update
  await taskRepo
    .createQueryBuilder()
    .update(WorkerTask)
    .set({
      status: "dispatching",
      childTaskIds: childTaskIds,
      planJson: task.planJson,
      githubBranch: task.githubBranch,
    } as Record<string, unknown>)
    .where("id = :id", { id: task.id })
    .execute();

  await logTaskEvent(
    task.id,
    "status_change",
    `All ${childTaskIds.length} stories queued for execution`,
  );

  logger.info("Multi-story plan dispatched", {
    taskId: task.id,
    jiraIssueKey: task.jiraIssueKey,
    childCount: childTaskIds.length,
    childTaskIds,
  });

  return true;
}

/**
 * PHASE 3: Orchestrator-managed PR merging
 *
 * Merge all story PRs in dependency order (by storyIndex) into the feature branch.
 * Called when all child tasks have completed (status = completed/deployed/review_requested).
 *
 * This separates concerns:
 * - Workers: Create PRs to feature branch
 * - Orchestrator: Merge PRs in order (Phase 3)
 * - Orchestrator: Create final PR to main (after all merges)
 */
export async function mergeStoryPRsInOrder(
  parentTask: WorkerTask,
): Promise<void> {
  const taskRepo = getTaskRepo();
  const orgRepo = getOrgRepo();

  // Get org for SCM provider
  const org = await orgRepo.findOne({ where: { id: parentTask.orgId } });
  if (!org) {
    logger.error("Organization not found for task", {
      taskId: parentTask.id,
      orgId: parentTask.orgId,
    });
    throw new Error(`Organization not found: ${parentTask.orgId}`);
  }

  // Get SCM provider for this org (GitHub, GitLab, or BitBucket)
  const scmProvider = getScmProvider(org);

  // Get all child tasks with PRs
  const children = await taskRepo.find({
    where: { parentTaskId: parentTask.id },
    order: { createdAt: "ASC" },
  });

  // Sort by story index (dependency order)
  const sortedChildren = children
    .filter((c) => c.githubPrNumber && c.githubRepo)
    .sort((a, b) => {
      const aIndex = (a.jiraFields as any)?.storyIndex || 0;
      const bIndex = (b.jiraFields as any)?.storyIndex || 0;
      return aIndex - bIndex;
    });

  if (sortedChildren.length === 0) {
    logger.debug("No child PRs to merge", {
      parentTaskId: parentTask.id,
    });
    return;
  }

  await logTaskEvent(
    parentTask.id,
    "info",
    `🔄 Phase 3: Merging ${sortedChildren.length} story PRs in dependency order via ${scmProvider.displayName}...`,
  );

  let successCount = 0;
  let conflictCount = 0;

  for (const child of sortedChildren) {
    try {
      const storyIndex =
        (child.jiraFields as any)?.storyIndex || "?";
      const repoId = scmProvider.parseRepoIdentifier(
        child.githubRepo!,
      );

      await logTaskEvent(
        parentTask.id,
        "info",
        `Merging Story ${storyIndex}: PR #${child.githubPrNumber}`,
      );

      // First attempt to merge
      let merged = await scmProvider.mergePullRequest(
        repoId,
        child.githubPrNumber!,
        {
          mergeMethod: "squash",
          commitTitle: `${child.jiraIssueKey}: ${child.summary}`,
        },
      );

      // If merge failed, try to auto-resolve by updating the PR branch
      if (!merged) {
        await logTaskEvent(
          parentTask.id,
          "info",
          `🔄 PR #${child.githubPrNumber} may need update - attempting to sync with base branch...`,
        );

        // Check PR status and try to update branch
        const prStatus = await scmProvider.getPullRequestStatus(
          repoId,
          child.githubPrNumber!,
        );

        if (prStatus?.merged) {
          // PR was already merged (maybe by a previous run)
          await logTaskEvent(
            parentTask.id,
            "info",
            `✅ PR #${child.githubPrNumber} was already merged`,
          );
          successCount++;
          continue;
        }

        if (prStatus?.mergeable === false) {
          // Try to update the branch with base
          const updateResult =
            await scmProvider.updatePullRequestBranch(
              repoId,
              child.githubPrNumber!,
            );

          if (updateResult.success) {
            await logTaskEvent(
              parentTask.id,
              "info",
              `✅ Updated PR #${child.githubPrNumber} branch - retrying merge...`,
            );

            // Wait for SCM to process the update
            await new Promise((resolve) =>
              setTimeout(resolve, 3000),
            );

            // Retry the merge
            merged = await scmProvider.mergePullRequest(
              repoId,
              child.githubPrNumber!,
              {
                mergeMethod: "squash",
                commitTitle: `${child.jiraIssueKey}: ${child.summary}`,
              },
            );
          } else {
            // Check what files are conflicting
            const conflicts =
              await scmProvider.getPullRequestConflicts(
                repoId,
                child.githubPrNumber!,
              );

            if (conflicts.hasConflicts) {
              await logTaskEvent(
                parentTask.id,
                "info",
                `⚠️ PR #${child.githubPrNumber} has unresolvable conflicts in ${conflicts.conflictingFiles.length} file(s): ${conflicts.conflictingFiles.slice(0, 3).join(", ")}${conflicts.conflictingFiles.length > 3 ? "..." : ""}`,
                { severity: "warning" },
              );
              conflictCount++;
            }
          }
        }
      }

      if (merged) {
        await logTaskEvent(
          parentTask.id,
          "info",
          `✅ Merged PR #${child.githubPrNumber} (Story ${storyIndex})`,
        );
        logger.info("Merged child story PR", {
          parentTaskId: parentTask.id,
          childTaskId: child.id,
          prNumber: child.githubPrNumber,
          storyIndex,
        });
        successCount++;
      } else {
        await logTaskEvent(
          parentTask.id,
          "info",
          `⚠️ PR #${child.githubPrNumber} could not be auto-merged - manual resolution may be required`,
          { severity: "warning" },
        );
        logger.warn(
          "PR merge failed after auto-resolution attempt",
          {
            parentTaskId: parentTask.id,
            childTaskId: child.id,
            prNumber: child.githubPrNumber,
          },
        );
        conflictCount++;
      }

      // Small delay between merges to let GitHub process
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      logger.error("Failed to merge child PR", {
        parentTaskId: parentTask.id,
        childTaskId: child.id,
        prNumber: child.githubPrNumber,
        error: error instanceof Error ? error.message : String(error),
      });
      await logTaskEvent(
        parentTask.id,
        "error",
        `❌ Failed to merge PR #${child.githubPrNumber}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      conflictCount++;
    }
  }

  const summaryMessage =
    conflictCount > 0
      ? `✅ Phase 3 complete: ${successCount}/${sortedChildren.length} PRs merged (${conflictCount} need manual resolution)`
      : `✅ Phase 3 complete: All ${sortedChildren.length} story PRs merged successfully`;

  await logTaskEvent(parentTask.id, "info", summaryMessage);

  logger.info("Completed Phase 3 PR merging", {
    parentTaskId: parentTask.id,
    jiraIssueKey: parentTask.jiraIssueKey,
    totalPRs: sortedChildren.length,
    merged: successCount,
    conflicts: conflictCount,
  });
}
