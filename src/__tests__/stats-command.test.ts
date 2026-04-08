/**
 * E2E tests for `wm stats` command output format.
 *
 * Tests verify that usage data is correctly recorded and the wm stats command
 * provides accurate summaries across different scenarios: empty history,
 * 30-day window, --json output.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { createTempWorkerMillHome, type TempHome } from "./helpers/temp-workermill-home.js";
import { handleStatsCommand } from "../stats-command.js";
import type { Session } from "../session.js";

// Mock process.exit to prevent test termination
vi.spyOn(process, "exit").mockImplementation(() => {
  // Do nothing
});

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

let tempHome: TempHome;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a project directory structure and return the project ID
 */
function createProject(cwd: string): string {
  const projectId = crypto.createHash("md5").update(cwd).digest("hex").slice(0, 8);
  const projectsDir = path.join(tempHome.wmDir, "projects");
  const projectDir = path.join(projectsDir, projectId);
  const sessionsDir = path.join(projectDir, "sessions");
  const metaPath = path.join(projectDir, "meta.json");

  fs.mkdirSync(projectsDir, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(sessionsDir, { recursive: true });

  // Create meta.json
  const meta = {
    canonicalPath: cwd,
    lastAccessed: new Date().toISOString(),
    version: "1.0",
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");

  return projectId;
}

/**
 * Create a mock session object
 */
function createSession(session: Partial<Session>): Session {
  return {
    id: session.id || crypto.randomUUID(),
    name: session.name,
    cwd: session.cwd,
    messages: session.messages || [],
    provider: session.provider || "anthropic",
    model: session.model || "claude-sonnet-4-6",
    startedAt: session.startedAt || new Date().toISOString(),
    updatedAt: session.updatedAt || new Date().toISOString(),
    finishedAt: session.finishedAt,
    totalTokens: session.totalTokens || 0,
    totalCostUsd: session.totalCostUsd,
    costByModel: session.costByModel,
    costByRole: session.costByRole,
  };
}

/**
 * Create a session file in the temp home
 */
function createSessionFile(projectId: string, session: Session): void {
  const sessionsDir = path.join(tempHome.wmDir, "projects", projectId, "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  const filePath = path.join(sessionsDir, `${session.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2), "utf-8");
}

/**
 * Capture console.log output as lines
 */
function captureOutput(fn: () => void): string[] {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  try {
    fn();
    return lines;
  } finally {
    console.log = orig;
  }
}

/**
 * Setup test sessions with cost data
 */
function setupTestSessions(sessions: Partial<Session>[]): void {
  const projectMap = new Map<string, string>();
  const defaultCwd = "/test/project";

  for (const sessionData of sessions) {
    const cwd = sessionData.cwd || defaultCwd;
    let projectId = projectMap.get(cwd);
    if (!projectId) {
      projectId = createProject(cwd);
      projectMap.set(cwd, projectId);
    }
    const session = createSession(sessionData);
    createSessionFile(projectId, session);
  }
}

// ---------------------------------------------------------------------------
// Setup/Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  tempHome = createTempWorkerMillHome();
});

afterEach(() => {
  tempHome.restore();
  tempHome.cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("wm stats — E2E verification", () => {
  it("shows 30-day summary with exact aggregation", () => {
    const now = new Date();
    const recentSession = {
      startedAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago
      totalCostUsd: 1.50,
      costByModel: [
        {
          key: "anthropic/claude-sonnet-4-6",
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          inputTokens: 750,
          outputTokens: 750,
          costUsd: 1.50,
          roles: ["worker"],
        },
      ],
    };
    const oldSession = {
      startedAt: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString(), // 40 days ago
      totalCostUsd: 2.00,
      costByModel: [
        {
          key: "anthropic/claude-sonnet-4-6",
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          inputTokens: 1000,
          outputTokens: 1000,
          costUsd: 2.00,
          roles: ["worker"],
        },
      ],
    };
    setupTestSessions([recentSession, oldSession]);

    const lines = captureOutput(() => handleStatsCommand({ days: 30 }));

    // Check header
    expect(lines.some(l => l.includes("WorkerMill Usage"))).toBe(true);
    expect(lines.some(l => l.includes("last 30 days"))).toBe(true);

    // Check exact aggregated values
    expect(lines.some(l => l.includes("Sessions          1"))).toBe(true);
    expect(lines.some(l => l.includes("Total cost       $1.50"))).toBe(true);
    expect(lines.some(l => l.includes("Total tokens      1.5K  (750 in / 750 out)"))).toBe(true);
    expect(lines.some(l => l.includes("Avg per session  $1.50"))).toBe(true);
  });

  it("--all option works with exact aggregation", () => {
    const now = new Date();
    const recentSession = {
      startedAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      totalCostUsd: 1.50,
      costByModel: [
        {
          key: "anthropic/claude-sonnet-4-6",
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          inputTokens: 750,
          outputTokens: 750,
          costUsd: 1.50,
          roles: ["worker"],
        },
      ],
    };
    const oldSession = {
      startedAt: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString(),
      totalCostUsd: 2.00,
      costByModel: [
        {
          key: "anthropic/claude-sonnet-4-6",
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          inputTokens: 1000,
          outputTokens: 1000,
          costUsd: 2.00,
          roles: ["worker"],
        },
      ],
    };
    setupTestSessions([recentSession, oldSession]);

    const lines = captureOutput(() => handleStatsCommand({ all: true }));

    // Check header shows "all time"
    expect(lines.some(l => l.includes("all time"))).toBe(true);

    // Check exact aggregated values for all sessions
    expect(lines.some(l => l.includes("Sessions          2"))).toBe(true);
    expect(lines.some(l => l.includes("Total cost       $3.50"))).toBe(true);
    expect(lines.some(l => l.includes("Total tokens      3.5K  (1.8K in / 1.8K out)"))).toBe(true);
    expect(lines.some(l => l.includes("Avg per session  $1.75"))).toBe(true);
  });

  it("--cwd option filters by working directory", () => {
    const project1Cwd = "/project1";
    const project2Cwd = "/project2";
    const session1 = {
      cwd: project1Cwd,
      startedAt: new Date().toISOString(),
      totalCostUsd: 1.00,
      costByModel: [
        {
          key: "anthropic/claude-sonnet-4-6",
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          inputTokens: 500,
          outputTokens: 500,
          costUsd: 1.00,
          roles: ["worker"],
        },
      ],
    };
    const session2 = {
      cwd: project2Cwd,
      startedAt: new Date().toISOString(),
      totalCostUsd: 2.00,
      costByModel: [
        {
          key: "anthropic/claude-sonnet-4-6",
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          inputTokens: 1000,
          outputTokens: 1000,
          costUsd: 2.00,
          roles: ["worker"],
        },
      ],
    };
    setupTestSessions([session1, session2]);

    // Mock process.cwd to match project1
    const originalCwd = process.cwd;
    vi.spyOn(process, "cwd").mockReturnValue(project1Cwd);

    try {
      const lines = captureOutput(() => handleStatsCommand({ cwd: true }));

      // Should only include project1's session
      expect(lines.some(l => l.includes("Sessions          1"))).toBe(true);
      expect(lines.some(l => l.includes("Total cost       $1.00"))).toBe(true);
    } finally {
      vi.spyOn(process, "cwd").mockImplementation(originalCwd);
    }
  });

  it("--json emits valid JSON with exact data", () => {
    const now = new Date();
    const session = {
      startedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      totalCostUsd: 2.25,
      costByModel: [
        {
          key: "anthropic/claude-sonnet-4-6",
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          inputTokens: 1125,
          outputTokens: 1125,
          costUsd: 2.25,
          roles: ["worker"],
        },
      ],
    };
    setupTestSessions([session]);

    const lines = captureOutput(() => handleStatsCommand({ json: true }));

    const jsonLine = lines.find(l => l.trim().startsWith("{"));
    expect(jsonLine).toBeDefined();

    // Should be valid JSON
    const stats = JSON.parse(jsonLine!);
    expect(stats).toMatchObject({
      period: expect.any(Object),
      sessions: { total: 1, withCostData: 1 },
      tokens: { input: 1125, output: 1125, total: 2250 },
      costUsd: 2.25,
      avgCostPerSessionUsd: 2.25,
      byModel: expect.any(Array),
      byRole: {
        worker: { costUsd: 0, inputTokens: 0, outputTokens: 0 },
        planner: { costUsd: 0, inputTokens: 0, outputTokens: 0 },
        reviewer: { costUsd: 0, inputTokens: 0, outputTokens: 0 },
      },
      byProject: expect.any(Array),
    });
  });

  it("handles empty history", () => {
    // No sessions created
    const lines = captureOutput(() => handleStatsCommand({ days: 30 }));

    expect(lines.some(l => l.includes("No sessions found"))).toBe(true);
  });

  it("aggregates cost by model and role correctly", () => {
    const session = {
      startedAt: new Date().toISOString(),
      totalCostUsd: 3.00,
      costByModel: [
        {
          key: "anthropic/claude-sonnet-4-6",
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          inputTokens: 1000,
          outputTokens: 2000,
          costUsd: 2.00,
          roles: ["worker"],
        },
        {
          key: "openai/gpt-4",
          provider: "openai",
          model: "gpt-4",
          inputTokens: 500,
          outputTokens: 1000,
          costUsd: 1.00,
          roles: ["planner"],
        },
      ],
      costByRole: {
        worker: {
          costUsd: 2.00,
          inputTokens: 1000,
          outputTokens: 2000,
        },
        planner: {
          costUsd: 1.00,
          inputTokens: 500,
          outputTokens: 1000,
        },
        reviewer: {
          costUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
        },
      },
    };
    setupTestSessions([session]);

    const lines = captureOutput(() => handleStatsCommand({ all: true }));

    // Check by model section
    expect(lines.some(l => l.includes("claude-sonnet-4-6") && l.includes("$2.00"))).toBe(true);
    expect(lines.some(l => l.includes("gpt-4") && l.includes("$1.00"))).toBe(true);

    // Check by role section
    expect(lines.some(l => l.includes("Worker") && l.includes("$2.00"))).toBe(true);
    expect(lines.some(l => l.includes("Planner") && l.includes("$1.00"))).toBe(true);
    expect(lines.some(l => l.includes("Reviewer") && l.includes("$0.00"))).toBe(true);
  });

  it("runs without crashing", () => {
    // Basic smoke test
    expect(() => captureOutput(() => handleStatsCommand({ days: 30 }))).not.toThrow();
  });
});