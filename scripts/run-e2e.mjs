import fs from "fs";
import path from "path";
import { spawn } from "child_process";

const ROOT = process.cwd();
const E2E_DIR = path.join(ROOT, "src", "__tests__", "e2e");
const CONFIG_FILE = path.join(ROOT, "vitest.e2e.config.ts");
const VITEST_BIN = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");
const FILE_TIMEOUT_MS = Number(process.env.WM_E2E_FILE_TIMEOUT_MS || 600_000);
const RETRY_COUNT = Number(process.env.WM_E2E_RETRIES || 1);
const HEARTBEAT_MS = Number(process.env.WM_E2E_HEARTBEAT_MS || 30_000);
const TERM_GRACE_MS = 5_000;

function listE2ETests(dir) {
  return fs.readdirSync(dir)
    .filter((entry) => entry.endsWith(".test.ts"))
    .sort()
    .map((entry) => path.join(dir, entry));
}

function relativeToRoot(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function killProcessTree(child) {
  if (!child.pid) return;

  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      detached: true,
    });
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  }

  setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
  }, TERM_GRACE_MS).unref();
}

async function runTestFile(filePath, attempt, maxAttempts) {
  const label = relativeToRoot(filePath);
  console.log(`\n=== ${label} (attempt ${attempt}/${maxAttempts}) ===`);

  return await new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(
      process.execPath,
      [VITEST_BIN, "run", "--config", CONFIG_FILE, filePath],
      {
        cwd: ROOT,
        stdio: "inherit",
        detached: process.platform !== "win32",
        env: process.env,
      },
    );

    let timedOut = false;
    const heartbeat = setInterval(() => {
      console.log(`[wm e2e] Still running ${label} (${formatDuration(Date.now() - startedAt)})`);
    }, HEARTBEAT_MS);
    heartbeat.unref();
    const timeout = setTimeout(() => {
      timedOut = true;
      console.error(`\n[wm e2e] Timeout after ${Math.round(FILE_TIMEOUT_MS / 1000)}s: ${label}`);
      killProcessTree(child);
    }, FILE_TIMEOUT_MS);

    child.on("close", (code, signal) => {
      clearInterval(heartbeat);
      clearTimeout(timeout);
      resolve({
        file: label,
        passed: !timedOut && code === 0,
        timedOut,
        code,
        signal,
        attempt,
        durationMs: Date.now() - startedAt,
      });
    });

    child.on("error", (error) => {
      clearInterval(heartbeat);
      clearTimeout(timeout);
      console.error(`\n[wm e2e] Failed to start ${label}: ${error.message}`);
      resolve({
        file: label,
        passed: false,
        timedOut: false,
        code: null,
        signal: null,
        attempt,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

function formatDuration(durationMs) {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

async function main() {
  if (!fs.existsSync(VITEST_BIN)) {
    console.error(`[wm e2e] Vitest binary not found: ${VITEST_BIN}`);
    process.exit(1);
  }

  const files = listE2ETests(E2E_DIR);
  if (files.length === 0) {
    console.error("[wm e2e] No e2e test files found.");
    process.exit(1);
  }

  const results = [];
  for (const file of files) {
    let result;
    const maxAttempts = RETRY_COUNT + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // eslint-disable-next-line no-await-in-loop
      result = await runTestFile(file, attempt, maxAttempts);
      if (result.passed || attempt === maxAttempts) break;
      const reason = result.timedOut
        ? `timeout after ${Math.round(FILE_TIMEOUT_MS / 1000)}s`
        : result.code == null
          ? "process error"
          : `exit ${result.code}${result.signal ? ` (${result.signal})` : ""}`;
      console.log(`[wm e2e] Retrying ${result.file} after ${reason}`);
    }
    results.push(result);
  }

  const passed = results.filter((result) => result.passed);
  const failed = results.filter((result) => !result.passed);

  console.log("\n=== E2E Summary ===");
  for (const result of results) {
    const status = result.passed
      ? "PASS"
      : result.timedOut
        ? "TIMEOUT"
        : "FAIL";
    const detail = result.timedOut
      ? `timed out after ${Math.round(FILE_TIMEOUT_MS / 1000)}s`
      : result.code == null
        ? "process error"
        : `exit ${result.code}${result.signal ? ` (${result.signal})` : ""}`;
    console.log(
      `${status.padEnd(7)} ${result.file} (${formatDuration(result.durationMs)}, attempt ${result.attempt}/${RETRY_COUNT + 1})${result.passed ? "" : ` — ${detail}`}`,
    );
  }

  console.log(`\n${passed.length}/${results.length} e2e file(s) passed.`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

await main();
