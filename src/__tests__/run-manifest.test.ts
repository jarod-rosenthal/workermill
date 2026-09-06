import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTempWorkerMillHome, type TempHome } from "./helpers/temp-workermill-home.js";
import {
  createRunManifest,
  getRunManifestPath,
  listRunManifests,
  loadRunManifest,
  saveRunManifest,
  type RunManifest,
} from "../run-manifest.js";

function terminalManifest(id: string, startedAt = "2026-01-01T00:00:00.000Z"): RunManifest {
  const completedAt = new Date(Date.parse(startedAt) + 60_000).toISOString();
  const attemptCompletedAt = new Date(Date.parse(startedAt) + 30_000).toISOString();
  return {
    ...createRunManifest("Implement a safe manifest", "T-1"),
    id, startedAt, phase: "terminal", completedAt, terminalReason: "success", outcome: "success",
    plannedStories: [{ id: "story:1", title: "Implement", persona: "backend_developer" }],
    attempts: [{ storyId: "story:1", attempt: 1, status: "completed", startedAt, completedAt: attemptCompletedAt, provider: "test", model: "fake", role: "worker" }],
    stories: [{ id: "story:1", title: "Implement", persona: "backend_developer", status: "completed", retryCount: 0 }],
  };
}

describe("run manifest storage", () => {
  let home: TempHome;
  let workspace: string;

  beforeEach(() => {
    home = createTempWorkerMillHome();
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "wm-manifest-workspace-"));
  });
  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
    home.restore();
    home.cleanup();
    vi.restoreAllMocks();
  });

  it("starts active rather than cancelled and atomically replaces a record with 0600 permissions", () => {
    const active = createRunManifest("Plan safely");
    expect(active.phase).toBe("active");
    expect(active.outcome).toBe("in_progress");
    saveRunManifest(active, workspace);
    const final = terminalManifest(active.id);
    saveRunManifest(final, workspace);
    expect(loadRunManifest(active.id, workspace)).toMatchObject({ phase: "terminal", terminalReason: "success" });
    const file = getRunManifestPath(active.id, workspace)!;
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("preserves the prior readable record when atomic replacement fails", () => {
    const manifest = terminalManifest("run-atomic-safe");
    saveRunManifest(manifest, workspace);
    const before = fs.readFileSync(getRunManifestPath(manifest.id, workspace)!, "utf8");
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => { throw new Error("interrupted rename"); });
    expect(() => saveRunManifest({ ...manifest, userTask: "new value" }, workspace)).toThrow("Failed to persist run manifest");
    expect(fs.readFileSync(getRunManifestPath(manifest.id, workspace)!, "utf8")).toBe(before);
  });

  it("rejects malicious IDs and inconsistent current records without writing outside runs", () => {
    const bad = terminalManifest("run-safe");
    bad.id = "../outside";
    expect(() => saveRunManifest(bad, workspace)).toThrow();
    expect(loadRunManifest("../outside", workspace)).toBeNull();
    const active = createRunManifest("still active");
    active.completedAt = "2026-01-01T00:01:00.000Z";
    expect(() => saveRunManifest(active, workspace)).toThrow();
  });

  it("skips malformed records, exposes legacy evidence limits, and orders before applying a limit", () => {
    const older = terminalManifest("run-old", "2026-01-01T00:00:00.000Z");
    const newer = terminalManifest("run-new", "2026-02-01T00:00:00.000Z");
    saveRunManifest(older, workspace);
    saveRunManifest(newer, workspace);
    const runsDir = path.dirname(getRunManifestPath(older.id, workspace)!);
    fs.writeFileSync(path.join(runsDir, "broken.json"), "{not json");
    fs.writeFileSync(path.join(runsDir, "run-legacy.json"), JSON.stringify({
      id: "run-legacy", startedAt: "2025-12-01T00:00:00.000Z", userTask: "old", outcome: "success", stories: [], gates: [], reviews: [], totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0,
    }));
    expect(listRunManifests(workspace, 1).map((run) => run.id)).toEqual(["run-new"]);
    const legacy = listRunManifests(workspace, 10).find((run) => run.id === "run-legacy");
    expect(legacy).toMatchObject({ version: 0, phase: "legacy", evidenceLimitation: "legacy_unverified" });
  });

  it("serializes only the bounded evidence allowlist", () => {
    const manifest = terminalManifest("run-allowlist");
    (manifest as RunManifest & { providerConfig?: { apiKey: string }; systemPrompt?: string }).providerConfig = { apiKey: "secret" };
    (manifest as RunManifest & { providerConfig?: { apiKey: string }; systemPrompt?: string }).systemPrompt = "do not persist";
    saveRunManifest(manifest, workspace);
    const stored = fs.readFileSync(getRunManifestPath(manifest.id, workspace)!, "utf8");
    expect(stored).not.toContain("secret");
    expect(stored).not.toContain("do not persist");
  });

  it("renders a persisted active record as in-progress JSON", async () => {
    const originalCwd = process.cwd();
    try {
      process.chdir(workspace);
      saveRunManifest(createRunManifest("Running build"));
      const output = vi.spyOn(console, "log").mockImplementation(() => {});
      const { runsList } = await import("../runs-command.js");
      runsList({ json: true });
      expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject([{ phase: "active", outcome: "in_progress" }]);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("rejects semantically inconsistent current records and unsupported versions", () => {
    const manifest = terminalManifest("run-semantic");
    saveRunManifest(manifest, workspace);
    const file = getRunManifestPath(manifest.id, workspace)!;
    const invalidGate = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    invalidGate.gates = [{ id: "gate:1", name: "test", source: "static", required: true, status: "passed", passed: false }];
    fs.writeFileSync(file, JSON.stringify(invalidGate));
    expect(loadRunManifest(manifest.id, workspace)).toBeNull();
    const unsupported = terminalManifest("run-unsupported");
    const unsupportedPath = getRunManifestPath(unsupported.id, workspace)!;
    fs.writeFileSync(unsupportedPath, JSON.stringify({ ...unsupported, version: 3 }));
    expect(loadRunManifest(unsupported.id, workspace)).toBeNull();
    const invalidReview = terminalManifest("run-review-invalid");
    invalidReview.reviews = [{ round: 1, provider: "test", model: "fake", outcome: { kind: "approved", approved: false } }];
    expect(() => saveRunManifest(invalidReview, workspace)).toThrow();
    const invalidFingerprint = terminalManifest("run-fingerprint-invalid");
    invalidFingerprint.fingerprint = { verified: true, algorithm: "sha256", head: "abc", digest: "def" };
    expect(() => saveRunManifest(invalidFingerprint, workspace)).toThrow();
  });

  it("rejects incomplete terminal attempts and duplicate attempts", () => {
    const manifest = terminalManifest("run-attempts");
    manifest.attempts[0].completedAt = undefined;
    expect(() => saveRunManifest(manifest, workspace)).toThrow();
    const duplicate = terminalManifest("run-attempt-duplicate");
    duplicate.attempts.push({ ...duplicate.attempts[0] });
    expect(() => saveRunManifest(duplicate, workspace)).toThrow();
  });

  it("skips oversized files, symlinks, and filenames whose ID does not match their record", () => {
    const manifest = terminalManifest("run-target");
    saveRunManifest(manifest, workspace);
    const runsDir = path.dirname(getRunManifestPath(manifest.id, workspace)!);
    fs.writeFileSync(path.join(runsDir, "run-huge.json"), Buffer.alloc(4 * 1024 * 1024 + 1));
    fs.symlinkSync(getRunManifestPath(manifest.id, workspace)!, path.join(runsDir, "run-link.json"));
    fs.writeFileSync(path.join(runsDir, "run-mismatch.json"), fs.readFileSync(getRunManifestPath(manifest.id, workspace)!));
    expect(listRunManifests(workspace, 10).map((run) => run.id)).toEqual(["run-target"]);
  });
});
