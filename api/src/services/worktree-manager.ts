/**
 * Git Worktree Manager
 *
 * Manages a pool of git worktrees for parallel expert execution in local mode.
 * Each expert gets its own isolated worktree to avoid file conflicts.
 *
 * Usage:
 *   const wt = await worktreeManager.acquireWorktree(taskId, 'backend_developer');
 *   // ... expert executes in wt.path ...
 *   await worktreeManager.releaseWorktree(wt.path);
 */

import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { logger } from "../utils/logger.js";

interface Worktree {
  path: string;
  branch: string;
  inUse: boolean;
  taskId?: string;
  expertPersona?: string;
  createdAt: Date;
  acquiredAt?: Date;
}

interface WorktreeStatus {
  total: number;
  inUse: number;
  available: number;
}

class WorktreeManager {
  private worktrees: Map<string, Worktree> = new Map();
  private basePath: string;
  private targetRepoPath: string;
  private poolSize: number;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.basePath = process.env.WORKTREE_BASE_PATH || "../workermill-workers";
    this.targetRepoPath = process.env.TARGET_REPO_PATH || ".";
    this.poolSize = parseInt(process.env.WORKTREE_POOL_SIZE || "8", 10);
  }

  /**
   * Initialize worktree pool on first use.
   * Safe to call multiple times - will only initialize once.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Prevent concurrent initialization
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInitialize();
    await this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    logger.info("Initializing worktree pool", {
      basePath: this.basePath,
      targetRepo: this.targetRepoPath,
      poolSize: this.poolSize,
    });

    // Resolve absolute paths
    const absoluteBasePath = path.isAbsolute(this.basePath)
      ? this.basePath
      : path.resolve(process.cwd(), this.basePath);

    const absoluteTargetRepo = path.isAbsolute(this.targetRepoPath)
      ? this.targetRepoPath
      : path.resolve(process.cwd(), this.targetRepoPath);

    // Store resolved paths
    this.basePath = absoluteBasePath;
    this.targetRepoPath = absoluteTargetRepo;

    // Ensure base directory exists
    if (!fs.existsSync(absoluteBasePath)) {
      fs.mkdirSync(absoluteBasePath, { recursive: true });
    }

    // Verify target repo exists and is a git repo
    if (!fs.existsSync(absoluteTargetRepo)) {
      logger.warn("Target repository does not exist", { path: absoluteTargetRepo });
      this.initialized = true;
      return;
    }

    if (!fs.existsSync(path.join(absoluteTargetRepo, ".git"))) {
      logger.warn("Target path is not a git repository", { path: absoluteTargetRepo });
      this.initialized = true;
      return;
    }

    // Clean up stale worktrees from previous runs
    await this.pruneStaleWorktrees();

    // Discover existing worktrees
    await this.discoverExistingWorktrees();

    // Pre-create pool if needed
    const existing = this.worktrees.size;
    const toCreate = Math.max(0, this.poolSize - existing);

    for (let i = 0; i < toCreate; i++) {
      const name = `worker-${existing + i}`;
      try {
        await this.createWorktree(name);
      } catch (e) {
        logger.warn(`Failed to create worktree ${name}`, {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    this.initialized = true;
    logger.info("Worktree pool initialized", {
      total: this.worktrees.size,
      existing,
      created: toCreate,
    });
  }

  /**
   * Acquire a worktree for a task/expert.
   * Creates a new branch for the work and returns the worktree path.
   */
  async acquireWorktree(taskId: string, expertPersona?: string): Promise<string> {
    await this.initialize();

    // Find available worktree
    for (const [wtPath, wt] of this.worktrees) {
      if (!wt.inUse) {
        // Reset to clean state
        await this.resetWorktree(wtPath);

        // Create task-specific branch
        const branchName = `local-${taskId.slice(0, 8)}-${Date.now()}`;
        try {
          execSync(`git checkout -b "${branchName}"`, {
            cwd: wtPath,
            stdio: "ignore",
          });
        } catch {
          // Branch might already exist, try checking out
          try {
            execSync(`git checkout "${branchName}"`, {
              cwd: wtPath,
              stdio: "ignore",
            });
          } catch (e) {
            logger.warn("Failed to create/checkout branch", {
              path: wtPath,
              branch: branchName,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }

        // Mark as in use
        wt.inUse = true;
        wt.taskId = taskId;
        wt.expertPersona = expertPersona;
        wt.branch = branchName;
        wt.acquiredAt = new Date();

        logger.info("Acquired worktree", {
          path: wtPath,
          taskId,
          expertPersona,
          branch: branchName,
        });

        return wtPath;
      }
    }

    // No available worktree, create a new one dynamically
    const name = `worker-${this.worktrees.size}`;
    const wt = await this.createWorktree(name);

    const branchName = `local-${taskId.slice(0, 8)}-${Date.now()}`;
    try {
      execSync(`git checkout -b "${branchName}"`, {
        cwd: wt.path,
        stdio: "ignore",
      });
    } catch {
      // Ignore if branch exists
    }

    wt.inUse = true;
    wt.taskId = taskId;
    wt.expertPersona = expertPersona;
    wt.branch = branchName;
    wt.acquiredAt = new Date();

    logger.info("Created and acquired new worktree", {
      path: wt.path,
      taskId,
      expertPersona,
      branch: branchName,
    });

    return wt.path;
  }

  /**
   * Release a worktree back to the pool.
   */
  async releaseWorktree(worktreePath: string): Promise<void> {
    const wt = this.worktrees.get(worktreePath);
    if (!wt) {
      logger.warn("Attempted to release unknown worktree", { path: worktreePath });
      return;
    }

    logger.info("Releasing worktree", {
      path: worktreePath,
      taskId: wt.taskId,
      expertPersona: wt.expertPersona,
    });

    // Reset to clean state
    await this.resetWorktree(worktreePath);

    // Mark as available
    wt.inUse = false;
    wt.taskId = undefined;
    wt.expertPersona = undefined;
    wt.acquiredAt = undefined;
  }

  /**
   * Reset worktree to clean state on main branch.
   */
  private async resetWorktree(worktreePath: string): Promise<void> {
    try {
      // Discard all changes
      execSync("git checkout -- .", { cwd: worktreePath, stdio: "ignore" });
      execSync("git clean -fd", { cwd: worktreePath, stdio: "ignore" });

      // Switch back to main/master branch
      try {
        execSync("git checkout main", { cwd: worktreePath, stdio: "ignore" });
      } catch {
        try {
          execSync("git checkout master", { cwd: worktreePath, stdio: "ignore" });
        } catch {
          // Ignore - might be on a valid branch already
        }
      }

      // Pull latest
      try {
        execSync("git pull --rebase", { cwd: worktreePath, stdio: "ignore" });
      } catch {
        // Ignore pull errors - might be offline
      }
    } catch (e) {
      logger.warn("Failed to reset worktree", {
        path: worktreePath,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /**
   * Create a new worktree.
   */
  private async createWorktree(name: string): Promise<Worktree> {
    const wtPath = path.join(this.basePath, name);
    const branch = `local-worker-${name}-init`;

    // Remove if exists (from previous run)
    if (fs.existsSync(wtPath)) {
      try {
        execSync(`git worktree remove "${wtPath}" --force`, {
          cwd: this.targetRepoPath,
          stdio: "ignore",
        });
      } catch {
        // May fail if not a valid worktree, just remove directory
        fs.rmSync(wtPath, { recursive: true, force: true });
      }
    }

    // Create new worktree
    execSync(`git worktree add "${wtPath}" -b "${branch}"`, {
      cwd: this.targetRepoPath,
      stdio: "ignore",
    });

    const worktree: Worktree = {
      path: wtPath,
      branch,
      inUse: false,
      createdAt: new Date(),
    };

    this.worktrees.set(wtPath, worktree);
    logger.info("Created worktree", { path: wtPath, branch });

    return worktree;
  }

  /**
   * Discover existing worktrees in the pool directory.
   */
  private async discoverExistingWorktrees(): Promise<void> {
    try {
      const output = execSync("git worktree list --porcelain", {
        cwd: this.targetRepoPath,
        encoding: "utf-8",
      });

      const lines = output.trim().split("\n");
      let currentPath = "";

      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          currentPath = line.substring(9);
          // Only track worktrees in our base path
          if (currentPath.startsWith(this.basePath) && !this.worktrees.has(currentPath)) {
            this.worktrees.set(currentPath, {
              path: currentPath,
              branch: "",
              inUse: false,
              createdAt: new Date(),
            });
          }
        } else if (line.startsWith("branch ") && currentPath) {
          const wt = this.worktrees.get(currentPath);
          if (wt) {
            wt.branch = line.substring(7);
          }
        }
      }
    } catch (e) {
      logger.warn("Failed to discover existing worktrees", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /**
   * Prune stale worktrees from previous runs.
   */
  private async pruneStaleWorktrees(): Promise<void> {
    try {
      execSync("git worktree prune", {
        cwd: this.targetRepoPath,
        stdio: "ignore",
      });
    } catch {
      // Ignore errors
    }
  }

  /**
   * Get all worktree paths for a specific task.
   */
  getWorktreesForTask(taskId: string): string[] {
    return Array.from(this.worktrees.entries())
      .filter(([_, wt]) => wt.taskId === taskId)
      .map(([path]) => path);
  }

  /**
   * Get status of all worktrees.
   */
  getStatus(): WorktreeStatus {
    const inUse = Array.from(this.worktrees.values()).filter((wt) => wt.inUse).length;
    return {
      total: this.worktrees.size,
      inUse,
      available: this.worktrees.size - inUse,
    };
  }

  /**
   * Get details of a specific worktree.
   */
  getWorktreeDetails(worktreePath: string): Worktree | undefined {
    return this.worktrees.get(worktreePath);
  }

  /**
   * Cleanup all worktrees on shutdown.
   */
  async cleanup(): Promise<void> {
    logger.info("Cleaning up worktrees");

    for (const [wtPath] of this.worktrees) {
      try {
        execSync(`git worktree remove "${wtPath}" --force`, {
          cwd: this.targetRepoPath,
          stdio: "ignore",
        });
      } catch {
        // Best effort cleanup
      }
    }

    this.worktrees.clear();
    this.initialized = false;
    this.initPromise = null;
  }

  /**
   * Check if manager is in local execution mode.
   */
  isLocalMode(): boolean {
    return process.env.EXECUTION_MODE === "local";
  }
}

// Singleton instance
export const worktreeManager = new WorktreeManager();
