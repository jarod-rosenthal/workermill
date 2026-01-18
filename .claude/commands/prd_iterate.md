---
allowed-tools: Read, Grep, Glob, Task
description: Analyze PRD workflow for broken logic and blockers
---

# PRD Workflow Analysis

Perform a thorough end-to-end analysis of the PRD (Product Requirements Document) workflow in this codebase. WorkerMill is an orchestration platform that spawns AI workers to execute coding tasks from Jira tickets.

## What is the PRD Workflow?

When a Jira ticket has a `prd`, `epic`, `multi-story`, or `orchestration` label, it triggers a special workflow:

1. **Planning Phase**: A planning agent analyzes the PRD and creates an execution plan (single-story or multi-story)
2. **Approval Phase**: User reviews and approves the plan in the dashboard
3. **Dispatch Phase**: For multi-story plans, child tasks are created for each story
4. **Execution Phase**: Workers execute stories (with dependency ordering)
5. **Completion Phase**: When all stories finish, a summary is posted and final PR created

## Key Files to Analyze

Read these files carefully and trace the data flow:

1. **Entry Point**: `api/src/routes/webhooks.ts` - Look for Jira webhook handler, how PRD labels are detected, initial task creation
2. **Planning Agent**: `api/src/services/planning-agent.ts` - How plans are generated, complexity scoring, plan structure
3. **Orchestrator**: `api/src/services/orchestrator.ts` - This is large, focus on:
   - `findPlanningTasks()` and `processPlanningTask()`
   - `dispatchMultiStoryPlan()` - child task creation
   - `checkAndUnblockDependentTasks()` - dependency resolution
   - `checkParentTaskCompletion()` - workflow completion
   - The main `pollLoop()` function
4. **Plan Approval**: `api/src/routes/tasks.ts` - Look for `/plan/approve` and `/plan/request-changes` endpoints
5. **Models**: `api/src/models/WorkerTask.ts` and `api/src/models/WorkerContext.ts` - task states and fields
6. **GitHub Utils**: `api/src/utils/github.ts` - `createBranch()` function
7. **Coordination**: `api/src/routes/coordination.ts` - sibling communication

## Analysis Requirements

Trace the workflow step-by-step and identify:

### 1. State Transitions
Map out all the task status transitions:
- What status does a PRD task start with?
- What triggers each transition?
- Are there any dead-end states?

### 2. Branch/PR Logic
- When and where are feature branches created?
- How do child stories know which branch to target?
- How is the final PR created?

### 3. Dependency Management
- How are story dependencies stored and tracked?
- What triggers unblocking of dependent tasks?
- What happens if a dependency fails?

### 4. Data Consistency
- Are there race conditions?
- Is task creation idempotent?
- Could duplicate tasks be created?

### 5. Error Handling
- What happens if Epic conversion fails?
- What happens if branch creation fails?
- What happens if Jira API calls fail?

### 6. Persona/Model Assignment
- How is the worker persona determined for each story?
- Is the correct persona used for single-story plans?

## Output Format

Provide your analysis as:

1. **Workflow Diagram** (text-based) showing the state machine
2. **Issue Table** with columns: Issue, Severity (HIGH/MEDIUM/LOW), Location (file:line), Impact, Root Cause
3. **Detailed Findings** for each issue with code snippets showing the problematic logic
4. **Recommendations** for fixes (but do not implement them)

## Known Issues from Previous Analysis (Verify if Fixed)

These issues were previously identified - check if they still exist:

1. Feature branch created twice with different naming (`feature/` vs `prd/`)
2. Blocked tasks never unblock if dependency fails
3. Single-story PRD uses `project_manager` persona instead of plan's `primaryPersona`
4. No idempotency check in child task creation
5. Dependency unblocking requires PR to be merged (not just task complete)
6. Final PR not created when feature branch creation failed
7. Story index conversion between 0-based and 1-based

## Instructions

Be thorough. Read the actual code. Do not assume - verify each step of the workflow by examining the implementation. Use Grep to search for specific functions and Read to examine the code in detail. For the large orchestrator file, use Grep with context flags to find relevant sections.

Start by reading the key files, then trace the workflow from webhook entry to completion.
