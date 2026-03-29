/**
 * Quality Metrics Backfill Routes
 *
 * Admin endpoints for backfilling quality metrics on existing tasks
 * and triggering quality scans on repositories.
 */

import { Router, Request, Response } from "express";
import { authenticateUser } from "../middleware/auth.js";
import { requireCurrentTos } from "../middleware/tos.js";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask } from "../models/WorkerTask.js";
import { logger } from "../utils/logger.js";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const router = Router();

router.use(authenticateUser);
router.use(requireCurrentTos);

interface QualityMetrics {
  qualityScore: number;
  lintScore: number;
  lintErrors: number;
  lintWarnings: number;
  typecheckScore: number;
  typeErrors: number;
  testScore: number;
  testsPassed: number;
  testsFailed: number;
  testsSkipped: number;
  securityScore: number;
  securityHigh: number;
  securityMedium: number;
  securityLow: number;
}

function exec(cmd: string, args: string[], cwd?: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 300000,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      exitCode: err.status || 1,
    };
  }
}

function analyzeRepo(repoPath: string): QualityMetrics {
  const metrics: QualityMetrics = {
    qualityScore: 0,
    lintScore: 100,
    lintErrors: 0,
    lintWarnings: 0,
    typecheckScore: 100,
    typeErrors: 0,
    testScore: 100,
    testsPassed: 0,
    testsFailed: 0,
    testsSkipped: 0,
    securityScore: 100,
    securityHigh: 0,
    securityMedium: 0,
    securityLow: 0,
  };

  // Find all package directories (backend, frontend, etc.)
  const packageDirs: string[] = [];
  const rootPackageJson = path.join(repoPath, "package.json");

  if (fs.existsSync(rootPackageJson)) {
    packageDirs.push(repoPath);
  }

  // Check common subdirectories
  for (const subdir of ["backend", "frontend", "api", "web", "server", "client"]) {
    const subdirPath = path.join(repoPath, subdir);
    if (fs.existsSync(path.join(subdirPath, "package.json"))) {
      packageDirs.push(subdirPath);
    }
  }

  let totalLintErrors = 0;
  let totalLintWarnings = 0;
  let totalTypeErrors = 0;
  let typecheckPassed = true;
  let totalTestsPassed = 0;
  let totalTestsFailed = 0;
  let totalTestsSkipped = 0;
  let totalSecurityHigh = 0;
  let totalSecurityMedium = 0;
  let totalSecurityLow = 0;

  for (const pkgDir of packageDirs) {
    // Install dependencies
    exec("npm", ["install", "--legacy-peer-deps"], pkgDir);

    // TypeCheck
    const tsResult = exec("npx", ["tsc", "--noEmit"], pkgDir);
    const tsErrors = (tsResult.stdout.match(/error TS\d+/g) || []).length;
    totalTypeErrors += tsErrors;
    if (tsResult.exitCode !== 0) typecheckPassed = false;

    // Lint (try eslint)
    const lintResult = exec("npx", ["eslint", ".", "--format", "json"], pkgDir);
    try {
      const lintOutput = JSON.parse(lintResult.stdout || "[]");
      for (const file of lintOutput) {
        totalLintErrors += file.errorCount || 0;
        totalLintWarnings += file.warningCount || 0;
      }
    } catch {
      // Try parsing summary from text output
      const errMatch = lintResult.stderr.match(/(\d+)\s+error/);
      const warnMatch = lintResult.stderr.match(/(\d+)\s+warning/);
      if (errMatch) totalLintErrors += parseInt(errMatch[1]);
      if (warnMatch) totalLintWarnings += parseInt(warnMatch[1]);
    }

    // Tests
    const testResult = exec("npm", ["test", "--if-present"], pkgDir);
    const passMatch = testResult.stdout.match(/(\d+)\s+pass/i);
    const failMatch = testResult.stdout.match(/(\d+)\s+fail/i);
    const skipMatch = testResult.stdout.match(/(\d+)\s+skip/i);
    if (passMatch) totalTestsPassed += parseInt(passMatch[1]);
    if (failMatch) totalTestsFailed += parseInt(failMatch[1]);
    if (skipMatch) totalTestsSkipped += parseInt(skipMatch[1]);

    // Security audit
    const auditResult = exec("npm", ["audit", "--json"], pkgDir);
    try {
      const audit = JSON.parse(auditResult.stdout || "{}");
      const vulns = audit.metadata?.vulnerabilities || {};
      totalSecurityHigh += (vulns.high || 0) + (vulns.critical || 0);
      totalSecurityMedium += vulns.moderate || 0;
      totalSecurityLow += (vulns.low || 0) + (vulns.info || 0);
    } catch {
      // Ignore parse errors
    }
  }

  // Calculate scores
  metrics.lintErrors = totalLintErrors;
  metrics.lintWarnings = totalLintWarnings;
  metrics.lintScore = Math.max(0, 100 - totalLintErrors);

  metrics.typeErrors = totalTypeErrors;
  metrics.typecheckScore = typecheckPassed ? 100 : 0;

  metrics.testsPassed = totalTestsPassed;
  metrics.testsFailed = totalTestsFailed;
  metrics.testsSkipped = totalTestsSkipped;
  const totalTests = totalTestsPassed + totalTestsFailed + totalTestsSkipped;
  metrics.testScore = totalTests > 0 ? Math.round((totalTestsPassed / totalTests) * 100) : 100;

  metrics.securityHigh = totalSecurityHigh;
  metrics.securityMedium = totalSecurityMedium;
  metrics.securityLow = totalSecurityLow;
  metrics.securityScore = Math.max(0, 100 - (totalSecurityHigh * 20 + totalSecurityMedium * 5 + totalSecurityLow));

  // Composite score (weights: typecheck 25%, lint 20%, tests 30%, security 10%, coverage 15% - skip coverage for now)
  metrics.qualityScore = Math.round(
    metrics.typecheckScore * 0.30 +
    metrics.lintScore * 0.25 +
    metrics.testScore * 0.35 +
    metrics.securityScore * 0.10
  );

  return metrics;
}

/**
 * POST /api/quality/backfill
 * Backfill quality metrics for recent tasks by scanning their PR branches
 */
router.post("/backfill", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const { limit = 10, dryRun = false } = req.body;

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Find recent completed tasks with PR URLs that don't have quality metrics
    const tasks = await taskRepo
      .createQueryBuilder("task")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.status IN (:...statuses)", { statuses: ["completed", "deployed"] })
      .andWhere("task.githubPrUrl IS NOT NULL")
      .andWhere("task.qualityScore IS NULL")
      .orderBy("task.completedAt", "DESC")
      .limit(limit)
      .getMany();

    logger.info(`Found ${tasks.length} tasks to backfill quality metrics`);

    const results: Array<{ taskId: string; jiraKey: string | null; prUrl: string | null; metrics: QualityMetrics | null; error?: string }> = [];

    for (const task of tasks) {
      try {
        // Extract repo info from PR URL
        // Format: https://github.com/owner/repo/pull/123
        const prMatch = task.githubPrUrl?.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
        if (!prMatch) {
          results.push({ taskId: task.id, jiraKey: task.jiraIssueKey, prUrl: task.githubPrUrl, metrics: null, error: "Invalid PR URL" });
          continue;
        }

        const [, owner, repo, prNumber] = prMatch;

        if (dryRun) {
          results.push({ taskId: task.id, jiraKey: task.jiraIssueKey, prUrl: task.githubPrUrl, metrics: null, error: "Dry run - skipped" });
          continue;
        }

        // Clone repo to temp directory
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "quality-scan-"));
        const repoPath = path.join(tmpDir, repo);

        try {
          // Clone and checkout PR branch
          const safeOwner = owner.replace(/[^a-zA-Z0-9_.-]/g, "");
          const safeRepo = repo.replace(/[^a-zA-Z0-9_.-]/g, "");
          exec("git", ["clone", "--depth", "1", "--", `https://github.com/${safeOwner}/${safeRepo}.git`, repoPath], tmpDir);

          // If task has a branch, checkout that branch
          if (task.githubBranch) {
            const safeBranch = task.githubBranch.replace(/[^a-zA-Z0-9/_.-]/g, "");
            exec("git", ["fetch", "origin", "--", safeBranch], repoPath);
            exec("git", ["checkout", safeBranch], repoPath);
          }

          // Analyze the repo
          const metrics = analyzeRepo(repoPath);

          // Update task with metrics
          task.qualityScore = metrics.qualityScore;
          task.lintScore = metrics.lintScore;
          task.lintErrors = metrics.lintErrors;
          task.lintWarnings = metrics.lintWarnings;
          task.typecheckScore = metrics.typecheckScore;
          task.typeErrors = metrics.typeErrors;
          task.testScore = metrics.testScore;
          task.testsPassed = metrics.testsPassed;
          task.testsFailed = metrics.testsFailed;
          task.testsSkipped = metrics.testsSkipped;
          task.securityScore = metrics.securityScore;
          task.securityHigh = metrics.securityHigh;
          task.securityMedium = metrics.securityMedium;
          task.securityLow = metrics.securityLow;
          task.qualityAnalysisJson = { backfilled: true, analyzedAt: new Date().toISOString(), metrics };

          await taskRepo.save(task);

          results.push({ taskId: task.id, jiraKey: task.jiraIssueKey, prUrl: task.githubPrUrl, metrics });
        } finally {
          // Cleanup
          exec("rm", ["-rf", tmpDir], "/tmp");
        }
      } catch (error) {
        logger.error("Error backfilling task", { taskId: task.id, error });
        results.push({ taskId: task.id, jiraKey: task.jiraIssueKey, prUrl: task.githubPrUrl, metrics: null, error: String(error) });
      }
    }

    res.json({
      success: true,
      tasksProcessed: results.length,
      results,
    });
  } catch (error) {
    logger.error("Error in quality backfill", { error });
    res.status(500).json({ error: "Failed to backfill quality metrics" });
  }
});

/**
 * POST /api/quality/scan-repo
 * Scan a repository and return quality metrics (without storing)
 */
router.post("/scan-repo", async (req: Request, res: Response) => {
  try {
    const { repoUrl, branch } = req.body;

    if (!repoUrl) {
      res.status(400).json({ error: "repoUrl is required" });
      return;
    }

    // Extract repo info
    const repoMatch = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!repoMatch) {
      res.status(400).json({ error: "Invalid GitHub URL" });
      return;
    }

    const [, owner, repo] = repoMatch;
    const repoName = repo.replace(/\.git$/, "");

    // Sanitize inputs to prevent command injection
    const safeOwner = owner.replace(/[^a-zA-Z0-9_.-]/g, "");
    const safeRepo = repoName.replace(/[^a-zA-Z0-9_.-]/g, "");
    const safeBranch = branch ? branch.replace(/[^a-zA-Z0-9/_.-]/g, "") : "";

    // Clone to temp directory
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "quality-scan-"));
    const repoPath = path.join(tmpDir, safeRepo);

    try {
      const cloneArgs = ["clone", "--depth", "1"];
      if (safeBranch) cloneArgs.push("-b", safeBranch);
      cloneArgs.push("--", `https://github.com/${safeOwner}/${safeRepo}.git`, repoPath);
      exec("git", cloneArgs, tmpDir);

      const metrics = analyzeRepo(repoPath);

      res.json({
        success: true,
        repo: `${owner}/${repoName}`,
        branch: branch || "default",
        metrics,
      });
    } finally {
      exec("rm", ["-rf", tmpDir], "/tmp");
    }
  } catch (error) {
    logger.error("Error scanning repo", { error });
    res.status(500).json({ error: "Failed to scan repository" });
  }
});

/**
 * POST /api/quality/backfill-manual
 * Manually set quality metrics for tasks (used when we already have the data)
 */
router.post("/backfill-manual", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const { metrics, taskFilter } = req.body;

    if (!metrics) {
      res.status(400).json({ error: "metrics object is required" });
      return;
    }

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Build query based on filter
    let query = taskRepo
      .createQueryBuilder("task")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.qualityScore IS NULL");

    if (taskFilter?.status) {
      query = query.andWhere("task.status IN (:...statuses)", { statuses: Array.isArray(taskFilter.status) ? taskFilter.status : [taskFilter.status] });
    }
    if (taskFilter?.jiraKeyPattern) {
      query = query.andWhere("task.jiraIssueKey LIKE :pattern", { pattern: taskFilter.jiraKeyPattern });
    }
    if (taskFilter?.repoPattern) {
      query = query.andWhere("task.githubPrUrl LIKE :repoPattern", { repoPattern: `%${taskFilter.repoPattern}%` });
    }
    if (taskFilter?.limit) {
      query = query.limit(taskFilter.limit);
    }

    const tasks = await query.getMany();

    // Update all matching tasks with the provided metrics
    let updated = 0;
    for (const task of tasks) {
      task.qualityScore = metrics.qualityScore;
      task.lintScore = metrics.lintScore;
      task.lintErrors = metrics.lintErrors;
      task.lintWarnings = metrics.lintWarnings;
      task.typecheckScore = metrics.typecheckScore;
      task.typeErrors = metrics.typeErrors;
      task.testScore = metrics.testScore;
      task.testsPassed = metrics.testsPassed;
      task.testsFailed = metrics.testsFailed;
      task.testsSkipped = metrics.testsSkipped;
      task.securityScore = metrics.securityScore;
      task.securityHigh = metrics.securityHigh;
      task.securityMedium = metrics.securityMedium;
      task.securityLow = metrics.securityLow;
      task.qualityAnalysisJson = { manualBackfill: true, backfilledAt: new Date().toISOString() };
      await taskRepo.save(task);
      updated++;
    }

    res.json({
      success: true,
      tasksUpdated: updated,
      metrics,
    });
  } catch (error) {
    logger.error("Error in manual backfill", { error });
    res.status(500).json({ error: "Failed to backfill quality metrics" });
  }
});

export default router;
