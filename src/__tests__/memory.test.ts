import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTempWorkerMillHome, type TempHome } from "./helpers/temp-workermill-home.js";

// Mock logger to avoid file writes
vi.mock("../logger.js", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

describe("memory", () => {
  let tmp: TempHome;

  beforeEach(() => {
    tmp = createTempWorkerMillHome();
    vi.resetModules();
  });

  afterEach(() => {
    tmp.restore();
    tmp.cleanup();
  });

  async function importMemory() {
    return await import("../memory.js");
  }

  it("starts empty", async () => {
    const { loadMemories } = await importMemory();
    expect(loadMemories()).toEqual([]);
  });

  describe("addMemory()", () => {
    it("adds a learning memory", async () => {
      const { addMemory, loadMemories } = await importMemory();
      const mem = addMemory("learning", "TypeScript uses .ts extension");
      expect(mem.type).toBe("learning");
      expect(mem.content).toBe("TypeScript uses .ts extension");
      expect(mem.id).toBeTruthy();
      expect(mem.createdAt).toBeTruthy();

      const loaded = loadMemories();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].content).toBe("TypeScript uses .ts extension");
    });

    it("adds a preference memory", async () => {
      const { addMemory } = await importMemory();
      const mem = addMemory("preference", "Use tabs for indentation");
      expect(mem.type).toBe("preference");
    });

    it("adds a context memory", async () => {
      const { addMemory } = await importMemory();
      const mem = addMemory("context", "Project uses React 19");
      expect(mem.type).toBe("context");
    });

    it("adds a correction memory", async () => {
      const { addMemory } = await importMemory();
      const mem = addMemory("correction", "Never use var, always const/let");
      expect(mem.type).toBe("correction");
    });

    it("deduplicates by content", async () => {
      const { addMemory, loadMemories } = await importMemory();
      addMemory("learning", "same content");
      const dup = addMemory("learning", "same content");

      const loaded = loadMemories();
      expect(loaded).toHaveLength(1);
      expect(dup.content).toBe("same content");
    });

    it("persists provenance metadata with saved memories", async () => {
      process.env.WM_RUN_ID = "run-test123";
      process.env.WM_STORY_ID = "story-2";
      process.env.WM_PERSONA = "backend_engineer";

      try {
        const { addMemory, loadMemories } = await importMemory();
        addMemory("learning", "Use transactions for multi-step writes", undefined, undefined, undefined, {
          source: "agent",
          confidence: "high",
        });

        const loaded = loadMemories();
        expect(loaded).toHaveLength(1);
        expect(loaded[0].source).toBe("agent");
        expect(loaded[0].confidence).toBe("high");
        expect(loaded[0].runId).toBe("run-test123");
        expect(loaded[0].storyId).toBe("story-2");
        expect(loaded[0].persona).toBe("backend_engineer");
      } finally {
        delete process.env.WM_RUN_ID;
        delete process.env.WM_STORY_ID;
        delete process.env.WM_PERSONA;
      }
    });
  });

  describe("removeMemory()", () => {
    it("removes by content substring", async () => {
      const { addMemory, removeMemory, loadMemories } = await importMemory();
      addMemory("learning", "TypeScript uses .ts extension");
      addMemory("preference", "Use tabs");

      const removed = removeMemory("typescript");
      expect(removed).toBe(true);

      const loaded = loadMemories();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].type).toBe("preference");
    });

    it("removes by id", async () => {
      const { addMemory, removeMemory, loadMemories } = await importMemory();
      const mem = addMemory("learning", "some learning");
      const removed = removeMemory(mem.id);
      expect(removed).toBe(true);
      expect(loadMemories()).toHaveLength(0);
    });

    it("returns false when not found", async () => {
      const { removeMemory } = await importMemory();
      expect(removeMemory("nonexistent-id-that-does-not-match")).toBe(false);
    });
  });

  describe("extractMemoryMarkers()", () => {
    it("extracts ::learning:: markers", async () => {
      const { extractMemoryMarkers } = await importMemory();
      const text = "Some text ::learning::Always use strict mode in TypeScript";
      const markers = extractMemoryMarkers(text);

      expect(markers).toHaveLength(1);
      expect(markers[0].type).toBe("learning");
      expect(markers[0].content).toBe("Always use strict mode in TypeScript");
    });

    it("extracts ::remember:: markers as context type", async () => {
      const { extractMemoryMarkers } = await importMemory();
      const text = "Done! ::remember::This project uses Vitest for testing";
      const markers = extractMemoryMarkers(text);

      expect(markers).toHaveLength(1);
      expect(markers[0].type).toBe("context");
      expect(markers[0].content).toBe("This project uses Vitest for testing");
    });

    it("extracts multiple markers", async () => {
      const { extractMemoryMarkers } = await importMemory();
      const text =
        "::learning::Use ESM imports ::remember::Project root is /app ::learning::Tests in __tests__/";
      const markers = extractMemoryMarkers(text);

      expect(markers).toHaveLength(3);
      expect(markers.filter((m) => m.type === "learning")).toHaveLength(2);
      expect(markers.filter((m) => m.type === "context")).toHaveLength(1);
    });

    it("returns empty for text without markers", async () => {
      const { extractMemoryMarkers } = await importMemory();
      expect(extractMemoryMarkers("just regular text")).toEqual([]);
    });

    it("ignores empty markers", async () => {
      const { extractMemoryMarkers } = await importMemory();
      const markers = extractMemoryMarkers("::learning::   ");
      expect(markers).toHaveLength(0);
    });
  });

  describe("formatMemoriesForPrompt()", () => {
    it("returns empty string for no memories", async () => {
      const { formatMemoriesForPrompt } = await importMemory();
      expect(formatMemoriesForPrompt([])).toBe("");
    });

    it("formats memories by type", async () => {
      const { formatMemoriesForPrompt } = await importMemory();
      const memories = [
        { id: "1", type: "learning" as const, content: "Use ESM", createdAt: "2026-01-01" },
        { id: "2", type: "preference" as const, content: "Use tabs", createdAt: "2026-01-01" },
        { id: "3", type: "context" as const, content: "React project", createdAt: "2026-01-01" },
        { id: "4", type: "correction" as const, content: "Never use var", createdAt: "2026-01-01" },
      ];

      const formatted = formatMemoriesForPrompt(memories);
      expect(formatted).toContain("## Project Memory");
      expect(formatted).toContain("### Codebase Learnings");
      expect(formatted).toContain("### User Preferences");
      expect(formatted).toContain("### Project Context");
      expect(formatted).toContain("### Corrections (follow these)");
      expect(formatted).toContain("- Use ESM");
      expect(formatted).toContain("- Use tabs");
      expect(formatted).toContain("- React project");
      expect(formatted).toContain("- Never use var");
    });

    it("omits empty sections", async () => {
      const { formatMemoriesForPrompt } = await importMemory();
      const memories = [
        { id: "1", type: "learning" as const, content: "thing", createdAt: "2026-01-01" },
      ];
      const formatted = formatMemoriesForPrompt(memories);
      expect(formatted).toContain("### Codebase Learnings");
      expect(formatted).not.toContain("### User Preferences");
      expect(formatted).not.toContain("### Project Context");
      expect(formatted).not.toContain("### Corrections");
    });
  });
});
