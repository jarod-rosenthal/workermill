/**
 * workermill-agent run --repo <url> --task "description"
 *
 * Creates a task in standalone mode and runs it.
 */

import chalk from "chalk";
import { getBackend, resetBackend } from "../backends/selector.js";
import { initOrchestrator, shutdownOrchestrator, processQueuedTask } from "../backends/local/orchestrator.js";
import { startLocalApi, stopLocalApi } from "../local-api.js";
import { loadStandaloneConfig, isStandaloneReady, getRoleConfig } from "../backends/local/config.js";

export async function runStandaloneCommand(opts: {
  repo?: string;
  task?: string;
}): Promise<void> {
  if (!isStandaloneReady()) {
    console.error(chalk.red("Not configured. Run 'workermill-agent init --standalone' first."));
    process.exit(1);
  }

  if (!opts.task) {
    console.error(chalk.red("--task is required. Describe what you want the AI worker to do."));
    process.exit(1);
  }

  console.log(chalk.bold.cyan("  WorkerMill — Running task"));
  console.log();

  const backend = await getBackend();
  const config = loadStandaloneConfig();

  // Start local API for worker communication
  // Use a minimal config for startLocalApi
  const agentConfig = {
    apiUrl: "",
    apiKey: "",
    agentId: "standalone",
    maxWorkers: config.settings?.maxParallelExperts ?? 0,
    pollIntervalMs: 5000,
    heartbeatIntervalMs: 30000,
    githubToken: config.scm?.token || "",
    bitbucketToken: config.scm?.token || "",
    gitlabToken: "",
    githubReviewerToken: "",
    sandbox: "none" as const,
    dockerImage: "ghcr.io/workermill/worker",
    dockerMemoryGb: 4,
    localRag: false,
    ollamaPort: 11434,
  };

  const port = await startLocalApi(agentConfig);
  initOrchestrator(port);

  // Create and run the task
  const task = await backend.createTask({
    summary: opts.task,
    githubRepo: opts.repo || config.defaultRepo,
    scmProvider: config.scm?.provider,
    workerModel: getRoleConfig(config, "worker").model,
  });

  console.log(`  ${chalk.dim("Task:")}  ${task.id.slice(0, 8)} — ${task.summary}`);
  console.log(`  ${chalk.dim("Repo:")}  ${opts.repo || config.defaultRepo || "none"}`);
  console.log();

  await processQueuedTask(task.id);

  // Wait for task to complete
  console.log(chalk.dim("  Waiting for worker to finish..."));
  console.log();

  await new Promise<void>((resolve) => {
    const check = setInterval(async () => {
      const current = await backend.getTask(task.id);
      if (current && (current.status === "completed" || current.status === "failed" || current.status === "cancelled")) {
        clearInterval(check);
        if (current.status === "completed") {
          console.log(`  ${chalk.green("✓")} Task completed successfully.`);
        } else {
          console.log(`  ${chalk.red("✗")} Task ${current.status}.`);
        }
        resolve();
      }
    }, 2000);
  });

  // Cleanup
  shutdownOrchestrator();
  await stopLocalApi();
  await resetBackend();
}
