import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { captureRepositoryFingerprint } from "../repository-fingerprint.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function fingerprint(cwd: string): Promise<string> {
  const result = await captureRepositoryFingerprint(cwd);
  expect(result.verified, result.verified ? undefined : result.reason).toBe(true);
  return result.verified ? result.digest : "";
}

describe("repository fingerprint", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "workermill-fingerprint-"));
    git(workspace, ["init", "-q"]);
    git(workspace, ["config", "user.email", "fingerprint@example.test"]);
    git(workspace, ["config", "user.name", "Fingerprint Test"]);
    fs.mkdirSync(path.join(workspace, "tracked"));
    fs.writeFileSync(path.join(workspace, "tracked", "file.txt"), "base\n");
    fs.writeFileSync(path.join(workspace, ".gitignore"), "ignored.txt\n");
    git(workspace, ["add", "."]);
    git(workspace, ["commit", "-qm", "base"]);
  });

  afterEach(() => fs.rmSync(workspace, { recursive: true, force: true }));

  it("distinguishes dirty, indexed, untracked, deleted, mode, and symlink state with the same HEAD", async () => {
    const base = await fingerprint(workspace);
    const head = git(workspace, ["rev-parse", "HEAD"]);

    fs.writeFileSync(path.join(workspace, "tracked", "file.txt"), "dirty\n");
    const dirty = await fingerprint(workspace);
    expect(dirty).not.toBe(base);
    expect(git(workspace, ["rev-parse", "HEAD"])).toBe(head);

    git(workspace, ["add", "tracked/file.txt"]);
    const indexed = await fingerprint(workspace);
    expect(indexed).not.toBe(dirty);
    expect(git(workspace, ["rev-parse", "HEAD"])).toBe(head);

    fs.writeFileSync(path.join(workspace, "new.txt"), "untracked\n");
    const untracked = await fingerprint(workspace);
    expect(untracked).not.toBe(indexed);

    fs.unlinkSync(path.join(workspace, "tracked", "file.txt"));
    const deleted = await fingerprint(workspace);
    expect(deleted).not.toBe(untracked);

    fs.writeFileSync(path.join(workspace, "tracked", "file.txt"), "dirty\n");
    fs.chmodSync(path.join(workspace, "tracked", "file.txt"), 0o755);
    const executable = await fingerprint(workspace);
    expect(executable).not.toBe(indexed);

    fs.symlinkSync("/outside/one", path.join(workspace, "outside-link"));
    const firstLink = await fingerprint(workspace);
    fs.unlinkSync(path.join(workspace, "outside-link"));
    fs.symlinkSync("/outside/two", path.join(workspace, "outside-link"));
    await expect(fingerprint(workspace)).resolves.not.toBe(firstLink);
  });

  it("is stable for ignored files and works from a repository subdirectory", async () => {
    const nested = path.join(workspace, "tracked");
    const before = await fingerprint(nested);
    fs.writeFileSync(path.join(workspace, "ignored.txt"), "ignored\n");
    await expect(fingerprint(nested)).resolves.toBe(before);
  });

  it("records nested tracked-directory deletions, including staged git rm", async () => {
    const before = await fingerprint(workspace);
    const head = git(workspace, ["rev-parse", "HEAD"]);
    git(workspace, ["rm", "-r", "-q", "tracked"]);
    expect(git(workspace, ["rev-parse", "HEAD"])).toBe(head);
    const deleted = await captureRepositoryFingerprint(workspace);
    expect(deleted.verified, deleted.verified ? undefined : deleted.reason).toBe(true);
    if (deleted.verified) expect(deleted.digest).not.toBe(before);
  });

  it("returns cancellation before resolving an impossible repository path", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await captureRepositoryFingerprint(path.join(workspace, "does-not-exist"), controller.signal);
    expect(result).toEqual({ verified: false, reason: "repository fingerprint cancelled" });
  });

  it("rejects Git work-tree redirection outside the caller's canonical directory", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "workermill-fingerprint-worktree-"));
    const originalGitDir = process.env.GIT_DIR;
    const originalGitWorkTree = process.env.GIT_WORK_TREE;
    try {
      process.env.GIT_DIR = path.join(workspace, ".git");
      process.env.GIT_WORK_TREE = outside;
      await expect(captureRepositoryFingerprint(workspace)).resolves.toMatchObject({
        verified: false,
        reason: "working directory is outside the resolved repository root",
      });
    } finally {
      if (originalGitDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = originalGitDir;
      if (originalGitWorkTree === undefined) delete process.env.GIT_WORK_TREE;
      else process.env.GIT_WORK_TREE = originalGitWorkTree;
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("does not execute configured Git filters while collecting evidence", async () => {
    const sentinel = path.join(workspace, "filter-ran");
    fs.writeFileSync(path.join(workspace, ".gitattributes"), "tracked/file.txt filter=inspect\n");
    fs.writeFileSync(path.join(workspace, "tracked", "file.txt"), "filter candidate\n");
    git(workspace, ["config", "filter.inspect.clean", `sh -c 'printf ran > ${JSON.stringify(sentinel)}; cat'`]);
    git(workspace, ["config", "filter.inspect.smudge", `sh -c 'printf ran > ${JSON.stringify(sentinel)}; cat'`]);
    await expect(fingerprint(workspace)).resolves.toMatch(/^[a-f0-9]{64}$/);
    expect(fs.existsSync(sentinel)).toBe(false);
    git(workspace, ["add", "tracked/file.txt"]);
    expect(fs.existsSync(sentinel)).toBe(true);
  });

  it("returns unverified for submodules, symlinked ancestors, and bounded files", async () => {
    const head = git(workspace, ["rev-parse", "HEAD"]);
    git(workspace, ["update-index", "--add", "--cacheinfo", `160000,${head},submodule`]);
    const submodule = await captureRepositoryFingerprint(workspace);
    expect(submodule).toMatchObject({ verified: false, reason: expect.stringMatching(/submodule/) });

    git(workspace, ["reset", "--hard", "-q", "HEAD"]);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "workermill-fingerprint-outside-"));
    try {
      fs.writeFileSync(path.join(outside, "file.txt"), "outside\n");
      fs.rmSync(path.join(workspace, "tracked"), { recursive: true });
      fs.symlinkSync(outside, path.join(workspace, "tracked"));
      const symlinkAncestor = await captureRepositoryFingerprint(workspace);
      expect(symlinkAncestor).toMatchObject({ verified: false, reason: expect.stringMatching(/symlink ancestor/) });
    } finally {
      fs.rmSync(path.join(workspace, "tracked"), { force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }

    fs.mkdirSync(path.join(workspace, "tracked"));
    fs.writeFileSync(path.join(workspace, "tracked", "file.txt"), Buffer.alloc(16 * 1024 * 1024 + 1));
    const bounded = await captureRepositoryFingerprint(workspace);
    expect(bounded).toMatchObject({ verified: false, reason: expect.stringMatching(/fingerprint limit/) });
  });
});
