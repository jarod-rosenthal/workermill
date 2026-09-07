import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createTempWorkerMillHome, type TempHome } from "./helpers/temp-workermill-home.js";
import type { Session } from "../session.js";

describe("stats-command", () => {
  let tmp: TempHome;
  let originalCwd: string;

  beforeEach(() => {
    tmp = createTempWorkerMillHome();
    originalCwd = process.cwd();
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-08T12:00:00Z"));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.useRealTimers();
    vi.restoreAllMocks();
    tmp.restore();
    tmp.cleanup();
  });

  async function importModules() {
    const stats = await import("../stats-command.js");
    const projectData = await import("../project-data.js");
    return { ...stats, ...projectData };
  }

  async function writeSessionFixture(cwd: string, session: Session): Promise<void> {
    fs.mkdirSync(cwd, { recursive: true });
    const { ensureProjectDirs, getProjectSessionsDir, saveProjectMeta } = await importModules();

    ensureProjectDirs(cwd);
    saveProjectMeta(
      {
        canonicalPath: cwd,
        lastAccessed: new Date().toISOString(),
        version: "1.0",
      },
      cwd,
    );

    const sessionsDir = getProjectSessionsDir(cwd);
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, `${session.id}.json`), JSON.stringify(session, null, 2), "utf-8");
  }

  function makeSession(overrides: Partial<Session> = {}): Session {
    const startedAt = overrides.startedAt ?? "2026-04-07T12:00:00.000Z";
    return {
      id: overrides.id ?? crypto.randomUUID(),
      messages: overrides.messages ?? [],
      cwd: overrides.cwd,
      provider: overrides.provider ?? "openai",
      model: overrides.model ?? "gpt-5.4",
      startedAt,
      updatedAt: overrides.updatedAt ?? startedAt,
      totalTokens: overrides.totalTokens ?? 0,
      totalCostUsd: overrides.totalCostUsd,
      costByModel: overrides.costByModel,
      costByRole: overrides.costByRole,
      usageLedger: overrides.usageLedger,
      usageLedgerHistoryIncomplete: overrides.usageLedgerHistoryIncomplete,
      name: overrides.name,
      finishedAt: overrides.finishedAt,
    };
  }

  async function captureStats(options: {
    days?: string;
    all?: boolean;
    cwd?: boolean;
    json?: boolean;
  }): Promise<string> {
    const { runStatsCommand } = await importModules();
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };

    try {
      runStatsCommand(options);
    } finally {
      console.log = originalLog;
    }

    return lines.join("\n");
  }

  it("preserves old totals with a partial model breakdown and exposes unknown pricing in JSON", async () => {
    const { CostTracker } = await import("../cost-tracker.js");
    const tracker = new CostTracker();
    tracker.recordCall({ callId: "unknown", persona: "worker", provider: "unknown", model: "custom", usage: { inputTokens: 2, outputTokens: 3 } });
    const projectDir = path.join(tmp.homeDir, "ledger-history");
    await writeSessionFixture(projectDir, makeSession({
      totalTokens: 105, totalCostUsd: 1, usageLedger: tracker.getLedgerSnapshot(),
      costByModel: [{ key: "unknown/custom", provider: "unknown", model: "custom", inputTokens: 2, outputTokens: 3, costUsd: 0, roles: ["worker"] }],
    }));
    const stats = JSON.parse(await captureStats({ json: true }));
    expect(stats.tokens.total_tokens).toBe(105);
    expect(stats.cost_usd).toBe(1);
    expect(stats.estimate_limitations.join(" ")).toMatch(/unknown-priced.*historical/);
    expect(await captureStats({})).toContain("unknown-priced");
  });

  it("returns empty stats when there are no project sessions", async () => {
    const output = await captureStats({ json: true });
    const stats = JSON.parse(output);

    expect(stats.sessions.total).toBe(0);
    expect(stats.sessions.with_cost_data).toBe(0);
    expect(stats.tokens.total_tokens).toBe(0);
    expect(stats.cost_usd).toBe(0);
    expect(stats.by_model).toEqual([]);
    expect(stats.by_project).toEqual([]);
  });

  it("uses cost breakdown tokens and excludes sessions older than 30 days by default", async () => {
    const projectDir = path.join(tmp.homeDir, "repo-a");

    await writeSessionFixture(
      projectDir,
      makeSession({
        id: "recent-costed",
        cwd: projectDir,
        startedAt: "2026-04-06T08:00:00.000Z",
        totalTokens: 999,
        totalCostUsd: 0.25,
        costByModel: [
          {
            key: "openai/gpt-5.4",
            provider: "openai",
            model: "gpt-5.4",
            inputTokens: 30,
            outputTokens: 70,
            costUsd: 0.25,
            roles: ["worker"],
          },
        ],
        costByRole: {
          worker: { inputTokens: 30, outputTokens: 70, costUsd: 0.25 },
          planner: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          reviewer: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        },
      }),
    );

    await writeSessionFixture(
      projectDir,
      makeSession({
        id: "old-costed",
        cwd: projectDir,
        startedAt: "2026-02-01T08:00:00.000Z",
        totalTokens: 777,
        totalCostUsd: 0.5,
        costByModel: [
          {
            key: "openai/gpt-5.4",
            provider: "openai",
            model: "gpt-5.4",
            inputTokens: 300,
            outputTokens: 400,
            costUsd: 0.5,
            roles: ["worker"],
          },
        ],
      }),
    );

    const jsonOutput = await captureStats({ json: true });
    const stats = JSON.parse(jsonOutput);

    expect(stats.sessions.total).toBe(1);
    expect(stats.sessions.with_cost_data).toBe(1);
    expect(stats.tokens.input_tokens).toBe(30);
    expect(stats.tokens.output_tokens).toBe(70);
    expect(stats.tokens.total_tokens).toBe(100);
    expect(stats.cost_usd).toBe(0.25);
    expect(stats.by_model).toEqual([
      expect.objectContaining({
        key: "openai/gpt-5.4",
        input_tokens: 30,
        output_tokens: 70,
        cost_usd: 0.25,
      }),
    ]);

    const humanOutput = await captureStats({});
    expect(humanOutput).toContain("WorkerMill Usage — last 30 days");
    expect(humanOutput).toContain("Sessions          1");
    expect(humanOutput).toContain("Total tokens     100 (30 in / 70 out)");
  });

  it("includes older sessions when --all is used", async () => {
    const projectDir = path.join(tmp.homeDir, "repo-b");

    await writeSessionFixture(
      projectDir,
      makeSession({
        id: "recent",
        cwd: projectDir,
        startedAt: "2026-04-07T09:00:00.000Z",
        totalTokens: 10,
        totalCostUsd: 0.1,
        costByModel: [
          {
            key: "openai/gpt-5.4",
            provider: "openai",
            model: "gpt-5.4",
            inputTokens: 4,
            outputTokens: 6,
            costUsd: 0.1,
            roles: ["worker"],
          },
        ],
      }),
    );

    await writeSessionFixture(
      projectDir,
      makeSession({
        id: "older",
        cwd: projectDir,
        startedAt: "2026-01-15T09:00:00.000Z",
        totalTokens: 20,
        totalCostUsd: 0.2,
        costByModel: [
          {
            key: "openai/gpt-5.4",
            provider: "openai",
            model: "gpt-5.4",
            inputTokens: 8,
            outputTokens: 12,
            costUsd: 0.2,
            roles: ["planner"],
          },
        ],
      }),
    );

    const stats = JSON.parse(await captureStats({ all: true, json: true }));

    expect(stats.sessions.total).toBe(2);
    expect(stats.sessions.with_cost_data).toBe(2);
    expect(stats.tokens.total_tokens).toBe(30);
    expect(stats.cost_usd).toBe(0.3);
    expect(stats.period.from).toBe("2026-01-15");
    expect(stats.period.to).toBe("2026-04-07");
  });

  it("scopes results to the current working directory with --cwd", async () => {
    const projectDirA = path.join(tmp.homeDir, "repo-c");
    const projectDirB = path.join(tmp.homeDir, "repo-d");

    await writeSessionFixture(
      projectDirA,
      makeSession({
        id: "project-a-session",
        cwd: projectDirA,
        startedAt: "2026-04-07T10:00:00.000Z",
        totalTokens: 100,
        totalCostUsd: 0.15,
        costByModel: [
          {
            key: "openai/gpt-5.4",
            provider: "openai",
            model: "gpt-5.4",
            inputTokens: 40,
            outputTokens: 60,
            costUsd: 0.15,
            roles: ["worker"],
          },
        ],
      }),
    );

    await writeSessionFixture(
      projectDirB,
      makeSession({
        id: "project-b-session",
        cwd: projectDirB,
        startedAt: "2026-04-07T11:00:00.000Z",
        totalTokens: 200,
        totalCostUsd: 0.35,
        costByModel: [
          {
            key: "openai/gpt-5.4-mini",
            provider: "openai",
            model: "gpt-5.4-mini",
            inputTokens: 90,
            outputTokens: 110,
            costUsd: 0.35,
            roles: ["worker"],
          },
        ],
      }),
    );

    process.chdir(projectDirA);
    const scopedStats = JSON.parse(await captureStats({ cwd: true, json: true }));
    expect(scopedStats.sessions.total).toBe(1);
    expect(scopedStats.cost_usd).toBe(0.15);
    expect(scopedStats.by_project).toEqual([
      expect.objectContaining({ cwd: projectDirA, sessions: 1 }),
    ]);

    const globalStats = JSON.parse(await captureStats({ json: true }));
    expect(globalStats.sessions.total).toBe(2);
    expect(globalStats.cost_usd).toBe(0.5);
  });

  it("matches --cwd across a symlinked path", async () => {
    // process.cwd() returns a fully resolved path, but sessions store whatever
    // path the CLI was handed. On macOS /var is a symlink to /private/var, so
    // raw string equality never matches. Regression test for that comparison.
    const realDir = path.join(tmp.homeDir, "real-repo");
    fs.mkdirSync(realDir, { recursive: true });
    const linkDir = path.join(tmp.homeDir, "linked-repo");
    fs.symlinkSync(realDir, linkDir, "dir");

    // Session recorded under the symlinked path...
    await writeSessionFixture(
      linkDir,
      makeSession({ id: "symlinked-session", cwd: linkDir, startedAt: "2026-04-07T10:00:00.000Z", totalCostUsd: 0.2 }),
    );

    // ...but we run --cwd from the real path.
    process.chdir(realDir);
    const stats = JSON.parse(await captureStats({ cwd: true, json: true }));
    expect(stats.sessions.total).toBe(1);
  });

  it("includes a matching session even when project meta records a different path", async () => {
    // Regression: the project-level filter had an empty "it matches" branch that
    // fell through to an unconditional `continue`, so a project whose meta.json
    // path did not match was skipped even when its sessions did match.
    const projectDir = path.join(tmp.homeDir, "repo-e");
    await writeSessionFixture(
      projectDir,
      makeSession({ id: "meta-mismatch", cwd: projectDir, startedAt: "2026-04-07T10:00:00.000Z", totalCostUsd: 0.4 }),
    );

    // Point the project's meta.json somewhere else entirely.
    const { getProjectRootDir } = await importModules();
    const metaPath = path.join(getProjectRootDir(projectDir), "meta.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    meta.canonicalPath = path.join(tmp.homeDir, "somewhere-else");
    fs.writeFileSync(metaPath, JSON.stringify(meta), "utf-8");

    process.chdir(projectDir);
    const stats = JSON.parse(await captureStats({ cwd: true, json: true }));
    expect(stats.sessions.total).toBe(1);
    expect(stats.cost_usd).toBe(0.4);
  });

  it("keeps sessions from other directories out of a --cwd run", async () => {
    const mine = path.join(tmp.homeDir, "repo-mine");
    const theirs = path.join(tmp.homeDir, "repo-theirs");
    await writeSessionFixture(mine, makeSession({ id: "mine", cwd: mine, startedAt: "2026-04-07T10:00:00.000Z", totalCostUsd: 0.1 }));
    await writeSessionFixture(theirs, makeSession({ id: "theirs", cwd: theirs, startedAt: "2026-04-07T11:00:00.000Z", totalCostUsd: 0.9 }));

    process.chdir(mine);
    const stats = JSON.parse(await captureStats({ cwd: true, json: true }));
    expect(stats.sessions.total).toBe(1);
    expect(stats.cost_usd).toBe(0.1);
  });

  it("counts legacy sessions without cost data and shows the note in human output", async () => {
    const projectDir = path.join(tmp.homeDir, "repo-e");

    await writeSessionFixture(
      projectDir,
      makeSession({
        id: "with-cost",
        cwd: projectDir,
        startedAt: "2026-04-07T09:00:00.000Z",
        totalTokens: 50,
        totalCostUsd: 0.05,
        costByModel: [
          {
            key: "openai/gpt-5.4",
            provider: "openai",
            model: "gpt-5.4",
            inputTokens: 20,
            outputTokens: 30,
            costUsd: 0.05,
            roles: ["worker"],
          },
        ],
      }),
    );

    await writeSessionFixture(
      projectDir,
      makeSession({
        id: "legacy-no-cost",
        cwd: projectDir,
        startedAt: "2026-04-07T10:00:00.000Z",
        totalTokens: 25,
      }),
    );

    const stats = JSON.parse(await captureStats({ json: true }));
    expect(stats.sessions.total).toBe(2);
    expect(stats.sessions.with_cost_data).toBe(1);
    expect(stats.cost_usd).toBe(0.05);
    expect(stats.tokens.total_tokens).toBe(75);

    const humanOutput = await captureStats({});
    expect(humanOutput).toContain("Sessions          2");
    expect(humanOutput).toContain("(Note: 1 session(s) have no cost data)");
  });
});
