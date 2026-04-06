import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runLogsCommand, LogsOptions } from "../logs-command.js";
import { getLogPath, parseLogLine } from "../logger.js";
import fs from "fs";
import path from "path";
import os from "os";

// Mock fs
vi.mock("fs");

// Mock process.exit
const mockExit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("process.exit called"); });

const mockFs = fs as any;
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

describe("logs-command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue("test log content");
    mockFs.watchFile.mockImplementation(() => {});
    mockFs.unwatchFile.mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("parseLogLine", () => {
    it("parses standard log line", () => {
      const line = "[2023-01-01T00:00:00.000Z] INFO: Test message";
      const result = parseLogLine(line);
      expect(result).toEqual({
        timestamp: "2023-01-01T00:00:00.000Z",
        level: "INFO",
        message: "Test message",
      });
    });

    it("parses log line with JSON data", () => {
      const line = '[2023-01-01T00:00:00.000Z] TOOL: bash {"input":"ls","result":"file.txt"}';
      const result = parseLogLine(line);
      expect(result).toEqual({
        timestamp: "2023-01-01T00:00:00.000Z",
        level: "TOOL",
        message: "bash",
        data: { input: "ls", result: "file.txt" },
      });
    });

    it("returns raw for malformed line", () => {
      const line = "not a log line";
      const result = parseLogLine(line);
      expect(result).toEqual({ raw: "not a log line" });
    });
  });

  describe("getLogPath", () => {
    it("returns log path for cwd", () => {
      const cwd = "/test/dir";
      const hash = require("crypto").createHash("md5").update(cwd).digest("hex").slice(0, 8);
      const expected = path.join(os.homedir(), ".workermill", "logs", hash, "cli.log");
      expect(getLogPath(cwd)).toBe(expected);
    });

    it("returns log path for undefined cwd", () => {
      const cwd = process.cwd();
      const hash = require("crypto").createHash("md5").update(cwd).digest("hex").slice(0, 8);
      const expected = path.join(os.homedir(), ".workermill", "logs", hash, "cli.log");
      expect(getLogPath()).toBe(expected);
    });
  });

  describe("runLogsCommand", () => {
    it("exits with error if log file does not exist", () => {
      mockFs.existsSync.mockReturnValue(false);
      expect(() => runLogsCommand({})).toThrow(/process\.exit/);
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining("No log file found"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("prints last 50 lines by default", () => {
      mockFs.readFileSync.mockReturnValue("line1\nline2\nline3");
      runLogsCommand({});
      expect(mockConsoleLog).toHaveBeenCalledTimes(3);
    });

    it("respects --tail option", () => {
      mockFs.readFileSync.mockReturnValue("line1\nline2\nline3");
      runLogsCommand({ tail: 2 });
      expect(mockConsoleLog).toHaveBeenCalledTimes(2);
    });

    it("filters by level", () => {
      const content = "[2023-01-01T00:00:00.000Z] INFO: info message\n[2023-01-01T00:00:01.000Z] ERROR: error message";
      mockFs.readFileSync.mockReturnValue(content);
      runLogsCommand({ level: "error" });
      expect(mockConsoleLog).toHaveBeenCalledTimes(1);
      expect(mockConsoleLog).toHaveBeenCalledWith("[2023-01-01T00:00:01.000Z] ERROR: error message");
    });

    it("outputs JSON when --json is true", () => {
      const content = "[2023-01-01T00:00:00.000Z] INFO: test message";
      mockFs.readFileSync.mockReturnValue(content);
      runLogsCommand({ json: true });
      expect(mockConsoleLog).toHaveBeenCalledWith(JSON.stringify({
        timestamp: "2023-01-01T00:00:00.000Z",
        level: "INFO",
        message: "test message",
      }));
    });

    it("handles --cwd option", () => {
      const cwd = "/custom/dir";
      runLogsCommand({ cwd });
      expect(mockFs.existsSync).toHaveBeenCalledWith(getLogPath(cwd));
      expect(mockFs.readFileSync).toHaveBeenCalledWith(getLogPath(cwd), "utf-8");
    });

    it("starts watching file in --follow mode", () => {
      mockFs.readFileSync.mockReturnValue("initial content");
      runLogsCommand({ follow: true });
      expect(mockFs.watchFile).toHaveBeenCalled();
      expect(mockConsoleError).toHaveBeenCalledWith(`Watching: ${getLogPath()}`);
    });
  });
});