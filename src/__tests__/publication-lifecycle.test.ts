import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CostTracker } from "../cost-tracker.js";
import { runCompletion } from "../orchestrator/completion.js";
import { captureRepositoryFingerprint } from "../repository-fingerprint.js";
import type { CliConfig } from "../config.js";

const roots: string[] = [];
const originalPath = process.env.PATH;

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function repository(branch = "feature/publication"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-publication-"));
  roots.push(dir);
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "fixture\n");
  git(dir, ["add", "README.md"]);
  git(dir, ["commit", "-m", "initial"]);
  git(dir, ["checkout", "-b", branch]);
  git(dir, ["remote", "add", "origin", "https://example.test/repo.git"]);
  return dir;
}

function config(): CliConfig {
  return {
    providers: { ollama: { model: "test", host: "http://127.0.0.1:1", contextLength: 4096 } },
    default: "ollama",
    review: { enabled: false },
    sandbox: false,
  };
}

function output() {
  return {
    log: vi.fn(),
    coordinatorLog: vi.fn(),
    error: vi.fn(),
    status: vi.fn(),
    statusDone: vi.fn(),
    confirm: vi.fn(async () => true),
    toolCall: vi.fn(),
    updateBranch: vi.fn(),
    updateCost: vi.fn(),
    updateUsageSummary: vi.fn(),
  };
}

function installFakePublicationCommands(realGit: string): { started: string; effects: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wm-publication-bin-"));
  roots.push(root);
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  const started = path.join(root, "push-started");
  const effects = path.join(root, "effects");
  const gitScript = `#!/bin/sh
if [ "$1" = "-c" ]; then shift 2; fi
if [ "$1" = "push" ]; then
  printf '%s\\n' "$*" >> "$WM_PUBLICATION_EFFECTS"
  if [ "$WM_PUBLICATION_PUSH_EXIT" = "1" ]; then exit 0; fi
  : > "$WM_PUBLICATION_STARTED"
  trap 'exit 143' TERM INT
  while :; do sleep 1; done
fi
exec "$WM_REAL_GIT" "$@"
`;
  const ghScript = `#!/bin/sh
printf 'gh %s\\n' "$*" >> "$WM_PUBLICATION_EFFECTS"
printf '%s\\n' 'https://example.test/pr/1'
`;
  fs.writeFileSync(path.join(bin, "git"), gitScript, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "gh"), ghScript, { mode: 0o755 });
  process.env.PATH = `${bin}${path.delimiter}${originalPath}`;
  process.env.WM_REAL_GIT = realGit;
  process.env.WM_PUBLICATION_STARTED = started;
  process.env.WM_PUBLICATION_EFFECTS = effects;
  return { started, effects };
}

afterEach(() => {
  process.env.PATH = originalPath;
  delete process.env.WM_REAL_GIT;
  delete process.env.WM_PUBLICATION_STARTED;
  delete process.env.WM_PUBLICATION_EFFECTS;
  delete process.env.WM_PUBLICATION_PUSH_EXIT;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("publication process lifecycle", () => {
  it("cancels a started push process group and prevents later PR/ticket effects", async () => {
    const dir = repository();
    const evidence = await captureRepositoryFingerprint(dir);
    if (!evidence.verified) throw new Error(evidence.reason);
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const files = installFakePublicationCommands(realGit);
    const controller = new AbortController();
    const ticketOps = { postComment: vi.fn(async () => undefined), transitionTo: vi.fn(async () => undefined) };
    const ui = output();
    const completion = runCompletion({
      config: config(),
      output: ui,
      sorted: [{ id: "s1", title: "fixture", persona: "backend_developer", description: "fixture" }],
      completedStoryIds: ["s1"],
      featureBranch: git(dir, ["branch", "--show-current"]),
      mainBranch: git(dir, ["branch", "--show-current"]),
      workingDir: dir,
      userTask: "literal body; no shell execution",
      costTracker: new CostTracker(),
      finalReviewText: "",
      ticketOps,
      resolvedTicketSystem: "linear",
      hooks: undefined,
      evidence: { fingerprint: evidence, gateResults: [], reviewOutcome: { kind: "disabled", approved: false } },
      abortSignal: controller.signal,
    });
    await vi.waitFor(() => expect(fs.existsSync(files.started)).toBe(true));
    controller.abort(new Error("test cancellation"));
    const result = await completion;

    expect(result.completionInvalidated).toBe(true);
    expect(ticketOps.transitionTo).not.toHaveBeenCalled();
    expect(ticketOps.postComment).not.toHaveBeenCalled();
    expect(fs.readFileSync(files.effects, "utf8")).not.toContain("gh ");
  });

  it("passes branch refs and PR bodies as literal arguments", async () => {
    const branch = "feature/literal;touch-not-executed";
    const dir = repository(branch);
    const evidence = await captureRepositoryFingerprint(dir);
    if (!evidence.verified) throw new Error(evidence.reason);
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const files = installFakePublicationCommands(realGit);
    const ui = output();
    process.env.WM_PUBLICATION_PUSH_EXIT = "1";
    const body = "body '; touch should-not-exist; #";
    await runCompletion({
      config: config(),
      output: ui,
      sorted: [{ id: "s1", title: body, persona: "backend_developer", description: "fixture" }],
      completedStoryIds: ["s1"],
      featureBranch: branch,
      mainBranch: branch,
      workingDir: dir,
      userTask: body,
      costTracker: new CostTracker(),
      finalReviewText: "",
      ticketOps: null,
      resolvedTicketSystem: "github",
      hooks: undefined,
      evidence: { fingerprint: evidence, gateResults: [], reviewOutcome: { kind: "disabled", approved: false } },
    });
    expect(fs.existsSync(path.join(dir, "should-not-exist"))).toBe(false);
    const effects = fs.readFileSync(files.effects, "utf8");
    expect(effects).toContain(branch);
    expect(effects).toContain(body);
  });
});
