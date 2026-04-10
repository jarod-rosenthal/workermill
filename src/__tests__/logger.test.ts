import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createTempWorkerMillHome, type TempHome } from "./helpers/temp-workermill-home.js";

describe("logger", () => {
  let tmp: TempHome;
  let fakeProjectDir: string;
  let expectedHash: string;
  let logFile: string;

  let expectedProjectDir: string;

  beforeEach(() => {
    tmp = createTempWorkerMillHome();
    // Use a stable fake project directory so we know the hash
    fakeProjectDir = "/fake/project/dir";
    expectedHash = crypto.createHash("md5").update(fakeProjectDir).digest("hex").slice(0, 8);
    const slug = "dir"; // basename of /fake/project/dir
    expectedProjectDir = `${slug}-${expectedHash}`;
    const today = new Date().toISOString().slice(0, 10);
    logFile = path.join(tmp.homeDir, ".workermill", "projects", expectedProjectDir, "logs", `${today}.log`);

    vi.spyOn(process, "cwd").mockReturnValue(fakeProjectDir);
    vi.resetModules();
  });

  afterEach(async () => {
    // Import to flush and clean up any open stream before cleanup
    try {
      const logger = await import("../logger.js");
      logger.flush();
    } catch {
      // ignore
    }
    tmp.restore();
    tmp.cleanup();
    vi.restoreAllMocks();
  });

  async function importLogger() {
    return await import("../logger.js");
  }

  it("info() writes [timestamp] INFO: message to log file", async () => {
    const logger = await importLogger();
    logger.info("hello world");

    // Give the stream a moment to flush
    await new Promise((r) => setTimeout(r, 20));

    expect(fs.existsSync(logFile)).toBe(true);
    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toMatch(/^\[\d{4}-\d{2}-\d{2}T/);
    expect(content).toContain("] INFO: hello world");
  });

  it("error() writes [timestamp] ERROR: message to log file", async () => {
    const logger = await importLogger();
    logger.error("something broke");

    await new Promise((r) => setTimeout(r, 20));

    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toContain("] ERROR: something broke");
  });

  it("warn() writes [timestamp] WARN: message to log file", async () => {
    const logger = await importLogger();
    logger.warn("caution");

    await new Promise((r) => setTimeout(r, 20));

    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toContain("] WARN: caution");
  });

  it("debug() writes [timestamp] DEBUG: message to log file", async () => {
    const logger = await importLogger();
    logger.debug("verbose detail");

    await new Promise((r) => setTimeout(r, 20));

    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toContain("] DEBUG: verbose detail");
  });

  it("log() with data appends JSON.stringify of data", async () => {
    const logger = await importLogger();
    logger.log("INFO", "with data", { key: "value", num: 42 });

    await new Promise((r) => setTimeout(r, 20));

    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toContain("] INFO: with data");
    expect(content).toContain('"key":"value"');
    expect(content).toContain('"num":42');
  });

  it("log() without data does not append extra JSON", async () => {
    const logger = await importLogger();
    logger.log("INFO", "no data here");

    await new Promise((r) => setTimeout(r, 20));

    const content = fs.readFileSync(logFile, "utf-8").trim();
    // Line should end at message — no trailing JSON object
    expect(content).toMatch(/\] INFO: no data here$/);
  });

  it("tool() truncates input preview to 200 chars", async () => {
    const logger = await importLogger();
    const longValue = "x".repeat(500);
    logger.tool("myTool", { arg: longValue });

    await new Promise((r) => setTimeout(r, 20));

    const content = fs.readFileSync(logFile, "utf-8");
    // The entire JSON.stringify of {arg: longValue} is > 200 chars; verify it is sliced
    const inputMatch = content.match(/"input":"([^"]+)"/);
    expect(inputMatch).not.toBeNull();
    expect(inputMatch![1].length).toBeLessThanOrEqual(200);
  });

  it("tool() truncates result to 200 chars", async () => {
    const logger = await importLogger();
    const longResult = "r".repeat(500);
    logger.tool("myTool", {}, longResult);

    await new Promise((r) => setTimeout(r, 20));

    const content = fs.readFileSync(logFile, "utf-8");
    const resultMatch = content.match(/"result":"([^"]+)"/);
    expect(resultMatch).not.toBeNull();
    expect(resultMatch![1].length).toBeLessThanOrEqual(200);
  });

  it("tool() writes empty result string when result is omitted", async () => {
    const logger = await importLogger();
    logger.tool("myTool", { x: 1 });

    await new Promise((r) => setTimeout(r, 20));

    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toContain('"result":""');
  });

  it("multiple log calls append to the same file", async () => {
    const logger = await importLogger();
    logger.info("first line");
    logger.info("second line");
    logger.info("third line");

    await new Promise((r) => setTimeout(r, 20));

    const content = fs.readFileSync(logFile, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("first line");
    expect(lines[1]).toContain("second line");
    expect(lines[2]).toContain("third line");
  });

  it("flush() closes the stream", async () => {
    const logger = await importLogger();
    logger.info("before flush");

    await new Promise((r) => setTimeout(r, 20));

    // Should not throw
    expect(() => logger.flush()).not.toThrow();

    // After flush, calling flush again is safe (stream is null)
    expect(() => logger.flush()).not.toThrow();
  });

  it("flush() on a never-used logger is a no-op", async () => {
    const logger = await importLogger();
    // Never wrote anything — logStream is null
    expect(() => logger.flush()).not.toThrow();
  });

  it("creates log directory automatically on first write", async () => {
    const logger = await importLogger();

    const logDir = path.dirname(logFile);
    expect(fs.existsSync(logDir)).toBe(false);

    logger.info("trigger dir creation");
    await new Promise((r) => setTimeout(r, 20));

    expect(fs.existsSync(logDir)).toBe(true);
    expect(fs.existsSync(logFile)).toBe(true);
  });

  it("uses project-hash subdirectory derived from process.cwd()", async () => {
    const logger = await importLogger();
    logger.info("hash test");

    await new Promise((r) => setTimeout(r, 20));

    // Verify the log lives under the slug-hash directory we computed from fakeProjectDir
    const logsBase = path.join(tmp.homeDir, ".workermill", "projects");
    const entries = fs.readdirSync(logsBase);
    expect(entries).toContain(expectedProjectDir);
  });
});
