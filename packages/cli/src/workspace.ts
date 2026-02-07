import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import type { WorkerMillConfig } from "./config.js";
import { getCachePath, getWorkspacePath } from "./config.js";

export class WorkspaceManager {
  private cacheDir: string;
  private workDir: string;

  constructor(config: WorkerMillConfig) {
    this.cacheDir = getCachePath(config);
    this.workDir = getWorkspacePath(config);
  }

  /**
   * Ensure bare reference clone exists for the target repo.
   * First time: full bare clone. Subsequent: git fetch to update.
   */
  async ensureReferenceClone(repoUrl: string): Promise<string> {
    mkdirSync(this.cacheDir, { recursive: true });

    // Derive a stable directory name from the repo URL
    const repoName = repoUrl
      .replace(/\.git$/, "")
      .split("/")
      .pop() ?? "repo";
    const bareDir = join(this.cacheDir, `${repoName}.git`);

    if (existsSync(bareDir)) {
      // Update existing bare clone
      const git = simpleGit(bareDir);
      await git.fetch(["--all", "--prune"]);
    } else {
      // Create new bare clone
      const git = simpleGit();
      await git.clone(repoUrl, bareDir, ["--bare"]);
    }

    return bareDir;
  }

  /**
   * Create an isolated clone for a story.
   * Uses --reference for near-instant clone with hardlinked objects.
   * Returns the absolute path to the story workspace.
   */
  async createStoryClone(
    taskId: string,
    storyIndex: number,
    branch: string,
    repoUrl: string,
    referenceDir: string,
  ): Promise<string> {
    const taskDir = join(this.workDir, `task-${taskId}`);
    const storyDir = join(taskDir, `story-${storyIndex}`);

    mkdirSync(taskDir, { recursive: true });

    if (existsSync(storyDir)) {
      rmSync(storyDir, { recursive: true, force: true });
    }

    const git = simpleGit();
    await git.clone(repoUrl, storyDir, [
      "--reference",
      referenceDir,
      "--branch",
      branch,
      "--single-branch",
      "--depth",
      "1",
    ]);

    return storyDir;
  }

  /**
   * Clean up story clone after completion.
   */
  async cleanupStoryClone(taskId: string, storyIndex: number): Promise<void> {
    const storyDir = join(this.workDir, `task-${taskId}`, `story-${storyIndex}`);
    if (existsSync(storyDir)) {
      rmSync(storyDir, { recursive: true, force: true });
    }
  }

  /**
   * Clean up all clones for a completed task.
   */
  async cleanupTask(taskId: string): Promise<void> {
    const taskDir = join(this.workDir, `task-${taskId}`);
    if (existsSync(taskDir)) {
      rmSync(taskDir, { recursive: true, force: true });
    }
  }
}
