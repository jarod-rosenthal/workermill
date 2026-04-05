import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createTempWorkerMillHome, type TempHome } from "./helpers/temp-workermill-home.js";
import { runLogsCommand, type LogsOptions } from "../logs-command.js";

describe("logs-command", () => {
  let tmp: TempHome;
  let fakeProjectDir: string;
  let expectedHash: string;
  let logFile: string;
  let consoleLogSpy: vi.SpyInstance;
  let consoleErrorSpy: vi.SpyInstance;

  beforeEach(() => {
    tmp = createTempWorkerMillHome();
    fakeProjectDir = "/fake/project/dir";
    expectedHash = crypto.createHash("md5").update(fakeProjectDir).digest("hex").slice(0, 8);
    logFile = path.join(tmp.homeDir, ".workermill", "logs", expectedHash, "cli.log");

    vi.spyOn(process, "cwd").mockReturnValue(fakeProjectDir);
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
  });

  afterEach(() => {
    tmp.restore();
    tmp.cleanup();
    vi.restoreAllMocks();
  });

  async function importLogger() {
    return await import("../logger.js");
  }

  describe("getLogPath", () => {
    it("returns path for current cwd when no cwd provided", async () => {
      const { getLogPath } = await importLogger();
      const path = getLogPath();
      expect(path).toBe(logFile);
    });

    it("returns path for provided cwd", async () => {
      const { getLogPath } = await importLogger();
      const customDir = "/custom/dir";
      const customHash = crypto.createHash("md5").update(customDir).digest("hex").slice(0, 8);
      const customLogFile = path.join(tmp.homeDir, ".workermill", "logs", customHash, "cli.log");
      const result = getLogPath(customDir);
      expect(result).toBe(customLogFile);
    });
  });

  describe("parseLogLine", () => {
    it("parses valid INFO line", async () => {
      const { parseLogLine } = await importLogger();
      const line = "[2026-04-04T18:00:00.000Z] INFO: test message";
      const result = parseLogLine(line);
      expect(result).toEqual({
        timestamp: "2026-04-04T18:00:00.000Z",
        level: "INFO",
        message: "test message"
      });
    });

    it("parses valid ERROR line with JSON data", async () => {
      const { parseLogLine } = await importLogger();
      const line = '[2026-04-04T18:00:00.000Z] ERROR: something broke {"key":"value"}';
      const result = parseLogLine(line);
      expect(result).toEqual({
        timestamp: "2026-04-04T18:00:00.000Z",
        level: "ERROR",
        message: "something broke",
        data: { key: "value" }
      });
    });

    it("parses TOOL line with JSON data", async () => {
      const { parseLogLine } = await importLogger();
      const line = '[2026-04-04T18:00:00.000Z] TOOL: bash {"input":"ls","result":"file1.txt"}';
      const result = parseLogLine(line);
      expect(result).toEqual({
        timestamp: "2026-04-04T18:00:00.000Z",
        level: "TOOL",
        message: "bash",
        data: { input: "ls", result: "file1.txt" }
      });
    });

    it("handles malformed line", async () => {
      const { parseLogLine } = await importLogger();
      const line = "not a log line";
      const result = parseLogLine(line);
      expect(result).toEqual({ raw: "not a log line" });
    });

    it("handles invalid JSON in data", async () => {
      const { parseLogLine } = await importLogger();
      const line = '[2026-04-04T18:00:00.000Z] INFO: message {invalid json}';
      const result = parseLogLine(line);
      expect(result).toEqual({
        timestamp: "2026-04-04T18:00:00.000Z",
        level: "INFO",
        message: "message {invalid json}"
      });
    });
  });

  describe("runLogsCommand", () => {
    it("exits with error if log file does not exist", () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {});

      runLogsCommand({});

      expect(consoleErrorSpy).toHaveBeenCalledWith(`No log file found at ${logFile}`);
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });

    it("prints last 50 lines by default", async () => {
      // Create log file with 60 lines
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      const lines = Array.from({ length: 60 }, (_, i) => `[2026-04-04T18:00:00.000Z] INFO: line ${i + 1}`);
      fs.writeFileSync(logFile, lines.join("\n") + "\n");

      runLogsCommand({});

      expect(consoleLogSpy).toHaveBeenCalledTimes(50);
      expect(consoleLogSpy).toHaveBeenNthCalledWith(1, "[2026-04-04T18:00:00.000Z] INFO: line 11");
      expect(consoleLogSpy).toHaveBeenNthCalledWith(50, "[2026-04-04T18:00:00.000Z] INFO: line 60");
    });

    it("prints last N lines with --tail", async () => {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      const lines = Array.from({ length: 10 }, (_, i) => `[2026-04-04T18:00:00.000Z] INFO: line ${i + 1}`);
      fs.writeFileSync(logFile, lines.join("\n") + "\n");

      runLogsCommand({ tail: 3 });

      expect(consoleLogSpy).toHaveBeenCalledTimes(3);
      expect(consoleLogSpy).toHaveBeenNthCalledWith(1, "[2026-04-04T18:00:00.000Z] INFO: line 8");
      expect(consoleLogSpy).toHaveBeenNthCalledWith(3, "[2026-04-04T18:00:00.000Z] INFO: line 10");
    });

    it("filters by level", async () => {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      const content = `[2026-04-04T18:00:00.000Z] INFO: info message
[2026-04-04T18:00:00.000Z] ERROR: error message
[2026-04-04T18:00:00.000Z] INFO: another info`;
      fs.writeFileSync(logFile, content);

      runLogsCommand({ level: "error" });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy).toHaveBeenCalledWith("[2026-04-04T18:00:00.000Z] ERROR: error message");
    });

    it("outputs JSON with --json", async () => {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      const content = `[2026-04-04T18:00:00.000Z] INFO: test message {"key":"value"}`;
      fs.writeFileSync(logFile, content);

      runLogsCommand({ json: true });

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const call = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(call);
      expect(parsed).toEqual({
        timestamp: "2026-04-04T18:00:00.000Z",
        level: "INFO",
        message: "test message",
        data: { key: "value" }
      });
    });

    it("uses custom cwd", async () => {
      const customDir = "/custom/project";
      const customHash = crypto.createHash("md5").update(customDir).digest("hex").slice(0, 8);
      const customLogFile = path.join(tmp.homeDir, ".workermill", "logs", customHash, "cli.log");
      fs.mkdirSync(path.dirname(customLogFile), { recursive: true });
      fs.writeFileSync(customLogFile, "[2026-04-04T18:00:00.000Z] INFO: custom dir message\n");

      runLogsCommand({ cwd: customDir });

      expect(consoleLogSpy).toHaveBeenCalledWith("[2026-04-04T18:00:00.000Z] INFO: custom dir message");
    });
  });
});