import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { createTempWorkerMillHome, type TempHome } from "./helpers/temp-workermill-home.js";
import * as logger from "../logger.js";

// Mock logger
vi.mock("../logger.js", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

describe("loadCustomCommands()", () => {
  let tmp: TempHome;
  let projectDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = createTempWorkerMillHome();
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-project-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(projectDir);
    vi.resetModules();
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    tmp.restore();
    tmp.cleanup();
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  async function importCustomCommands() {
    return await import("../custom-commands.js");
  }

  it("returns empty array when no command dirs exist", async () => {
    const { loadCustomCommands } = await importCustomCommands();
    const commands = loadCustomCommands();
    expect(commands).toEqual([]);
  });

  it("loads commands from project .workermill/commands/ dir", async () => {
    const commandsDir = path.join(projectDir, ".workermill", "commands");
    fs.mkdirSync(commandsDir, { recursive: true });
    fs.writeFileSync(
      path.join(commandsDir, "review.md"),
      "Please review the code carefully.",
      "utf-8",
    );

    const { loadCustomCommands } = await importCustomCommands();
    const commands = loadCustomCommands();

    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe("review");
    expect(commands[0].prompt).toBe("Please review the code carefully.");
  });

  it("loads commands from user ~/.workermill/commands/ dir", async () => {
    const commandsDir = path.join(tmp.wmDir, "commands");
    fs.mkdirSync(commandsDir, { recursive: true });
    fs.writeFileSync(
      path.join(commandsDir, "deploy.md"),
      "Run the deployment steps.",
      "utf-8",
    );

    const { loadCustomCommands } = await importCustomCommands();
    const commands = loadCustomCommands();

    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe("deploy");
    expect(commands[0].prompt).toBe("Run the deployment steps.");
  });

  it("parses command with YAML frontmatter (name, description, prompt body)", async () => {
    const commandsDir = path.join(projectDir, ".workermill", "commands");
    fs.mkdirSync(commandsDir, { recursive: true });
    fs.writeFileSync(
      path.join(commandsDir, "my-cmd.md"),
      [
        "---",
        "name: my-custom-command",
        "description: A helpful custom command",
        "---",
        "Do something useful with the current file.",
      ].join("\n"),
      "utf-8",
    );

    const { loadCustomCommands } = await importCustomCommands();
    const commands = loadCustomCommands();

    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe("my-custom-command");
    expect(commands[0].description).toBe("A helpful custom command");
    expect(commands[0].prompt).toBe("Do something useful with the current file.");
  });

  it("parses command without frontmatter (filename as name, whole content as prompt)", async () => {
    const commandsDir = path.join(projectDir, ".workermill", "commands");
    fs.mkdirSync(commandsDir, { recursive: true });
    fs.writeFileSync(
      path.join(commandsDir, "summarize.md"),
      "Summarize the selected code in plain English.",
      "utf-8",
    );

    const { loadCustomCommands } = await importCustomCommands();
    const commands = loadCustomCommands();

    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe("summarize");
    expect(commands[0].description).toBe("summarize");
    expect(commands[0].prompt).toBe("Summarize the selected code in plain English.");
  });

  it("handles frontmatter with colons in value (e.g., description with URLs)", async () => {
    const commandsDir = path.join(projectDir, ".workermill", "commands");
    fs.mkdirSync(commandsDir, { recursive: true });
    fs.writeFileSync(
      path.join(commandsDir, "fetch-docs.md"),
      [
        "---",
        "name: fetch-docs",
        "description: Fetch docs from https://example.com/api",
        "---",
        "Retrieve the documentation.",
      ].join("\n"),
      "utf-8",
    );

    const { loadCustomCommands } = await importCustomCommands();
    const commands = loadCustomCommands();

    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe("fetch-docs");
    expect(commands[0].description).toBe("Fetch docs from https://example.com/api");
    expect(commands[0].prompt).toBe("Retrieve the documentation.");
  });

  it("deduplicates commands by name (project takes priority over user)", async () => {
    // Project command
    const projectCommandsDir = path.join(projectDir, ".workermill", "commands");
    fs.mkdirSync(projectCommandsDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectCommandsDir, "review.md"),
      [
        "---",
        "name: review",
        "description: Project-level review",
        "---",
        "Project review prompt.",
      ].join("\n"),
      "utf-8",
    );

    // User-level command with the same name
    const userCommandsDir = path.join(tmp.wmDir, "commands");
    fs.mkdirSync(userCommandsDir, { recursive: true });
    fs.writeFileSync(
      path.join(userCommandsDir, "review.md"),
      [
        "---",
        "name: review",
        "description: User-level review",
        "---",
        "User review prompt.",
      ].join("\n"),
      "utf-8",
    );

    const { loadCustomCommands } = await importCustomCommands();
    const commands = loadCustomCommands();

    // Only one "review" command should exist
    const reviewCommands = commands.filter(c => c.name === "review");
    expect(reviewCommands).toHaveLength(1);
    // Project dir is checked first, so its version wins
    expect(reviewCommands[0].description).toBe("Project-level review");
    expect(reviewCommands[0].prompt).toBe("Project review prompt.");
  });

  it("only loads .md files, ignores other extensions", async () => {
    const commandsDir = path.join(projectDir, ".workermill", "commands");
    fs.mkdirSync(commandsDir, { recursive: true });
    fs.writeFileSync(path.join(commandsDir, "valid.md"), "A valid markdown command.", "utf-8");
    fs.writeFileSync(path.join(commandsDir, "ignored.txt"), "This should be ignored.", "utf-8");
    fs.writeFileSync(path.join(commandsDir, "also-ignored.json"), '{"key":"value"}', "utf-8");
    fs.writeFileSync(path.join(commandsDir, "no-extension"), "No extension file.", "utf-8");

    const { loadCustomCommands } = await importCustomCommands();
    const commands = loadCustomCommands();

    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe("valid");
  });

  it("handles read errors gracefully (logs debug, continues)", async () => {
    const debugSpy = vi.mocked(logger.debug);

    const commandsDir = path.join(projectDir, ".workermill", "commands");
    fs.mkdirSync(commandsDir, { recursive: true });

    // Write a valid command file
    fs.writeFileSync(path.join(commandsDir, "good.md"), "Good command prompt.", "utf-8");

    // Write a file that will be unreadable by removing read permissions
    const badFilePath = path.join(commandsDir, "bad.md");
    fs.writeFileSync(badFilePath, "Bad file content.", "utf-8");
    fs.chmodSync(badFilePath, 0o000);

    let commands: ReturnType<Awaited<ReturnType<typeof importCustomCommands>>["loadCustomCommands"]>;
    try {
      const { loadCustomCommands } = await importCustomCommands();
      commands = loadCustomCommands();
    } finally {
      // Restore permissions so cleanup can delete the file
      fs.chmodSync(badFilePath, 0o644);
    }

    // Should still load the good file despite the error on the bad one
    expect(commands.some(c => c.name === "good")).toBe(true);
    // Should have logged the debug error
    expect(debugSpy).toHaveBeenCalledWith(
      "Failed to read custom command file",
      expect.objectContaining({ file: "bad.md" }),
    );
  });
});
