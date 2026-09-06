import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDiffForReview, getDiffSinceCommit, getUncommittedDiffForReview } from "../git-ops.js";

describe("review diff reads", () => {
  it("does not execute effective text converters or external diff programs", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wm-review-diff-"));
    const repo = path.join(directory, "repo");
    fs.mkdirSync(repo);
    const marker = path.join(directory, "executed");
    const program = path.join(directory, "diff.cjs");
    fs.writeFileSync(program, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed'); process.stdout.write('converted');`);
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim();
    try {
      git("init");
      git("config", "user.name", "Test");
      git("config", "user.email", "test@example.com");
      fs.writeFileSync(path.join(repo, ".gitattributes"), "*.txt diff=unsafe\n");
      fs.writeFileSync(path.join(repo, "source.txt"), "before\n");
      git("add", ".");
      git("commit", "-m", "initial");
      const initial = git("rev-parse", "HEAD");
      fs.writeFileSync(path.join(repo, "source.txt"), "after\n");
      git("add", ".");
      git("commit", "-m", "candidate");
      fs.writeFileSync(path.join(repo, "source.txt"), "dirty\n");
      const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(program)}`;
      git("config", "diff.unsafe.textconv", command);
      expect(getDiffForReview(repo, initial).diff).toContain("+after");
      expect(getDiffSinceCommit(repo, initial)).toContain("+after");
      expect(getUncommittedDiffForReview(repo).diff).toContain("+dirty");
      expect(fs.existsSync(marker)).toBe(false);
      git("diff", "HEAD");
      expect(fs.readFileSync(marker, "utf8")).toBe("executed"); // Effective positive control.
      fs.unlinkSync(marker);
      git("config", "diff.external", command);
      expect(getUncommittedDiffForReview(repo).diff).toContain("+dirty");
      expect(fs.existsSync(marker)).toBe(false);
      git("diff", "HEAD");
      expect(fs.readFileSync(marker, "utf8")).toBe("executed");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
