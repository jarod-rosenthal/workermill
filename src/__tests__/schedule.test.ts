import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTempWorkerMillHome, type TempHome } from "./helpers/temp-workermill-home.js";

// Mock logger to prevent file writes / noise
vi.mock("../logger.js", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

// Mock child_process to prevent actual cron installs
vi.mock("child_process", () => ({
  execFileSync: vi.fn().mockReturnValue(""),
}));

describe("schedule", () => {
  let tmp: TempHome;

  beforeEach(() => {
    tmp = createTempWorkerMillHome();
    vi.resetModules();
  });

  afterEach(() => {
    tmp.restore();
    tmp.cleanup();
    vi.clearAllMocks();
  });

  async function importSchedule() {
    return await import("../schedule.js");
  }

  // ---------------------------------------------------------------------------
  // parseCron — tested indirectly through createSchedule
  // A successful parse → success:true. A failed parse → success:false.
  // ---------------------------------------------------------------------------

  describe("parseCron (via createSchedule)", () => {
    it("passes a direct 5-part cron expression through unchanged", async () => {
      const { createSchedule, listSchedules } = await importSchedule();
      const result = createSchedule("direct", "do thing", "0 9 * * *", "/tmp");
      expect(result.success).toBe(true);
      const [task] = listSchedules();
      expect(task.cron).toBe("0 9 * * *");
    });

    it("parses 'every hour' → '0 * * * *'", async () => {
      const { createSchedule, listSchedules } = await importSchedule();
      createSchedule("t", "p", "every hour", "/tmp");
      expect(listSchedules()[0].cron).toBe("0 * * * *");
    });

    it("parses 'daily' → '0 9 * * *'", async () => {
      const { createSchedule, listSchedules } = await importSchedule();
      createSchedule("t", "p", "daily", "/tmp");
      expect(listSchedules()[0].cron).toBe("0 9 * * *");
    });

    it("parses 'every monday' → '0 9 * * 1'", async () => {
      const { createSchedule, listSchedules } = await importSchedule();
      createSchedule("t", "p", "every monday", "/tmp");
      expect(listSchedules()[0].cron).toBe("0 9 * * 1");
    });

    it("parses 'every 30 minutes' → '*/30 * * * *'", async () => {
      const { createSchedule, listSchedules } = await importSchedule();
      createSchedule("t", "p", "every 30 minutes", "/tmp");
      expect(listSchedules()[0].cron).toBe("*/30 * * * *");
    });

    it("parses 'every 2 hours' → '0 */2 * * *'", async () => {
      const { createSchedule, listSchedules } = await importSchedule();
      createSchedule("t", "p", "every 2 hours", "/tmp");
      expect(listSchedules()[0].cron).toBe("0 */2 * * *");
    });

    it("parses 'at 3pm' → '0 15 * * *'", async () => {
      const { createSchedule, listSchedules } = await importSchedule();
      createSchedule("t", "p", "at 3pm", "/tmp");
      expect(listSchedules()[0].cron).toBe("0 15 * * *");
    });

    it("parses 'at 12am' → '0 0 * * *'", async () => {
      const { createSchedule, listSchedules } = await importSchedule();
      createSchedule("t", "p", "at 12am", "/tmp");
      expect(listSchedules()[0].cron).toBe("0 0 * * *");
    });

    it("parses 'at 10:30' → '30 10 * * *'", async () => {
      const { createSchedule, listSchedules } = await importSchedule();
      createSchedule("t", "p", "at 10:30", "/tmp");
      expect(listSchedules()[0].cron).toBe("30 10 * * *");
    });

    it("returns failure for an unparseable schedule string", async () => {
      const { createSchedule } = await importSchedule();
      const result = createSchedule("t", "p", "whenever I feel like it", "/tmp");
      expect(result.success).toBe(false);
      expect(result.message).toContain("whenever I feel like it");
    });
  });

  // ---------------------------------------------------------------------------
  // createSchedule
  // ---------------------------------------------------------------------------

  describe("createSchedule()", () => {
    it("saves task to schedules.json and returns success", async () => {
      const { createSchedule, listSchedules } = await importSchedule();
      const result = createSchedule("nightly-check", "run tests", "every night", "/projects/app");

      expect(result.success).toBe(true);
      expect(result.message).toContain("nightly-check");

      const saved = listSchedules();
      expect(saved).toHaveLength(1);
      expect(saved[0].name).toBe("nightly-check");
      expect(saved[0].prompt).toBe("run tests");
      expect(saved[0].cron).toBe("0 22 * * *");
      expect(saved[0].workingDir).toBe("/projects/app");
      expect(saved[0].id).toBeTruthy();
      expect(saved[0].createdAt).toBeTruthy();
    });

    it("accumulates multiple tasks across calls", async () => {
      const { createSchedule, listSchedules } = await importSchedule();
      createSchedule("task-a", "prompt a", "hourly", "/a");
      createSchedule("task-b", "prompt b", "daily", "/b");

      const saved = listSchedules();
      expect(saved).toHaveLength(2);
      expect(saved.map(s => s.name)).toEqual(["task-a", "task-b"]);
    });
  });

  // ---------------------------------------------------------------------------
  // listSchedules
  // ---------------------------------------------------------------------------

  describe("listSchedules()", () => {
    it("returns empty array when no schedules exist", async () => {
      const { listSchedules } = await importSchedule();
      expect(listSchedules()).toEqual([]);
    });

    it("returns previously saved schedules", async () => {
      const { createSchedule, listSchedules } = await importSchedule();
      createSchedule("my-task", "do something", "weekly", "/home/user/project");

      const tasks = listSchedules();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].name).toBe("my-task");
    });
  });

  // ---------------------------------------------------------------------------
  // deleteSchedule
  // ---------------------------------------------------------------------------

  describe("deleteSchedule()", () => {
    it("removes a schedule by name (case-insensitive)", async () => {
      const { createSchedule, deleteSchedule, listSchedules } = await importSchedule();
      createSchedule("My Task", "run build", "daily", "/tmp");

      const result = deleteSchedule("my task");
      expect(result.success).toBe(true);
      expect(result.message).toContain("My Task");
      expect(listSchedules()).toHaveLength(0);
    });

    it("removes a schedule by id", async () => {
      const { createSchedule, deleteSchedule, listSchedules } = await importSchedule();
      createSchedule("id-task", "prompt", "every hour", "/tmp");

      const [task] = listSchedules();
      const result = deleteSchedule(task.id);

      expect(result.success).toBe(true);
      expect(listSchedules()).toHaveLength(0);
    });

    it("returns failure when the schedule does not exist", async () => {
      const { deleteSchedule } = await importSchedule();
      const result = deleteSchedule("ghost-schedule");
      expect(result.success).toBe(false);
      expect(result.message).toContain("ghost-schedule");
    });

    it("leaves remaining schedules intact after deletion", async () => {
      const { createSchedule, deleteSchedule, listSchedules } = await importSchedule();
      createSchedule("keep-me", "stay", "daily", "/a");
      createSchedule("remove-me", "go", "hourly", "/b");

      deleteSchedule("remove-me");

      const remaining = listSchedules();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].name).toBe("keep-me");
    });
  });
});
