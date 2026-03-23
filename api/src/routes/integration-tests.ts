import { Router, Request, Response } from "express";
import { execSync, spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { logger } from "../utils/logger.js";

const router = Router();

// Guard: only available in local dev mode
router.use((req: Request, res: Response, next) => {
  if (process.env.EXECUTION_MODE !== "local") {
    return res.status(404).json({ error: "Not available" });
  }
  next();
});

const RESULTS_PATH = path.resolve("frontend/e2e/results/latest.json");
const CONFIG_PATH = path.resolve("frontend/e2e/results/integration-config.json");

const DEFAULT_CONFIG = {
  testRepo: "jarod-rosenthal/test",
  baselineTag: "e2e-baseline",
  resetOnRun: true,
  ollamaHost: "http://host.docker.internal:11434",
  workerModel: "qwen3-coder:30b",
  suites: [
    "ollama-worker",
    "ai-providers",
    "github-verification",
    "code-quality",
    "multi-story",
    "error-flows",
    "scm-providers",
    "ticket-systems",
  ],
};

// Active run state
let activeProcess: ChildProcess | null = null;
let logBuffer: string[] = [];
let runId: string | null = null;

function readConfig(): typeof DEFAULT_CONFIG {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
      return JSON.parse(raw);
    }
  } catch (err) {
    logger.warn("Failed to read integration config, using defaults", { error: err });
  }
  return DEFAULT_CONFIG;
}

/**
 * GET /api/integration-tests/results
 * Return latest test results
 */
router.get("/results", (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(RESULTS_PATH)) {
      res.status(404).json({ error: "No test results found" });
      return;
    }
    const raw = fs.readFileSync(RESULTS_PATH, "utf-8");
    const data = JSON.parse(raw);
    res.json(data);
  } catch (error) {
    logger.error("Error reading test results", { error });
    res.status(500).json({ error: "Failed to read test results" });
  }
});

/**
 * GET /api/integration-tests/config
 * Return integration test config
 */
router.get("/config", (_req: Request, res: Response) => {
  try {
    const config = readConfig();
    res.json(config);
  } catch (error) {
    logger.error("Error reading integration config", { error });
    res.status(500).json({ error: "Failed to read config" });
  }
});

/**
 * PUT /api/integration-tests/config
 * Save integration test config
 */
router.put("/config", (req: Request, res: Response) => {
  try {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      res.status(400).json({ error: "Request body must be an object" });
      return;
    }
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(req.body, null, 2));
    res.json({ success: true });
  } catch (error) {
    logger.error("Error saving integration config", { error });
    res.status(500).json({ error: "Failed to save config" });
  }
});

/**
 * POST /api/integration-tests/run
 * Spawn Playwright test process
 */
router.post("/run", (req: Request, res: Response) => {
  try {
    if (activeProcess && !activeProcess.killed) {
      res.status(409).json({ error: "A test run is already in progress" });
      return;
    }

    const suite = req.query.suite as string | undefined;
    const args = ["playwright", "test", "--config=playwright.integration.config.ts"];
    if (suite) {
      args.push("-g", suite);
    }

    logBuffer = [];
    runId = `run-${Date.now()}`;

    activeProcess = spawn("npx", args, {
      cwd: path.resolve("frontend"),
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    activeProcess.stdout?.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n").filter(Boolean);
      logBuffer.push(...lines);
    });

    activeProcess.stderr?.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n").filter(Boolean);
      logBuffer.push(...lines);
    });

    activeProcess.on("close", () => {
      activeProcess = null;
    });

    res.json({ runId, status: "running" });
  } catch (error) {
    logger.error("Error starting test run", { error });
    res.status(500).json({ error: "Failed to start test run" });
  }
});

/**
 * GET /api/integration-tests/run/status
 * SSE endpoint for streaming test output
 */
router.get("/run/status", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  if (!activeProcess || activeProcess.killed) {
    res.write(`data: ${JSON.stringify({ type: "done", exitCode: 0 })}\n\n`);
    res.end();
    return;
  }

  let sentLines = 0;

  // Send any buffered lines first
  const sendBuffered = () => {
    while (sentLines < logBuffer.length) {
      res.write(`data: ${JSON.stringify({ type: "log", line: logBuffer[sentLines] })}\n\n`);
      sentLines++;
    }
  };

  sendBuffered();

  const interval = setInterval(() => {
    sendBuffered();
  }, 200);

  const onClose = (code: number | null) => {
    clearInterval(interval);
    // Flush remaining lines
    sendBuffered();
    res.write(`data: ${JSON.stringify({ type: "done", exitCode: code ?? 1 })}\n\n`);
    res.end();
  };

  activeProcess.on("close", onClose);

  req.on("close", () => {
    clearInterval(interval);
    if (activeProcess) {
      activeProcess.removeListener("close", onClose);
    }
  });
});

/**
 * POST /api/integration-tests/reset-repo
 * Reset the test repository to baseline
 */
router.post("/reset-repo", async (_req: Request, res: Response) => {
  try {
    const config = readConfig();
    const repo = config.testRepo;
    const tag = config.baselineTag;

    // 1. Get baseline tag SHA
    const sha = execSync(
      `gh api repos/${repo}/git/ref/tags/${tag} --jq '.object.sha'`,
      { encoding: "utf-8" }
    ).trim();

    // 2. Force-update main
    execSync(
      `gh api -X PATCH repos/${repo}/git/refs/heads/main -f sha=${sha} -f force=true`,
      { encoding: "utf-8" }
    );

    // 3. Delete story/* branches
    const branchesRaw = execSync(
      `gh api repos/${repo}/branches --jq '.[].name'`,
      { encoding: "utf-8" }
    ).trim();

    const branches = branchesRaw
      .split("\n")
      .filter((b) => b.startsWith("story/"));

    for (const branch of branches) {
      try {
        execSync(
          `gh api -X DELETE repos/${repo}/git/refs/heads/${branch}`,
          { encoding: "utf-8" }
        );
      } catch {
        logger.warn(`Failed to delete branch ${branch}`);
      }
    }

    // 4. Close open PRs
    const prsRaw = execSync(
      `gh api repos/${repo}/pulls --jq '.[].number'`,
      { encoding: "utf-8" }
    ).trim();

    if (prsRaw) {
      const prNumbers = prsRaw.split("\n").filter(Boolean);
      for (const prNumber of prNumbers) {
        try {
          execSync(
            `gh api -X PATCH repos/${repo}/pulls/${prNumber} -f state=closed`,
            { encoding: "utf-8" }
          );
        } catch {
          logger.warn(`Failed to close PR #${prNumber}`);
        }
      }
    }

    res.json({
      success: true,
      message: `Repository ${repo} reset to ${tag} (${sha.substring(0, 7)}). Deleted ${branches.length} story branches.`,
    });
  } catch (error) {
    logger.error("Error resetting repo", { error });
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: `Failed to reset repo: ${message}` });
  }
});

export default router;
