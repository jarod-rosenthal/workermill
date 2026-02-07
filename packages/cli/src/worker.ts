import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { WorkerMillConfig } from "./config.js";
import { ApiClient } from "./api-client.js";
import { WorkspaceManager } from "./workspace.js";

const POLL_INTERVAL_MS = 5_000;

let running = false;
let currentProcess: ChildProcess | null = null;

export async function startWorker(config: WorkerMillConfig): Promise<void> {
  running = true;
  const api = new ApiClient(config);
  const workspace = new WorkspaceManager(config);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n  Shutting down worker...");
    running = false;
    if (currentProcess) {
      currentProcess.kill("SIGTERM");
    }
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  // Main loop: poll for tasks
  while (running) {
    try {
      const story = await api.claimStory("pending");
      if (story) {
        await executeStory(api, workspace, config, story);
      } else {
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  Error polling for tasks: ${msg}`);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

interface ClaimedStory {
  storyId: string;
  storyIndex: number;
  persona: string;
  prompt: string;
  branch: string;
  taskId?: string;
  repoUrl?: string;
  model?: string;
}

async function executeStory(
  api: ApiClient,
  workspace: WorkspaceManager,
  config: WorkerMillConfig,
  story: ClaimedStory,
): Promise<void> {
  const taskId = story.taskId ?? "unknown";
  const repoUrl = story.repoUrl ?? "";

  console.log(`\n  Executing story ${story.storyIndex}: ${story.persona}`);

  // 1. Set up workspace
  let storyDir: string;
  try {
    const refDir = await workspace.ensureReferenceClone(repoUrl);
    storyDir = await workspace.createStoryClone(
      taskId,
      story.storyIndex,
      story.branch,
      repoUrl,
      refDir,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  Failed to set up workspace: ${msg}`);
    await api.postStatus(taskId, story.storyId, "failed", { error: msg });
    return;
  }

  // 2. Start log streaming
  api.startLogStreaming(taskId);

  // 3. Spawn Claude CLI
  const model = story.model ?? "claude-sonnet-4-20250514";
  try {
    await api.postStatus(taskId, story.storyId, "running");

    const exitCode = await spawnClaudeCli(api, {
      prompt: story.prompt,
      model,
      workingDir: storyDir,
    });

    if (exitCode === 0) {
      await api.postStatus(taskId, story.storyId, "completed");
      console.log(`  Story ${story.storyIndex} completed.`);
    } else {
      await api.postStatus(taskId, story.storyId, "failed", {
        error: `Claude CLI exited with code ${exitCode}`,
      });
      console.error(`  Story ${story.storyIndex} failed (exit ${exitCode}).`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await api.postBlocker(taskId, story.storyId, {
      summary: `Story execution failed: ${msg}`,
      errorMessage: msg,
      errorCategory: "build",
    });
    console.error(`  Story ${story.storyIndex} error: ${msg}`);
  } finally {
    await api.stopLogStreaming();
    await workspace.cleanupStoryClone(taskId, story.storyIndex);
  }
}

interface ClaudeCliOptions {
  prompt: string;
  model: string;
  workingDir: string;
}

function spawnClaudeCli(api: ApiClient, opts: ClaudeCliOptions): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "claude",
      ["--print", "--output-format", "text", "--model", opts.model, opts.prompt],
      {
        cwd: opts.workingDir,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      },
    );

    currentProcess = child;

    // Tee stdout to terminal + buffer for cloud
    if (child.stdout) {
      const rl = createInterface({ input: child.stdout });
      rl.on("line", (line) => {
        process.stdout.write(line + "\n"); // Tee to terminal
        api.bufferLogLine(line); // Buffer for cloud POST
      });
    }

    // Tee stderr to terminal + buffer
    if (child.stderr) {
      const rl = createInterface({ input: child.stderr });
      rl.on("line", (line) => {
        process.stderr.write(line + "\n");
        api.bufferLogLine(line);
      });
    }

    child.on("error", (err) => {
      currentProcess = null;
      reject(err);
    });

    child.on("close", (code) => {
      currentProcess = null;
      resolve(code ?? 1);
    });
  });
}

export async function stopWorker(): Promise<void> {
  running = false;
  if (currentProcess) {
    currentProcess.kill("SIGTERM");
    console.log("  Worker stopped.");
  } else {
    console.log("  No worker process running.");
  }
}

export async function getWorkerStatus(
  _config: WorkerMillConfig,
): Promise<{ running: boolean; currentTask?: string }> {
  // In a real implementation this would check a PID file or IPC
  return { running };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
