/**
 * SWE-bench Lite Benchmark Runner for WorkerMill
 *
 * Downloads the SWE-bench Lite dataset, creates a KbBoard with cards for each
 * instance, runs them through WorkerMill's local API with concurrency control,
 * and writes a JSONL predictions file.
 *
 * Usage:
 *   bin/swebench [options]
 *
 * Options:
 *   --count N          Number of instances to sample (default: 50)
 *   --concurrency N    Max concurrent workers (default: 4)
 *   --api-url URL      WorkerMill API base URL (default: http://localhost:3001)
 *   --output FILE      Output JSONL file path (default: swebench_predictions.jsonl)
 *   --timeout M        Max minutes to wait for completion (default: 120)
 *   --model-name NAME  model_name_or_path in predictions (default: workermill-v0.9)
 *   --dry-run          Create board/cards but don't run them
 *   --help             Show this help message
 *
 * Auth:
 *   Set WORKERMILL_TOKEN env var with a JWT Bearer token from the frontend.
 *   (DevTools -> Application -> Local Storage -> auth_token)
 *   Set GITHUB_TOKEN env var for diff extraction (avoids 60 req/hr rate limit).
 */

import * as fs from "fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SWEBenchInstance {
  instance_id: string;
  repo: string;
  base_commit: string;
  problem_statement: string;
  hints_text: string;
  patch: string;
  test_patch: string;
  version: string;
  environment_setup_commit: string;
  created_at: string;
  FAIL_TO_PASS: string;
  PASS_TO_PASS: string;
}

interface HuggingFaceResponse {
  rows: Array<{ row: SWEBenchInstance }>;
  num_rows_total: number;
}

interface CardInfo {
  cardId: string;
  instanceId: string;
  repo: string;
  baseCommit: string;
  workerTaskId?: string;
  status?: string;
  githubPrUrl?: string;
}

interface BoardColumn {
  id: string;
  name: string;
  position: number;
  cards?: Array<{
    id: string;
    title: string;
    workerTaskId: string | null;
    workerStatus: string | null;
  }>;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): {
  count: number;
  concurrency: number;
  apiUrl: string;
  output: string;
  timeoutMinutes: number;
  modelName: string;
  dryRun: boolean;
  help: boolean;
} {
  const args = process.argv.slice(2);
  const opts = {
    count: 50,
    concurrency: 4,
    apiUrl: "http://localhost:3001",
    output: "swebench_predictions.jsonl",
    timeoutMinutes: 120,
    modelName: "workermill-v0.9",
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--count":
        opts.count = parseInt(args[++i], 10);
        if (isNaN(opts.count) || opts.count < 1) {
          console.error("Error: --count must be a positive integer");
          process.exit(1);
        }
        break;
      case "--concurrency":
        opts.concurrency = parseInt(args[++i], 10);
        if (isNaN(opts.concurrency) || opts.concurrency < 1) {
          console.error("Error: --concurrency must be a positive integer");
          process.exit(1);
        }
        break;
      case "--timeout":
        opts.timeoutMinutes = parseInt(args[++i], 10);
        if (isNaN(opts.timeoutMinutes) || opts.timeoutMinutes < 1) {
          console.error("Error: --timeout must be a positive integer (minutes)");
          process.exit(1);
        }
        break;
      case "--model-name":
        opts.modelName = args[++i];
        break;
      case "--api-url":
        opts.apiUrl = args[++i];
        break;
      case "--output":
        opts.output = args[++i];
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        process.exit(1);
    }
  }

  return opts;
}

function showHelp(): void {
  console.log(`
SWE-bench Lite Benchmark Runner for WorkerMill

Usage:
  bin/swebench [options]

Options:
  --count N          Number of instances to sample (default: 50)
  --concurrency N    Max concurrent workers (default: 4)
  --api-url URL      WorkerMill API base URL (default: http://localhost:3001)
  --output FILE      Output JSONL file path (default: swebench_predictions.jsonl)
  --timeout M        Max minutes to wait for completion (default: 120)
  --model-name NAME  model_name_or_path in predictions (default: workermill-v0.9)
  --dry-run          Create board/cards but don't run them
  --help, -h         Show this help message

Environment:
  WORKERMILL_TOKEN   JWT Bearer token (required). Get from browser DevTools:
                     Application -> Local Storage -> auth_token
  GITHUB_TOKEN       GitHub token for diff extraction (optional, avoids rate limit)

Examples:
  # Dry run with 5 instances
  bin/swebench --dry-run --count 5

  # Full run with 50 instances, 8 concurrent workers
  bin/swebench --count 50 --concurrency 8

  # Use a different API endpoint
  bin/swebench --api-url https://workermill.com --count 10
`);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set([
  "completed",
  "deployed",
  "failed",
  "cancelled",
  "review_rejected",
]);

let authToken: string;
let githubToken: string;

async function apiFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };

  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const resp = await fetch(url, {
    ...options,
    headers,
  });

  return resp;
}

async function apiJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const resp = await apiFetch(url, options);
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `API ${options.method || "GET"} ${url} returned ${resp.status}: ${body}`,
    );
  }
  return resp.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Step 1: Download SWE-bench Lite dataset
// ---------------------------------------------------------------------------

async function downloadDataset(
  count: number,
): Promise<SWEBenchInstance[]> {
  console.log("Downloading SWE-bench Lite dataset from HuggingFace...");

  // Fetch in batches of 100 (HuggingFace API limit), up to enough for sampling
  const batchSize = 100;
  const totalToFetch = 300; // SWE-bench Lite has exactly 300 instances
  const allInstances: SWEBenchInstance[] = [];

  for (let offset = 0; offset < totalToFetch; offset += batchSize) {
    const length = Math.min(batchSize, totalToFetch - offset);
    const url = `https://datasets-server.huggingface.co/rows?dataset=princeton-nlp/SWE-bench_Lite&config=default&split=test&offset=${offset}&length=${length}`;

    console.log(
      `  Fetching rows ${offset}..${offset + length} from HuggingFace...`,
    );

    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        throw new Error(`HuggingFace API returned ${resp.status}: ${await resp.text()}`);
      }
      const data = (await resp.json()) as HuggingFaceResponse;
      for (const row of data.rows) {
        allInstances.push(row.row);
      }
      console.log(
        `  Got ${data.rows.length} rows (total so far: ${allInstances.length}, dataset has ${data.num_rows_total} total)`,
      );

      // If we got fewer than requested, we've hit the end
      if (data.rows.length < length) break;
    } catch (err) {
      if (offset === 0) {
        throw new Error(
          `Failed to download SWE-bench dataset: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      console.warn(
        `  Warning: Failed to fetch batch at offset ${offset}, continuing with ${allInstances.length} instances`,
      );
      break;
    }
  }

  if (allInstances.length === 0) {
    throw new Error("No instances downloaded from SWE-bench dataset");
  }

  console.log(`Downloaded ${allInstances.length} total instances`);
  return allInstances;
}

// ---------------------------------------------------------------------------
// Step 2: Sample N instances (stratified across repos)
// ---------------------------------------------------------------------------

function sampleInstances(
  instances: SWEBenchInstance[],
  count: number,
): SWEBenchInstance[] {
  if (count >= instances.length) {
    console.log(
      `Requested ${count} instances but only ${instances.length} available. Using all.`,
    );
    return instances;
  }

  // Sort by instance_id for determinism
  const sorted = [...instances].sort((a, b) =>
    a.instance_id.localeCompare(b.instance_id),
  );

  // Group by repo
  const byRepo = new Map<string, SWEBenchInstance[]>();
  for (const inst of sorted) {
    const list = byRepo.get(inst.repo) || [];
    list.push(inst);
    byRepo.set(inst.repo, list);
  }

  // Proportional allocation
  const sampled: SWEBenchInstance[] = [];
  const repos = [...byRepo.keys()].sort();
  let remaining = count;

  for (let r = 0; r < repos.length; r++) {
    const repo = repos[r];
    const repoInstances = byRepo.get(repo)!;
    const isLast = r === repos.length - 1;

    // Proportional count, ensuring at least 1 per repo if possible
    let repoCount: number;
    if (isLast) {
      repoCount = Math.min(remaining, repoInstances.length);
    } else {
      repoCount = Math.max(
        1,
        Math.round((repoInstances.length / sorted.length) * count),
      );
      repoCount = Math.min(repoCount, remaining, repoInstances.length);
    }

    if (repoCount <= 0) continue;

    // Deterministic sampling: evenly spaced
    const step = repoInstances.length / repoCount;
    for (let i = 0; i < repoCount && sampled.length < count; i++) {
      const idx = Math.floor(i * step);
      sampled.push(repoInstances[idx]);
    }
    remaining = count - sampled.length;
  }

  // Print repo distribution
  const distribution = new Map<string, number>();
  for (const inst of sampled) {
    distribution.set(inst.repo, (distribution.get(inst.repo) || 0) + 1);
  }
  console.log(`\nSampled ${sampled.length} instances across ${distribution.size} repos:`);
  for (const [repo, cnt] of [...distribution.entries()].sort()) {
    console.log(`  ${repo}: ${cnt}`);
  }
  console.log();

  return sampled;
}

// ---------------------------------------------------------------------------
// Step 3: Pre-clone repos (skipped — workers clone independently)
// ---------------------------------------------------------------------------
// NOTE: Workers clone repos independently based on task.githubRepo.
// The base_commit from SWE-bench is not yet passed to workers — this is a
// known gap. Workers will work from HEAD, which may differ from the instance's
// base_commit. A future improvement would add a baseCommit field to
// KbCard/WorkerTask to ensure workers start from the correct commit.

// ---------------------------------------------------------------------------
// Step 4: Create KbBoard
// ---------------------------------------------------------------------------

async function createBoard(
  apiUrl: string,
  count: number,
): Promise<{ boardId: string; firstColumnId: string }> {
  const now = new Date();
  const name = `SWE-bench Run ${now.toISOString().slice(0, 16).replace("T", " ")}`;
  const description = `SWE-bench Lite benchmark - ${count} instances`;

  console.log(`Creating board: "${name}"...`);

  const data = await apiJson<{
    board: {
      id: string;
      columns: Array<{ id: string; name: string; position: number }>;
    };
  }>(`${apiUrl}/api/boards`, {
    method: "POST",
    body: JSON.stringify({ name, description }),
  });

  const boardId = data.board.id;
  const firstColumn = data.board.columns.sort(
    (a, b) => a.position - b.position,
  )[0];

  if (!firstColumn) {
    throw new Error("Board created but has no columns");
  }

  console.log(`  Board created: ${boardId}`);
  console.log(`  First column: "${firstColumn.name}" (${firstColumn.id})`);

  return { boardId, firstColumnId: firstColumn.id };
}

// ---------------------------------------------------------------------------
// Step 5: Create "sdk" label and attach to cards
// ---------------------------------------------------------------------------

async function ensureSdkLabel(
  apiUrl: string,
): Promise<string> {
  // Check existing org labels
  const labelsData = await apiJson<{
    labels: Array<{ id: string; name: string }>;
  }>(`${apiUrl}/api/boards/labels`);

  const existing = labelsData.labels.find(
    (l) => l.name.toLowerCase() === "sdk",
  );
  if (existing) {
    console.log(`  SDK label already exists: ${existing.id}`);
    return existing.id;
  }

  // Create it
  const created = await apiJson<{ label: { id: string } }>(
    `${apiUrl}/api/boards/labels`,
    {
      method: "POST",
      body: JSON.stringify({ name: "sdk", color: "#6b7280" }),
    },
  );

  console.log(`  SDK label created: ${created.label.id}`);
  return created.label.id;
}

// ---------------------------------------------------------------------------
// Step 6: Create KbCards
// ---------------------------------------------------------------------------

async function createCards(
  apiUrl: string,
  boardId: string,
  columnId: string,
  sdkLabelId: string,
  instances: SWEBenchInstance[],
): Promise<CardInfo[]> {
  console.log(`\nCreating ${instances.length} cards...`);
  const cards: CardInfo[] = [];

  for (let i = 0; i < instances.length; i++) {
    const inst = instances[i];

    // Truncate problem_statement if too long (keep first 4000 chars)
    const description = inst.problem_statement.length > 4000
      ? inst.problem_statement.slice(0, 4000) + "\n\n[truncated]"
      : inst.problem_statement;

    // Create card with per-card repo override
    const cardData = await apiJson<{ card: { id: string } }>(
      `${apiUrl}/api/boards/${boardId}/cards`,
      {
        method: "POST",
        body: JSON.stringify({
          columnId,
          title: inst.instance_id,
          description,
          githubRepo: inst.repo,
        }),
      },
    );

    const cardId = cardData.card.id;

    // Attach SDK label
    await apiFetch(
      `${apiUrl}/api/boards/${boardId}/cards/${cardId}/labels`,
      {
        method: "POST",
        body: JSON.stringify({ labelId: sdkLabelId }),
      },
    );

    cards.push({
      cardId,
      instanceId: inst.instance_id,
      repo: inst.repo,
      baseCommit: inst.base_commit,
    });

    if ((i + 1) % 10 === 0 || i === instances.length - 1) {
      console.log(`  Created ${i + 1}/${instances.length} cards`);
    }
  }

  return cards;
}

// ---------------------------------------------------------------------------
// Step 7: Run cards with concurrency limit
// ---------------------------------------------------------------------------

async function runCards(
  apiUrl: string,
  boardId: string,
  cards: CardInfo[],
  concurrency: number,
  timeoutMinutes: number,
): Promise<void> {
  console.log(
    `\nRunning ${cards.length} cards with concurrency ${concurrency}...`,
  );

  let nextIdx = 0;

  async function startNext(): Promise<void> {
    // Count currently running tasks dynamically (no stale closure counter)
    const currentlyRunning = cards.filter(
      (c) => c.workerTaskId && !TERMINAL_STATUSES.has(c.status || "") && c.status !== undefined,
    ).length;

    let slotsAvailable = concurrency - currentlyRunning;
    while (nextIdx < cards.length && slotsAvailable > 0) {
      const card = cards[nextIdx];
      nextIdx++;

      try {
        const result = await apiJson<{
          workerTask: { id: string; status: string };
        }>(`${apiUrl}/api/boards/${boardId}/cards/${card.cardId}/run`, {
          method: "POST",
        });

        card.workerTaskId = result.workerTask.id;
        card.status = result.workerTask.status;
        slotsAvailable--;
        console.log(
          `  Started ${card.instanceId} -> task ${card.workerTaskId}`,
        );
      } catch (err) {
        console.error(
          `  Failed to start ${card.instanceId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        card.status = "failed";
      }
    }
  }

  // Start initial batch
  await startNext();

  // Poll until all done
  await pollForCompletion(apiUrl, boardId, cards, startNext, timeoutMinutes);
}

// ---------------------------------------------------------------------------
// Step 8: Poll for completion
// ---------------------------------------------------------------------------

async function pollForCompletion(
  apiUrl: string,
  boardId: string,
  cards: CardInfo[],
  startNext: () => Promise<void>,
  timeoutMinutes: number,
): Promise<void> {
  const POLL_INTERVAL_MS = 10000;
  const TIMEOUT_MS = timeoutMinutes * 60 * 1000;
  const startTime = Date.now();

  // Keep polling while any card is either running or not yet started
  let remaining = cards.filter(
    (c) => !TERMINAL_STATUSES.has(c.status || ""),
  ).length;

  while (remaining > 0) {
    // Check timeout
    if (Date.now() - startTime > TIMEOUT_MS) {
      console.warn(`\n  Timeout reached (${timeoutMinutes} minutes). Treating ${remaining} remaining tasks as failed.`);
      for (const card of cards) {
        if (!TERMINAL_STATUSES.has(card.status || "")) {
          card.status = "failed";
        }
      }
      break;
    }
    await sleep(POLL_INTERVAL_MS);

    try {
      // Poll the board to get card statuses
      const boardData = await apiJson<{
        board: { columns: BoardColumn[] };
      }>(`${apiUrl}/api/boards/${boardId}`);

      // Build a map of cardId -> workerStatus
      const statusMap = new Map<string, { status: string | null; taskId: string | null }>();
      for (const col of boardData.board.columns) {
        for (const card of col.cards || []) {
          statusMap.set(card.id, {
            status: card.workerStatus,
            taskId: card.workerTaskId,
          });
        }
      }

      // Update card statuses
      let completed = 0;
      let failed = 0;
      let inProgress = 0;
      let pending = 0;

      for (const card of cards) {
        const info = statusMap.get(card.cardId);
        if (info) {
          card.status = info.status || card.status;
          if (info.taskId) card.workerTaskId = info.taskId;
        }

        if (card.workerTaskId && !TERMINAL_STATUSES.has(card.status || "")) {
          inProgress++;
        } else if (card.status === "completed" || card.status === "deployed") {
          completed++;
        } else if (
          card.status === "failed" ||
          card.status === "cancelled" ||
          card.status === "review_rejected"
        ) {
          failed++;
        } else {
          pending++;
        }
      }

      const elapsed = formatDuration(Date.now() - startTime);
      const total = cards.length;
      const done = completed + failed;
      console.log(
        `  [${done}/${total}] ${completed} completed, ${failed} failed, ${inProgress} running, ${pending} pending (${elapsed})`,
      );

      // Start more tasks if slots opened up
      await startNext();

      // Recount: keep looping while any card is not in a terminal state
      remaining = cards.filter(
        (c) => !TERMINAL_STATUSES.has(c.status || ""),
      ).length;
    } catch (err) {
      console.warn(
        `  Poll error (will retry): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Step 9: Extract diffs and write predictions
// ---------------------------------------------------------------------------

async function extractDiffsAndWritePredictions(
  apiUrl: string,
  cards: CardInfo[],
  outputFile: string,
  modelName: string,
): Promise<{ completed: number; failed: number; noChanges: number }> {
  console.log(`\nExtracting diffs and writing predictions to ${outputFile}...`);

  const fd = fs.openSync(outputFile, "w");
  let completed = 0;
  let failed = 0;
  let noChanges = 0;

  try {
    for (const card of cards) {
      let modelPatch = "";

      if (
        card.workerTaskId &&
        (card.status === "completed" || card.status === "deployed")
      ) {
        try {
          // Fetch individual task to get githubPrUrl
          const task = await apiJson<{
            id: string;
            githubPrUrl: string | null;
            githubRepo: string | null;
          }>(`${apiUrl}/api/tasks/${card.workerTaskId}`).catch(() => null);

          const prUrl = task?.githubPrUrl || null;

          if (prUrl) {
            // Extract diff from GitHub PR
            // PR URL format: https://github.com/owner/repo/pull/123
            const prMatch = prUrl.match(
              /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/,
            );
            if (prMatch) {
              const [, repoPath, prNumber] = prMatch;
              try {
                const diffHeaders: Record<string, string> = {
                  Accept: "application/vnd.github.v3.diff",
                };
                if (githubToken) {
                  diffHeaders["Authorization"] = `token ${githubToken}`;
                }
                const diffResp = await fetch(
                  `https://api.github.com/repos/${repoPath}/pulls/${prNumber}`,
                  { headers: diffHeaders },
                );
                if (diffResp.ok) {
                  modelPatch = await diffResp.text();
                  completed++;
                } else {
                  console.warn(
                    `  ${card.instanceId}: Could not fetch PR diff (${diffResp.status})`,
                  );
                  noChanges++;
                }
              } catch {
                console.warn(
                  `  ${card.instanceId}: Error fetching PR diff`,
                );
                noChanges++;
              }
            } else {
              console.warn(
                `  ${card.instanceId}: Could not parse PR URL: ${prUrl}`,
              );
              noChanges++;
            }
          } else {
            console.warn(
              `  ${card.instanceId}: No PR URL found (task completed without changes?)`,
            );
            noChanges++;
          }
        } catch (err) {
          console.warn(
            `  ${card.instanceId}: Error getting task info: ${err instanceof Error ? err.message : String(err)}`,
          );
          noChanges++;
        }
      } else {
        failed++;
      }

      // Write JSONL line
      const prediction = {
        instance_id: card.instanceId,
        model_name_or_path: modelName,
        model_patch: modelPatch,
      };
      fs.writeSync(fd, JSON.stringify(prediction) + "\n");
    }
  } finally {
    fs.closeSync(fd);
  }

  return { completed, failed, noChanges };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs();

  if (opts.help) {
    showHelp();
    process.exit(0);
  }

  // Validate auth token
  authToken = process.env.WORKERMILL_TOKEN || "";
  githubToken = process.env.GITHUB_TOKEN || "";
  if (!authToken) {
    console.error(
      "Error: WORKERMILL_TOKEN env var is required.\n" +
        "Get it from browser DevTools: Application -> Local Storage -> auth_token\n" +
        "Then: export WORKERMILL_TOKEN=<your-token>",
    );
    process.exit(1);
  }

  console.log("=".repeat(60));
  console.log("SWE-bench Lite Benchmark Runner");
  console.log("=".repeat(60));
  console.log(`  Count:       ${opts.count}`);
  console.log(`  Concurrency: ${opts.concurrency}`);
  console.log(`  API URL:     ${opts.apiUrl}`);
  console.log(`  Output:      ${opts.output}`);
  console.log(`  Timeout:     ${opts.timeoutMinutes} minutes`);
  console.log(`  Model name:  ${opts.modelName}`);
  console.log(`  Dry run:     ${opts.dryRun}`);
  console.log(`  GitHub auth: ${githubToken ? "yes" : "no (may hit rate limit)"}`);
  console.log();

  const startTime = Date.now();

  // Step 1: Download dataset
  const allInstances = await downloadDataset(opts.count);

  // Step 2: Sample
  const sampled = sampleInstances(allInstances, opts.count);

  // Step 3: Pre-clone repos (skipped — workers clone independently)

  // Step 4: Create board
  const { boardId, firstColumnId } = await createBoard(
    opts.apiUrl,
    sampled.length,
  );

  // Step 5: Ensure SDK label exists
  const sdkLabelId = await ensureSdkLabel(opts.apiUrl);

  // Step 6: Create cards
  const cards = await createCards(
    opts.apiUrl,
    boardId,
    firstColumnId,
    sdkLabelId,
    sampled,
  );

  if (opts.dryRun) {
    console.log("\n--- DRY RUN: Skipping task execution ---");
    console.log(`Board: ${opts.apiUrl.replace(/\/api$/, "")}/boards/${boardId}`);
    console.log(`Cards created: ${cards.length}`);

    // Write empty predictions
    const fd = fs.openSync(opts.output, "w");
    for (const card of cards) {
      fs.writeSync(
        fd,
        JSON.stringify({
          instance_id: card.instanceId,
          model_name_or_path: opts.modelName,
          model_patch: "",
        }) + "\n",
      );
    }
    fs.closeSync(fd);
    console.log(`Empty predictions written to ${opts.output}`);
    return;
  }

  // Step 7: Run cards
  await runCards(opts.apiUrl, boardId, cards, opts.concurrency, opts.timeoutMinutes);

  // Step 8-9: Extract diffs and write predictions
  const results = await extractDiffsAndWritePredictions(
    opts.apiUrl,
    cards,
    opts.output,
    opts.modelName,
  );

  // Step 10: Print summary
  const elapsed = formatDuration(Date.now() - startTime);

  console.log("\n" + "=".repeat(40));
  console.log("SWE-bench Lite Results");
  console.log("=".repeat(40));
  console.log(`Total:       ${sampled.length}`);
  console.log(`Completed:   ${results.completed}`);
  console.log(`Failed:      ${results.failed}`);
  console.log(`No changes:  ${results.noChanges}`);
  console.log();
  console.log(`Time:        ${elapsed}`);
  console.log(`Output:      ${opts.output}`);
  console.log(`Board:       ${opts.apiUrl}/boards/${boardId}`);
}

main().catch((err) => {
  console.error(`\nFatal error: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
