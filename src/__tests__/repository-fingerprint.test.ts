import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { captureRepositoryFingerprint } from "../repository-fingerprint.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function fingerprint(cwd: string): string {
  const result = captureRepositoryFingerprint(cwd);
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

  it("distinguishes dirty, indexed, untracked, deleted, mode, and symlink state with the same HEAD", () => {
    const base = fingerprint(workspace);
    const head = git(workspace, ["rev-parse", "HEAD"]);

    fs.writeFileSync(path.join(workspace, "tracked", "file.txt"), "dirty\n");
    const dirty = fingerprint(workspace);
    expect(dirty).not.toBe(base);
    expect(git(workspace, ["rev-parse", "HEAD"])).toBe(head);

    git(workspace, ["add", "tracked/file.txt"]);
    const indexed = fingerprint(workspace);
    expect(indexed).not.toBe(dirty);
    expect(git(workspace, ["rev-parse", "HEAD"])).toBe(head);

    fs.writeFileSync(path.join(workspace, "new.txt"), "untracked\n");
    const untracked = fingerprint(workspace);
    expect(untracked).not.toBe(indexed);

    fs.unlinkSync(path.join(workspace, "tracked", "file.txt"));
    const deleted = fingerprint(workspace);
    expect(deleted).not.toBe(untracked);

    fs.writeFileSync(path.join(workspace, "tracked", "file.txt"), "dirty\n");
    fs.chmodSync(path.join(workspace, "tracked", "file.txt"), 0o755);
    const executable = fingerprint(workspace);
    expect(executable).not.toBe(indexed);

    fs.symlinkSync("/outside/one", path.join(workspace, "outside-link"));
    const firstLink = fingerprint(workspace);
    fs.unlinkSync(path.join(workspace, "outside-link"));
    fs.symlinkSync("/outside/two", path.join(workspace, "outside-link"));
    expect(fingerprint(workspace)).not.toBe(firstLink);
  });

  it("is stable for ignored files and works from a repository subdirectory", () => {
    const nested = path.join(workspace, "tracked");
    const before = fingerprint(nested);
    fs.writeFileSync(path.join(workspace, "ignored.txt"), "ignored\n");
    expect(fingerprint(nested)).toBe(before);
  });

  it("does not execute configured Git filters while collecting evidence", () => {
    const sentinel = path.join(workspace, "filter-ran");
    git(workspace, ["config", "filter.inspect.clean", `sh -c 'printf ran > ${JSON.stringify(sentinel)}; cat'`]);
    git(workspace, ["config", "filter.inspect.smudge", `sh -c 'printf ran > ${JSON.stringify(sentinel)}; cat'`]);
    expect(fingerprint(workspace)).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.existsSync(sentinel)).toBe(false);
  });

  it("returns unverified for submodules, symlinked ancestors, and bounded files", () => {
    const head = git(workspace, ["rev-parse", "HEAD"]);
    git(workspace, ["update-index", "--add", "--cacheinfo", `160000,${head},submodule`]);
    const submodule = captureRepositoryFingerprint(workspace);
    expect(submodule).toMatchObject({ verified: false, reason: expect.stringMatching(/submodule/) });

    git(workspace, ["reset", "--hard", "-q", "HEAD"]);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "workermill-fingerprint-outside-"));
    try {
      fs.writeFileSync(path.join(outside, "file.txt"), "outside\n");
      fs.rmSync(path.join(workspace, "tracked"), { recursive: true });
      fs.symlinkSync(outside, path.join(workspace, "tracked"));
      const symlinkAncestor = captureRepositoryFingerprint(workspace);
      expect(symlinkAncestor).toMatchObject({ verified: false, reason: expect.stringMatching(/symlink ancestor/) });
    } finally {
      fs.rmSync(path.join(workspace, "tracked"), { force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }

    fs.mkdirSync(path.join(workspace, "tracked"));
    fs.writeFileSync(path.join(workspace, "tracked", "file.txt"), Buffer.alloc(16 * 1024 * 1024 + 1));
    const bounded = captureRepositoryFingerprint(workspace);
    expect(bounded).toMatchObject({ verified: false, reason: expect.stringMatching(/fingerprint limit/) });
  });
});
