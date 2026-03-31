import { describe, it, expect } from "vitest";
import { toolStatusLabel } from "../ui/tool-status.js";

describe("toolStatusLabel", () => {
  describe("file tools", () => {
    it("read_file with file_path", () => {
      expect(toolStatusLabel("read_file", { file_path: "/src/foo.ts" })).toBe("Reading /src/foo.ts...");
    });

    it("read_file without file_path falls back to 'file'", () => {
      expect(toolStatusLabel("read_file", {})).toBe("Reading file...");
    });

    it("write_file with file_path", () => {
      expect(toolStatusLabel("write_file", { file_path: "/src/bar.ts" })).toBe("Writing /src/bar.ts...");
    });

    it("write_file without file_path falls back to 'file'", () => {
      expect(toolStatusLabel("write_file", {})).toBe("Writing file...");
    });

    it("edit_file with file_path", () => {
      expect(toolStatusLabel("edit_file", { file_path: "/src/baz.ts" })).toBe("Editing /src/baz.ts...");
    });

    it("edit_file without file_path falls back to 'file'", () => {
      expect(toolStatusLabel("edit_file", {})).toBe("Editing file...");
    });
  });

  describe("glob", () => {
    it("glob with pattern", () => {
      expect(toolStatusLabel("glob", { pattern: "**/*.ts" })).toBe("Searching files (**/*.ts)...");
    });

    it("glob without pattern", () => {
      expect(toolStatusLabel("glob", {})).toBe("Searching files...");
    });
  });

  describe("grep", () => {
    it("grep with short pattern", () => {
      expect(toolStatusLabel("grep", { pattern: "toolStatusLabel" })).toBe('Searching code for "toolStatusLabel"...');
    });

    it("grep with pattern exactly 30 chars", () => {
      const pattern = "a".repeat(30);
      expect(toolStatusLabel("grep", { pattern })).toBe(`Searching code for "${pattern}"...`);
    });

    it("grep with pattern longer than 30 chars truncates to 30", () => {
      const pattern = "a".repeat(50);
      const expected = `Searching code for "${"a".repeat(30)}"...`;
      expect(toolStatusLabel("grep", { pattern })).toBe(expected);
    });

    it("grep without pattern", () => {
      expect(toolStatusLabel("grep", {})).toBe("Searching code...");
    });
  });

  describe("ls", () => {
    it("ls with path", () => {
      expect(toolStatusLabel("ls", { path: "/home/user" })).toBe("Listing /home/user...");
    });

    it("ls without path falls back to 'directory'", () => {
      expect(toolStatusLabel("ls", {})).toBe("Listing directory...");
    });
  });

  describe("bash", () => {
    it("bash with short command (under 40 chars)", () => {
      expect(toolStatusLabel("bash", { command: "npm test" })).toBe("Running npm test");
    });

    it("bash with command exactly 40 chars — no ellipsis", () => {
      const command = "a".repeat(40);
      expect(toolStatusLabel("bash", { command })).toBe(`Running ${"a".repeat(40)}`);
    });

    it("bash with command longer than 40 chars — truncated with ellipsis", () => {
      const command = "a".repeat(50);
      expect(toolStatusLabel("bash", { command })).toBe(`Running ${"a".repeat(40)}...`);
    });

    it("bash without command falls back to empty string", () => {
      expect(toolStatusLabel("bash", {})).toBe("Running ");
    });
  });

  describe("git", () => {
    it("git with action", () => {
      expect(toolStatusLabel("git", { action: "commit" })).toBe("Git commit...");
    });

    it("git without action", () => {
      expect(toolStatusLabel("git", {})).toBe("Git ...");
    });
  });

  describe("sub_agent", () => {
    it("sub_agent always returns fixed label", () => {
      expect(toolStatusLabel("sub_agent", {})).toBe("Running sub-agent...");
      expect(toolStatusLabel("sub_agent", { anything: "ignored" })).toBe("Running sub-agent...");
    });
  });

  describe("browser tools", () => {
    it("browser_open", () => {
      expect(toolStatusLabel("browser_open", {})).toBe("Opening browser...");
    });

    it("browser_navigate with url", () => {
      expect(toolStatusLabel("browser_navigate", { url: "https://example.com" })).toBe("Navigating to https://example.com...");
    });

    it("browser_navigate without url falls back to 'page'", () => {
      expect(toolStatusLabel("browser_navigate", {})).toBe("Navigating to page...");
    });

    it("browser_screenshot", () => {
      expect(toolStatusLabel("browser_screenshot", {})).toBe("Taking screenshot...");
    });

    it("browser_click with selector", () => {
      expect(toolStatusLabel("browser_click", { selector: "#submit-btn" })).toBe("Clicking #submit-btn...");
    });

    it("browser_click without selector falls back to 'element'", () => {
      expect(toolStatusLabel("browser_click", {})).toBe("Clicking element...");
    });

    it("browser_fill with selector", () => {
      expect(toolStatusLabel("browser_fill", { selector: "#email" })).toBe("Filling #email...");
    });

    it("browser_fill without selector falls back to 'field'", () => {
      expect(toolStatusLabel("browser_fill", {})).toBe("Filling field...");
    });

    it("browser_evaluate", () => {
      expect(toolStatusLabel("browser_evaluate", {})).toBe("Running JavaScript...");
    });

    it("browser_console", () => {
      expect(toolStatusLabel("browser_console", {})).toBe("Reading console...");
    });

    it("browser_close", () => {
      expect(toolStatusLabel("browser_close", {})).toBe("Closing browser...");
    });
  });

  describe("lsp tool", () => {
    it("shows action in label", () => {
      expect(toolStatusLabel("lsp", { action: "diagnostics" })).toBe("LSP diagnostics...");
    });

    it("shows 'query' when no action", () => {
      expect(toolStatusLabel("lsp", {})).toBe("LSP query...");
    });
  });

  describe("unknown tools", () => {
    it("unknown tool name uses generic fallback", () => {
      expect(toolStatusLabel("some_unknown_tool", {})).toBe("Running some_unknown_tool...");
    });

    it("another unknown tool name", () => {
      expect(toolStatusLabel("custom_action", { key: "val" })).toBe("Running custom_action...");
    });
  });
});
