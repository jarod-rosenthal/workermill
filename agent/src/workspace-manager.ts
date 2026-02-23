/**
 * Workspace Manager
 *
 * Manages persistent workspaces for batch board card executions.
 * When multiple cards share a boardExecutionId, the first card clones the repo
 * and installs deps; subsequent cards reuse the same workspace directory.
 *
 * Native mode: workspace = directory on disk at ~/.workermill/workspaces/{id}/
 * Docker mode: workspace = named Docker volume wm-workspace-{id}
 */

import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { execFileSync } from "child_process";

const WORKSPACE_BASE = path.join(os.homedir(), ".workermill", "workspaces");
const CLEANUP_TTL_MS = 30 * 60 * 1000; // 30 min after last task releases

interface WorkspaceEntry {
  boardExecutionId: string;
  workDir: string;
  repoPath: string | null;
  activeTaskCount: number;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
}

const workspaces = new Map<string, WorkspaceEntry>();

/**
 * Get or create a persistent workspace for a batch execution.
 * Increments activeTaskCount and cancels any pending cleanup.
 */
export function getOrCreateWorkspace(boardExecutionId: string): {
  workDir: string;
  repoPath: string | null;
  isNew: boolean;
} {
  const existing = workspaces.get(boardExecutionId);
  if (existing) {
    existing.activeTaskCount++;
    // Cancel pending cleanup
    if (existing.cleanupTimer) {
      clearTimeout(existing.cleanupTimer);
      existing.cleanupTimer = null;
    }
    return {
      workDir: existing.workDir,
      repoPath: existing.repoPath,
      isNew: false,
    };
  }

  // Create new workspace
  const workDir = path.join(WORKSPACE_BASE, boardExecutionId);
  fs.mkdirSync(workDir, { recursive: true });

  const entry: WorkspaceEntry = {
    boardExecutionId,
    workDir,
    repoPath: null,
    activeTaskCount: 1,
    cleanupTimer: null,
  };
  workspaces.set(boardExecutionId, entry);

  return { workDir, repoPath: null, isNew: true };
}

/**
 * Release a workspace after a task completes.
 * Decrements activeTaskCount and schedules cleanup when it reaches 0.
 */
export function releaseWorkspace(boardExecutionId: string): void {
  const entry = workspaces.get(boardExecutionId);
  if (!entry) return;

  entry.activeTaskCount = Math.max(0, entry.activeTaskCount - 1);

  if (entry.activeTaskCount === 0) {
    entry.cleanupTimer = setTimeout(() => {
      try {
        fs.rmSync(entry.workDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
      workspaces.delete(boardExecutionId);
    }, CLEANUP_TTL_MS);
  }
}

/**
 * Discover the repo path after the first task finishes cloning.
 * Looks for {workDir}/repo/.git.
 */
export function discoverRepoPath(boardExecutionId: string): void {
  const entry = workspaces.get(boardExecutionId);
  if (!entry || entry.repoPath) return;

  const candidatePath = path.join(entry.workDir, "repo");
  if (
    fs.existsSync(candidatePath) &&
    fs.existsSync(path.join(candidatePath, ".git"))
  ) {
    entry.repoPath = candidatePath;
  }
}

/**
 * Check if a workspace already has a cloned repo.
 */
export function hasClonedRepo(boardExecutionId: string): boolean {
  const entry = workspaces.get(boardExecutionId);
  return entry?.repoPath !== null && entry?.repoPath !== undefined;
}

/**
 * Get the repo path for a workspace.
 */
export function getRepoPath(boardExecutionId: string): string | null {
  return workspaces.get(boardExecutionId)?.repoPath ?? null;
}

/**
 * Get the Docker volume name for a batch execution.
 */
export function getDockerVolumeName(boardExecutionId: string): string {
  return `wm-workspace-${boardExecutionId.slice(0, 12)}`;
}

/**
 * Clean up a Docker volume for a batch execution.
 */
export function cleanupDockerVolume(
  boardExecutionId: string,
  dockerBin: string,
): void {
  const volumeName = getDockerVolumeName(boardExecutionId);
  try {
    execFileSync(dockerBin, ["volume", "rm", "-f", volumeName], {
      stdio: "pipe",
      timeout: 15_000,
      windowsHide: true,
    });
  } catch {
    /* best effort */
  }
}

/**
 * Clean up all workspaces — called on agent shutdown.
 */
export function cleanupAllWorkspaces(): void {
  for (const [id, entry] of workspaces) {
    if (entry.cleanupTimer) {
      clearTimeout(entry.cleanupTimer);
    }
    try {
      fs.rmSync(entry.workDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    workspaces.delete(id);
  }
}
