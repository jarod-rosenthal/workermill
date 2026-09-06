import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareCandidate } from "../orchestrator/candidate.js";
import { getOSSandboxDependencyStatus } from "../sandbox-mode.js";

describe("candidate preparation process boundary", () => {
  it("allows an OS-scoped candidate commit but contains executable Git clean filters", async (context) => {
    const status = getOSSandboxDependencyStatus();
    if (!status.supported || status.errors.length) {
      const reason = status.errors.join(", ") || "unsupported platform";
      if (process.env.WM_REQUIRE_OS_SANDBOX === "1") throw new Error(reason);
      context.skip(reason);
      return;
    }
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wm-candidate-"));
    const repo = path.join(directory, "repo");
    fs.mkdirSync(repo);
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim();
    try {
      git("init");
      git("config", "user.name", "Test");
      git("config", "user.email", "test@example.com");
      git("commit", "--allow-empty", "-m", "initial");
      const initial = git("rev-parse", "HEAD");
      const args = {
        config: { providers: {}, default: "test" }, workingDir: repo,
        featureBranch: git("branch", "--show-current"), runId: "candidate-boundary",
        signal: new AbortController().signal, sandboxed: "os" as const,
      };
      fs.writeFileSync(path.join(repo, "source.txt"), "candidate\n");
      const allowed = await prepareCandidate(args);
      if (!allowed.prepared && /operation not permitted|unshare|unsupported/i.test(allowed.reason ?? "")) {
        if (process.env.WM_REQUIRE_OS_SANDBOX === "1") throw new Error(allowed.reason);
        context.skip(`OS sandbox kernel unavailable: ${allowed.reason}`);
        return;
      }
      expect(allowed).toEqual({ prepared: true });
      expect(git("rev-parse", "HEAD")).not.toBe(initial);
      expect(git("status", "--porcelain")).toBe("");

      const marker = path.join(directory, "outside-write");
      const program = path.join(directory, "filter.cjs");
      fs.writeFileSync(program, `const fs=require('node:fs'); const input=fs.readFileSync(0); fs.writeFileSync(${JSON.stringify(marker)}, 'escaped'); process.stdout.write(input);`);
      fs.writeFileSync(path.join(repo, ".gitattributes"), "*.txt filter=escape\n");
      fs.writeFileSync(path.join(repo, "source.txt"), "changed\n");
      git("config", "filter.escape.clean", `${JSON.stringify(process.execPath)} ${JSON.stringify(program)}`);
      git("config", "filter.escape.required", "true");
      expect((await prepareCandidate({ ...args, runId: "candidate-filter-denial" })).prepared).toBe(false);
      expect(fs.existsSync(marker)).toBe(false);
      git("add", "source.txt"); // Proves this filter is effective outside the boundary.
      expect(fs.readFileSync(marker, "utf8")).toBe("escaped");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
