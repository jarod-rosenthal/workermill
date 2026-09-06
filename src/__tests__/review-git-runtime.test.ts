import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createReviewGit } from "../orchestrator/git-context.js";
import { getOSSandboxDependencyStatus } from "../sandbox-mode.js";

describe("owned review Git context", () => {
  let root: string;
  let workspace: string;
  const git = (...args: string[]) => execFileSync("git", args, { cwd: workspace, encoding: "utf8", stdio: "pipe" }).trim();
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wm-review-git-")));
    workspace = path.join(root, "repo");
    fs.mkdirSync(workspace);
    git("init"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
    fs.writeFileSync(path.join(workspace, "source.txt"), "before\n");
    git("add", "."); git("commit", "-m", "initial");
  });
  afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

  it("treats shell metacharacters in real branch names literally", async () => {
    const branch = "base;touch${IFS}escaped;#";
    git("branch", branch);
    fs.writeFileSync(path.join(workspace, "source.txt"), "after\n");
    git("add", "."); git("commit", "-m", "change\n\nStory: S1");
    const context = createReviewGit({ workingDir: workspace, runId: "literal-branch", sandboxed: true });
    expect((await context.branchDiff(branch)).diff).toContain("+after");
    expect(await context.priorWork(branch, 1)).toContain("source.txt");
    expect(fs.existsSync(path.join(workspace, "escaped"))).toBe(false);
  });

  it("cancels an already-started history process before reading subsequent commits", async () => {
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const wrapper = path.join(root, "git");
    const started = path.join(root, "started.pid");
    fs.writeFileSync(wrapper, ["#!/bin/sh", "for arg in \"$@\"; do",
      `if [ \"$arg\" = log ]; then echo $$ > '${started}'; while :; do sleep 1; done; fi`,
      "done", `exec '${realGit}' \"$@\"`, ""].join("\n"), { mode: 0o755 });
    vi.stubEnv("PATH", `${root}${path.delimiter}${process.env.PATH}`);
    const controller = new AbortController();
    const context = createReviewGit({ workingDir: workspace, runId: "cancel-history", signal: controller.signal, sandboxed: true });
    const pending = context.priorWork("HEAD", 1);
    const rejected = expect(pending).rejects.toThrow("history cancelled");
    await vi.waitFor(() => expect(fs.existsSync(started)).toBe(true));
    const pid = Number(fs.readFileSync(started, "utf8"));
    controller.abort(new Error("history cancelled"));
    await rejected;
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("contains effective clean filters while reading an OS-scoped uncommitted diff", async (test) => {
    const status = getOSSandboxDependencyStatus();
    if (!status.supported || status.errors.length) {
      const reason = status.errors.join(", ") || "OS runtime unsupported";
      if (process.env.WM_REQUIRE_OS_SANDBOX === "1") throw new Error(reason);
      test.skip(reason); return;
    }
    const escaped = path.join(root, "escaped");
    const ran = path.join(workspace, "filter-ran");
    fs.writeFileSync(path.join(workspace, ".gitattributes"), "source.txt filter=review\n");
    git("config", "filter.review.clean", `printf ran > '${ran}'; printf escaped > '${escaped}'; cat`);
    fs.writeFileSync(path.join(workspace, "source.txt"), "changed\n");
    git("diff", "HEAD");
    expect(fs.readFileSync(escaped, "utf8")).toBe("escaped");
    fs.unlinkSync(escaped); fs.unlinkSync(ran);
    const context = createReviewGit({ workingDir: workspace, runId: "os-review-filter", sandboxed: "os" });
    expect((await context.uncommitted()).diff).toContain("+changed");
    expect(fs.readFileSync(ran, "utf8")).toBe("ran");
    expect(fs.existsSync(escaped)).toBe(false);
  });
});
