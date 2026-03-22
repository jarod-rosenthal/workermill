import { execSync } from "child_process";

const REPO = "jarod-rosenthal/test";
const BASELINE_TAG = "e2e-baseline";

/**
 * Reset the test repo's main branch to the tagged baseline commit.
 * This removes all files/branches created by previous test runs.
 * The repo is dedicated to E2E testing — force push is safe.
 */
export async function resetRepoToBaseline(repo = REPO): Promise<void> {
  try {
    // Get baseline tag SHA
    const sha = execSync(
      `gh api repos/${repo}/git/ref/tags/${BASELINE_TAG} --jq '.object.sha' 2>/dev/null`,
      { encoding: "utf-8", timeout: 10000 },
    ).trim();
    if (!sha) throw new Error("Baseline tag not found");

    // Force-update main to the baseline SHA
    execSync(
      `gh api -X PATCH repos/${repo}/git/refs/heads/main -f sha="${sha}" -f force=true 2>/dev/null`,
      { encoding: "utf-8", timeout: 10000 },
    );

    // Clean up all story/* and INT-* branches
    await cleanupBranches("story/");

    // Close any open PRs (they're now orphaned)
    try {
      const prs = execSync(
        `gh pr list --repo ${repo} --state open --json number --jq '.[].number' 2>/dev/null`,
        { encoding: "utf-8", timeout: 10000 },
      ).trim();
      if (prs) {
        for (const num of prs.split("\n")) {
          execSync(`gh pr close ${num} --repo ${repo} 2>/dev/null`, { timeout: 5000 });
        }
      }
    } catch { /* best effort */ }
  } catch (err) {
    console.error(`Failed to reset repo to baseline: ${err}`);
    throw err;
  }
}

/**
 * Verify a branch exists on GitHub matching a pattern.
 * Uses `gh` CLI which is already authenticated.
 */
export async function verifyBranchExists(
  pattern: string,
  repo = REPO,
): Promise<{ name: string; sha: string } | null> {
  try {
    const output = execSync(
      `gh api repos/${repo}/branches --jq '.[] | select(.name | test("${pattern}")) | {name: .name, sha: .commit.sha}' 2>/dev/null`,
      { encoding: "utf-8", timeout: 10000 },
    ).trim();
    if (!output) return null;
    // Take first match
    const firstLine = output.split("\n")[0];
    return JSON.parse(firstLine);
  } catch {
    return null;
  }
}

/**
 * Verify a PR exists on GitHub for a branch pattern.
 */
export async function verifyPRExists(
  branchPattern: string,
  repo = REPO,
): Promise<{ number: number; title: string; url: string } | null> {
  try {
    const output = execSync(
      `gh pr list --repo ${repo} --state all --json number,title,url,headRefName --jq '.[] | select(.headRefName | test("${branchPattern}"))' 2>/dev/null`,
      { encoding: "utf-8", timeout: 10000 },
    ).trim();
    if (!output) return null;
    const firstLine = output.split("\n")[0];
    return JSON.parse(firstLine);
  } catch {
    return null;
  }
}

/**
 * Get diff stats for a branch vs main.
 */
export async function getBranchDiff(
  branch: string,
  repo = REPO,
): Promise<{ files: string[]; totalChanges: number } | null> {
  try {
    const output = execSync(
      `gh api repos/${repo}/compare/main...${branch} --jq '{files: [.files[].filename], totalChanges: (.files | map(.changes) | add)}' 2>/dev/null`,
      { encoding: "utf-8", timeout: 10000 },
    ).trim();
    if (!output) return null;
    return JSON.parse(output);
  } catch {
    return null;
  }
}

/**
 * Delete branches matching a pattern on GitHub.
 * Returns count of deleted branches.
 */
export async function cleanupBranches(
  pattern: string,
  repo = REPO,
): Promise<number> {
  try {
    const output = execSync(
      `gh api repos/${repo}/branches --jq '.[].name' 2>/dev/null`,
      { encoding: "utf-8", timeout: 10000 },
    ).trim();
    if (!output) return 0;

    const branches = output.split("\n").filter((b) => new RegExp(pattern).test(b));
    let deleted = 0;
    for (const branch of branches) {
      try {
        execSync(`gh api -X DELETE repos/${repo}/git/refs/heads/${branch} 2>/dev/null`, {
          timeout: 5000,
        });
        deleted++;
      } catch { /* branch may already be deleted */ }
    }
    return deleted;
  } catch {
    return 0;
  }
}

/**
 * Clone a branch into a temp dir, run commands, return results.
 */
export async function cloneAndRun(
  branch: string,
  commands: string[],
  repo = REPO,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const tmpDir = `/tmp/workermill-test-${Date.now()}`;
  try {
    execSync(`gh repo clone ${repo} ${tmpDir} -- -b ${branch} --depth 1 2>/dev/null`, {
      timeout: 30000,
    });

    let lastResult = { exitCode: 0, stdout: "", stderr: "" };
    for (const cmd of commands) {
      try {
        const stdout = execSync(cmd, {
          cwd: tmpDir,
          encoding: "utf-8",
          timeout: 120000,
          stdio: ["pipe", "pipe", "pipe"],
        });
        lastResult = { exitCode: 0, stdout, stderr: "" };
      } catch (err: unknown) {
        const e = err as { status?: number; stdout?: string; stderr?: string };
        lastResult = {
          exitCode: e.status || 1,
          stdout: e.stdout || "",
          stderr: e.stderr || "",
        };
        break; // Stop on first failure
      }
    }
    return lastResult;
  } finally {
    try { execSync(`rm -rf ${tmpDir}`, { timeout: 5000 }); } catch { /* best effort */ }
  }
}
