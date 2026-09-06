import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunManifest } from "../run-manifest.js";

const listRunManifestsMock = vi.fn();

vi.mock("../run-manifest.js", () => ({
  listRunManifests: (...args: unknown[]) => listRunManifestsMock(...args),
}));

import { runsLast, runsList, runsShow } from "../runs-command.js";

function makeRun(overrides: Partial<RunManifest> = {}): RunManifest {
  return {
    version: overrides.version ?? 2,
    id: overrides.id ?? "run-abc123",
    startedAt: overrides.startedAt ?? "2026-04-09T12:00:00.000Z",
    completedAt: overrides.completedAt,
    phase: overrides.phase ?? "active",
    terminalReason: overrides.terminalReason,
    userTask: overrides.userTask ?? "Implement feature",
    ticketKey: overrides.ticketKey,
    featureBranch: overrides.featureBranch ?? "feature/test",
    mainBranch: overrides.mainBranch ?? "main",
    outcome: overrides.outcome ?? "success",
    stories: overrides.stories ?? [
      { id: "s1", title: "Story 1", persona: "backend_developer", status: "completed", retryCount: 0 },
    ],
    plannedStories: overrides.plannedStories ?? [],
    attempts: overrides.attempts ?? [],
    gates: overrides.gates ?? [],
    reviews: overrides.reviews ?? [],
    totalCost: overrides.totalCost ?? 1.23,
    totalInputTokens: overrides.totalInputTokens ?? 100,
    totalOutputTokens: overrides.totalOutputTokens ?? 200,
  };
}

describe("runs-command", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    listRunManifestsMock.mockReset();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists recent runs as json", () => {
    listRunManifestsMock.mockReturnValue([
      makeRun({ id: "run-1" }),
      makeRun({ id: "run-2", outcome: "failed" }),
    ]);

    runsList({ json: true });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"id": "run-1"'));
  });

  it("uses stable JSON empty values for list and last", () => {
    listRunManifestsMock.mockReturnValue([]);
    runsList({ json: true });
    runsLast({ json: true });
    expect(logSpy).toHaveBeenNthCalledWith(1, "[]");
    expect(logSpy).toHaveBeenNthCalledWith(2, "null");
  });

  it("renders an active run as in-progress in JSON", () => {
    listRunManifestsMock.mockReturnValue([makeRun({ phase: "active", outcome: "in_progress" })]);
    runsList({ json: true });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"outcome": "in_progress"'));
  });

  it("shows a run by exact id in json mode", () => {
    listRunManifestsMock.mockReturnValue([
      makeRun({ id: "run-abc123" }),
      makeRun({ id: "run-def456" }),
    ]);

    runsShow("run-def456", { json: true });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"id": "run-def456"'));
  });

  it("shows the most recent run", () => {
    listRunManifestsMock.mockReturnValue([
      makeRun({ id: "run-latest", completedAt: "2026-04-09T12:05:00.000Z" }),
    ]);

    runsLast({});

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Build Run: run-latest"));
  });

  it("fails when a run prefix is ambiguous", () => {
    listRunManifestsMock.mockReturnValue([
      makeRun({ id: "run-abc111" }),
      makeRun({ id: "run-abc222" }),
    ]);

    expect(() => runsShow("run-abc", {})).toThrow("exit:1");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Run prefix "run-abc" is ambiguous.')
    );
  });

  it("fails when a run cannot be found", () => {
    listRunManifestsMock.mockReturnValue([makeRun({ id: "run-xyz" })]);

    expect(() => runsShow("run-missing", {})).toThrow("exit:1");
    expect(errorSpy).toHaveBeenCalledWith(
      'Run "run-missing" not found. Use `wm runs list` to see available runs.'
    );
  });
});
