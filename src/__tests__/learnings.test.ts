import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createTempWorkerMillHome, type TempHome } from "./helpers/temp-workermill-home.js";

// Mock logger to avoid file writes
vi.mock("../logger.js", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

describe("learnings", () => {
  let tmp: TempHome;
  let fakeProjectDir: string;
  let expectedHash: string;
  let learningsFile: string;

  beforeEach(() => {
    tmp = createTempWorkerMillHome();
    fakeProjectDir = "/fake/learnings/project";
    expectedHash = crypto.createHash("md5").update(fakeProjectDir).digest("hex").slice(0, 8);
    learningsFile = path.join(tmp.homeDir, ".workermill", "projects", expectedHash, "learnings.json");

    vi.spyOn(process, "cwd").mockReturnValue(fakeProjectDir);
    vi.spyOn(fs, "realpathSync").mockReturnValue(fakeProjectDir);
    vi.resetModules();
  });

  afterEach(() => {
    tmp.restore();
    tmp.cleanup();
    vi.restoreAllMocks();
  });

  async function importLearnings() {
    return await import("../learnings.js");
  }

  describe("loadLearnings()", () => {
    it("returns empty array when no file exists", async () => {
      const { loadLearnings } = await importLearnings();
      expect(loadLearnings()).toEqual([]);
    });

    it("returns empty array when learnings directory does not exist", async () => {
      const { loadLearnings } = await importLearnings();
      // The learnings dir was never created — should not throw
      const result = loadLearnings();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });
  });

  describe("saveLearnings() + loadLearnings()", () => {
    it("writes JSON file and reads it back", async () => {
      const { saveLearnings, loadLearnings } = await importLearnings();

      saveLearnings(["always use const", "prefer early returns"]);

      expect(fs.existsSync(learningsFile)).toBe(true);

      const loaded = loadLearnings();
      expect(loaded).toEqual(["always use const", "prefer early returns"]);
    });

    it("creates learnings directory if it does not exist", async () => {
      const { saveLearnings } = await importLearnings();

      const learningsDir = path.dirname(learningsFile);
      expect(fs.existsSync(learningsDir)).toBe(false);

      saveLearnings(["a learning"]);

      expect(fs.existsSync(learningsDir)).toBe(true);
      expect(fs.existsSync(learningsFile)).toBe(true);
    });

    it("overwrites existing file on subsequent saves", async () => {
      const { saveLearnings, loadLearnings } = await importLearnings();

      saveLearnings(["first learning"]);
      saveLearnings(["second learning"]);

      const loaded = loadLearnings();
      expect(loaded).toEqual(["second learning"]);
    });

    it("saves an empty array without error", async () => {
      const { saveLearnings, loadLearnings } = await importLearnings();

      saveLearnings([]);
      const loaded = loadLearnings();
      expect(loaded).toEqual([]);
    });

    it("trims to max 50 entries keeping the newest (last) entries", async () => {
      const { saveLearnings, loadLearnings } = await importLearnings();

      // Build 60 entries: "learning 1" ... "learning 60"
      const all = Array.from({ length: 60 }, (_, i) => `learning ${i + 1}`);
      saveLearnings(all);

      const loaded = loadLearnings();
      expect(loaded).toHaveLength(50);
      // slice(-50) keeps the last 50, so "learning 11" through "learning 60"
      expect(loaded[0]).toBe("learning 11");
      expect(loaded[49]).toBe("learning 60");
    });

    it("does not trim when entries are exactly 50", async () => {
      const { saveLearnings, loadLearnings } = await importLearnings();

      const exactly50 = Array.from({ length: 50 }, (_, i) => `item ${i}`);
      saveLearnings(exactly50);

      const loaded = loadLearnings();
      expect(loaded).toHaveLength(50);
    });

    it("does not trim when fewer than 50 entries", async () => {
      const { saveLearnings, loadLearnings } = await importLearnings();

      const few = ["one", "two", "three"];
      saveLearnings(few);

      const loaded = loadLearnings();
      expect(loaded).toHaveLength(3);
    });
  });

  describe("mergeLearnings()", () => {
    it("deduplicates strings via Set", async () => {
      const { mergeLearnings } = await importLearnings();

      const existing = ["use const", "prefer early returns"];
      const newOnes = ["use const", "avoid any type"]; // "use const" is a duplicate

      const merged = mergeLearnings(existing, newOnes);

      // "use const" should appear only once
      expect(merged.filter((l) => l === "use const")).toHaveLength(1);
      expect(merged).toHaveLength(3);
    });

    it("preserves order: existing entries first, then new unique entries", async () => {
      const { mergeLearnings } = await importLearnings();

      const existing = ["alpha", "beta"];
      const newOnes = ["gamma", "alpha"]; // "alpha" already in existing

      const merged = mergeLearnings(existing, newOnes);

      expect(merged).toEqual(["alpha", "beta", "gamma"]);
    });

    it("returns existing entries unchanged when new list is empty", async () => {
      const { mergeLearnings } = await importLearnings();

      const existing = ["one", "two"];
      const merged = mergeLearnings(existing, []);

      expect(merged).toEqual(["one", "two"]);
    });

    it("returns new entries when existing list is empty", async () => {
      const { mergeLearnings } = await importLearnings();

      const merged = mergeLearnings([], ["alpha", "beta"]);

      expect(merged).toEqual(["alpha", "beta"]);
    });

    it("returns empty array when both lists are empty", async () => {
      const { mergeLearnings } = await importLearnings();

      expect(mergeLearnings([], [])).toEqual([]);
    });

    it("handles all-duplicate new entries", async () => {
      const { mergeLearnings } = await importLearnings();

      const existing = ["x", "y", "z"];
      const merged = mergeLearnings(existing, ["x", "y"]);

      expect(merged).toEqual(["x", "y", "z"]);
    });

    it("does not mutate the original arrays", async () => {
      const { mergeLearnings } = await importLearnings();

      const existing = ["a", "b"];
      const newOnes = ["c", "d"];
      const existingCopy = [...existing];
      const newCopy = [...newOnes];

      mergeLearnings(existing, newOnes);

      expect(existing).toEqual(existingCopy);
      expect(newOnes).toEqual(newCopy);
    });
  });
});
