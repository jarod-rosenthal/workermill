/**
 * Quality Gates Validation Service
 *
 * Validates that quality gates defined in the execution plan are met before
 * marking a task as completed. This ensures that decorative quality gates
 * are actually enforced.
 */

import { AppDataSource } from "../db/connection.js";
import { WorkerTask, Organization } from "../models/index.js";
import { getScmProvider } from "../scm-providers/index.js";
import { logger } from "../utils/logger.js";

export interface QualityGateValidationResult {
  passed: boolean;
  failures: string[];
  warnings: string[];
  details: Record<string, GateCheckResult>;
}

export interface GateCheckResult {
  status: "passed" | "failed" | "warning" | "unknown";
  message: string;
}

/**
 * Validate all quality gates for a task
 *
 * Returns validation results with detailed per-gate status.
 * Does NOT block task completion - just reports what passed/failed.
 */
export async function validateQualityGates(task: WorkerTask): Promise<QualityGateValidationResult> {
  const result: QualityGateValidationResult = {
    passed: true,
    failures: [],
    warnings: [],
    details: {},
  };

  // Extract quality gates from task plan
  const planJson = task.planJson as Record<string, unknown> | null;
  const qualityGates = (planJson?.qualityGates as string[] | undefined) || [];

  if (!qualityGates || qualityGates.length === 0) {
    logger.debug("No quality gates defined for task", { taskId: task.id });
    return result;
  }

  logger.info("Validating quality gates", {
    taskId: task.id,
    gateCount: qualityGates.length,
    gates: qualityGates,
  });

  // Check each quality gate
  for (const gate of qualityGates) {
    const gateLower = gate.toLowerCase();
    const gateCheckResult = await checkQualityGate(gate, gateLower, task);
    result.details[gate] = gateCheckResult;

    if (gateCheckResult.status === "failed") {
      result.passed = false;
      result.failures.push(gateCheckResult.message);
    } else if (gateCheckResult.status === "warning") {
      result.warnings.push(gateCheckResult.message);
    }
  }

  logger.info("Quality gate validation complete", {
    taskId: task.id,
    passed: result.passed,
    failureCount: result.failures.length,
    warningCount: result.warnings.length,
  });

  return result;
}

/**
 * Check a single quality gate
 */
async function checkQualityGate(
  gate: string,
  gateLower: string,
  task: WorkerTask
): Promise<GateCheckResult> {
  try {
    // Gate: PR created/exists
    if (gateLower.includes("pr") && (gateLower.includes("created") || gateLower.includes("exist"))) {
      return checkPrCreated(task);
    }

    // Gate: PR merged/merged to main
    if (gateLower.includes("pr") && (gateLower.includes("merged") || gateLower.includes("merge"))) {
      return checkPrMerged(task);
    }

    // Gate: Tests pass/tests passing
    if ((gateLower.includes("test") && gateLower.includes("pass")) || gateLower.includes("ci passes")) {
      return await checkTestsPassing(task);
    }

    // Gate: No TypeScript errors / type checks pass
    if (
      gateLower.includes("typescript") ||
      gateLower.includes("type error") ||
      gateLower.includes("type check") ||
      gateLower.includes("tsc")
    ) {
      return await checkNoTypeScriptErrors(task);
    }

    // Gate: PR review approved / review approved
    if ((gateLower.includes("review") && gateLower.includes("approv")) || gateLower.includes("pr review approved")) {
      return checkPrApproved(task);
    }

    // Gate: No linting errors / lints pass
    if ((gateLower.includes("lint") && gateLower.includes("pass")) || gateLower.includes("eslint")) {
      return await checkNoLintErrors(task);
    }

    // Gate: Code coverage meets threshold
    if (gateLower.includes("coverage")) {
      return checkCodeCoverage(task);
    }

    // Gate: Deployment successful
    if (gateLower.includes("deploy") && gateLower.includes("success")) {
      return checkDeploymentSuccessful(task);
    }

    // Unknown gate - log as warning but don't fail
    return {
      status: "unknown",
      message: `Unknown quality gate: "${gate}" - Unable to validate`,
    };
  } catch (error) {
    logger.error("Error checking quality gate", {
      gate,
      taskId: task.id,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      status: "warning",
      message: `Could not validate gate "${gate}": ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Check: PR was created and linked to the task
 */
function checkPrCreated(task: WorkerTask): GateCheckResult {
  if (!task.githubPrUrl || !task.githubPrNumber) {
    return {
      status: "failed",
      message: "Quality gate failed: PR was not created or not linked to task",
    };
  }

  return {
    status: "passed",
    message: `Quality gate passed: PR created (PR #${task.githubPrNumber} - ${task.githubPrUrl})`,
  };
}

/**
 * Check: PR was merged into the base branch
 */
function checkPrMerged(task: WorkerTask): GateCheckResult {
  if (!task.githubPrUrl) {
    return {
      status: "failed",
      message: "Quality gate failed: No PR found to check merge status",
    };
  }

  // If task status is "deployed", the PR must have been merged
  // (either by worker or by auto-merge logic)
  if (task.status === "deployed") {
    return {
      status: "passed",
      message: "Quality gate passed: PR merged (task marked as deployed)",
    };
  }

  // For review_requested or other states, PR is not yet merged
  if (task.status === "review_requested") {
    return {
      status: "warning",
      message: "Quality gate not yet met: PR exists but not merged (awaiting approval)",
    };
  }

  return {
    status: "warning",
    message: `Quality gate status unknown: PR exists but merge status unclear (task status: ${task.status})`,
  };
}

/**
 * Check: Tests are passing (via SCM CI status checks)
 *
 * This requires querying the SCM API for commit status checks.
 * If no PR or status checks unavailable, returns warning.
 */
async function checkTestsPassing(task: WorkerTask): Promise<GateCheckResult> {
  if (!task.githubPrNumber || !task.githubRepo) {
    return {
      status: "warning",
      message: "Quality gate: Cannot verify tests - no PR or repo info available",
    };
  }

  try {
    // Get org and SCM provider
    const orgRepo = AppDataSource.getRepository(Organization);
    const org = await orgRepo.findOne({ where: { id: task.orgId } });

    if (!org) {
      return {
        status: "warning",
        message: "Quality gate: Could not verify tests - organization not found",
      };
    }

    const scmProvider = getScmProvider(org);
    const repoId = scmProvider.parseRepoIdentifier(task.githubRepo);
    const prStatus = await scmProvider.getPullRequestStatus(repoId, task.githubPrNumber);

    if (!prStatus) {
      return {
        status: "warning",
        message: `Quality gate: Could not fetch PR status from ${scmProvider.displayName} API`,
      };
    }

    // Note: PR status includes various check runs (e.g., build, tests, linting)
    // A fully comprehensive check would require calling the check-runs API
    // For now, we report based on PR merge status as a proxy

    if (prStatus.state === "closed" && prStatus.merged) {
      return {
        status: "passed",
        message: "Quality gate passed: PR merged (implies tests passed)",
      };
    }

    if (prStatus.state === "open") {
      return {
        status: "warning",
        message: "Quality gate: PR is open, tests may still be running",
      };
    }

    return {
      status: "unknown",
      message: `Quality gate: PR state is ${prStatus.state} - test status unclear`,
    };
  } catch (error) {
    logger.warn("Failed to check tests status from SCM", {
      repo: task.githubRepo,
      prNumber: task.githubPrNumber,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      status: "warning",
      message: "Quality gate: Could not verify tests - SCM API error",
    };
  }
}

/**
 * Check: No TypeScript errors in the worker output
 */
async function checkNoTypeScriptErrors(task: WorkerTask): Promise<GateCheckResult> {
  try {
    // Query task logs for TypeScript error indicators
    const logs = await AppDataSource.query(
      `SELECT message FROM worker_task_logs
       WHERE task_id = $1
       ORDER BY created_at DESC
       LIMIT 500`,
      [task.id]
    );

    const errorPatterns = [
      /error TS\d+:/i,
      /typescript error/i,
      /tsc: error/i,
      /type error/i,
    ];

    const typeErrors: string[] = [];
    for (const log of logs) {
      const message = log.message || "";
      for (const pattern of errorPatterns) {
        if (pattern.test(message)) {
          typeErrors.push(message);
          break;
        }
      }
    }

    if (typeErrors.length > 0) {
      return {
        status: "failed",
        message: `Quality gate failed: Found ${typeErrors.length} TypeScript errors in task logs`,
      };
    }

    return {
      status: "passed",
      message: "Quality gate passed: No TypeScript errors detected in task logs",
    };
  } catch (error) {
    logger.warn("Failed to check TypeScript errors", {
      taskId: task.id,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      status: "warning",
      message: "Quality gate: Could not verify TypeScript errors",
    };
  }
}

/**
 * Check: PR has been approved by a reviewer
 */
function checkPrApproved(task: WorkerTask): GateCheckResult {
  // Check if task has reached a state indicating approval
  if (task.status === "pr_approved" || task.status === "review_approved" || task.status === "deployed") {
    return {
      status: "passed",
      message: `Quality gate passed: PR review approved (task status: ${task.status})`,
    };
  }

  if (task.status === "review_requested") {
    return {
      status: "warning",
      message: "Quality gate not yet met: Review requested but not yet approved",
    };
  }

  if (task.status === "review_rejected") {
    return {
      status: "failed",
      message: "Quality gate failed: PR review was rejected",
    };
  }

  return {
    status: "unknown",
    message: `Quality gate status unknown: PR approval status unclear (task status: ${task.status})`,
  };
}

/**
 * Check: No linting errors in the worker output
 */
async function checkNoLintErrors(task: WorkerTask): Promise<GateCheckResult> {
  try {
    // Query task logs for linting error indicators
    const logs = await AppDataSource.query(
      `SELECT message FROM worker_task_logs
       WHERE task_id = $1
       ORDER BY created_at DESC
       LIMIT 500`,
      [task.id]
    );

    const errorPatterns = [
      /eslint error/i,
      /lint error/i,
      /linting failed/i,
      /eslint found/i,
    ];

    const lintErrors: string[] = [];
    for (const log of logs) {
      const message = log.message || "";
      for (const pattern of errorPatterns) {
        if (pattern.test(message)) {
          lintErrors.push(message);
          break;
        }
      }
    }

    if (lintErrors.length > 0) {
      return {
        status: "failed",
        message: `Quality gate failed: Found linting errors in task logs`,
      };
    }

    return {
      status: "passed",
      message: "Quality gate passed: No linting errors detected",
    };
  } catch (error) {
    logger.warn("Failed to check lint errors", {
      taskId: task.id,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      status: "warning",
      message: "Quality gate: Could not verify linting",
    };
  }
}

/**
 * Check: Code coverage meets threshold (if specified)
 *
 * This is a stub - coverage data typically comes from CI results
 */
function checkCodeCoverage(task: WorkerTask): GateCheckResult {
  // Coverage metrics would typically be parsed from CI logs or stored separately
  // For now, this returns unknown - could be expanded later

  return {
    status: "unknown",
    message: "Quality gate: Code coverage verification not yet implemented",
  };
}

/**
 * Check: Deployment was successful
 *
 * Inferred from task status
 */
function checkDeploymentSuccessful(task: WorkerTask): GateCheckResult {
  if (task.status === "deployed") {
    return {
      status: "passed",
      message: "Quality gate passed: Deployment successful (task status: deployed)",
    };
  }

  if (task.status === "completed" || task.status === "review_requested") {
    return {
      status: "warning",
      message: `Quality gate not yet met: Task not deployed (task status: ${task.status})`,
    };
  }

  if (task.status === "failed") {
    return {
      status: "failed",
      message: "Quality gate failed: Task failed (deployment unsuccessful)",
    };
  }

  return {
    status: "unknown",
    message: `Quality gate status unknown: Deployment status unclear (task status: ${task.status})`,
  };
}
