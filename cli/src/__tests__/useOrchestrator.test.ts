/**
 * Tests for the logic in useOrchestrator.ts.
 *
 * Since useOrchestrator is a React hook we cannot call it directly in a pure
 * Node test. Instead we replicate the key decision logic as pure functions
 * (same approach as useAgent.test.ts) and verify behaviour.
 *
 * Covered areas:
 *   1. PERSONA_EMOJIS mapping — known personas, unknown fallback
 *   2. OrchestrationOutput adapter — log, coordinatorLog, error, status,
 *      statusDone, confirm, toolCall formatting
 *   3. toolCall detail extraction — file_path, command, query, prompt,
 *      pattern, url, action, fallback keys
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// 1. PERSONA_EMOJIS + getEmoji (pure replication from useOrchestrator.ts)
// ---------------------------------------------------------------------------

const PERSONA_EMOJIS: Record<string, string> = {
  frontend_developer: "\u{1F3A8}",
  backend_developer: "\u{1F4BB}",
  devops_engineer: "\u{1F527}",
  security_engineer: "\u{1F512}",
  qa_engineer: "\u{1F9EA}",
  tech_writer: "\u{1F4DD}",
  project_manager: "\u{1F4CB}",
  architect: "\u{1F3D7}\uFE0F",
  data_ml_engineer: "\u{1F4CA}",
  mobile_developer: "\u{1F4F1}",
  tech_lead: "\u{1F451}",
  manager: "\u{1F454}",
  support_agent: "\u{1F4AC}",
  planner: "\u{1F4A1}",
  coordinator: "\u{1F3AF}",
  critic: "\u{1F50D}",
  reviewer: "\u{1F50D}",
};

function getEmoji(persona: string): string {
  return PERSONA_EMOJIS[persona] || "\u{1F916}";
}

describe("PERSONA_EMOJIS mapping", () => {
  it("returns the correct emoji for known personas", () => {
    expect(getEmoji("frontend_developer")).toBe("🎨");
    expect(getEmoji("backend_developer")).toBe("💻");
    expect(getEmoji("devops_engineer")).toBe("🔧");
    expect(getEmoji("security_engineer")).toBe("\u{1F512}");
    expect(getEmoji("qa_engineer")).toBe("🧪");
    expect(getEmoji("tech_writer")).toBe("📝");
    expect(getEmoji("project_manager")).toBe("📋");
    expect(getEmoji("architect")).toBe("🏗️");
    expect(getEmoji("data_ml_engineer")).toBe("📊");
    expect(getEmoji("mobile_developer")).toBe("📱");
    expect(getEmoji("tech_lead")).toBe("👑");
    expect(getEmoji("manager")).toBe("👔");
    expect(getEmoji("support_agent")).toBe("💬");
  });

  it("returns the correct emoji for CLI-specific roles", () => {
    expect(getEmoji("planner")).toBe("💡");
    expect(getEmoji("coordinator")).toBe("🎯");
    expect(getEmoji("critic")).toBe("🔍");
    expect(getEmoji("reviewer")).toBe("🔍");
  });

  it("returns robot emoji for unknown personas", () => {
    expect(getEmoji("unknown_persona")).toBe("🤖");
    expect(getEmoji("")).toBe("🤖");
    expect(getEmoji("fullstack_developer")).toBe("🤖");
  });

  it("has exactly 17 persona entries", () => {
    expect(Object.keys(PERSONA_EMOJIS)).toHaveLength(17);
  });
});

// ---------------------------------------------------------------------------
// 2. OrchestrationOutput adapter (pure replication)
// ---------------------------------------------------------------------------

describe("OrchestrationOutput adapter", () => {
  let emittedLines: string[];
  let statusMessage: string;
  let toolCounts: Record<string, number>;

  function emitLine(line: string): void {
    emittedLines.push(line);
  }

  // Replicate the output adapter from useOrchestrator.ts
  function createOutput() {
    return {
      log(persona: string, message: string): void {
        const emoji = getEmoji(persona);
        const trimmed = message.trim();
        if (trimmed) {
          emitLine(`[${emoji} ${persona}] ${trimmed}`);
        }
      },

      coordinatorLog(message: string): void {
        emitLine(`[${getEmoji("coordinator")} coordinator] ${message}`);
      },

      error(message: string): void {
        emitLine(`**Error:** ${message}`);
      },

      status(message: string): void {
        statusMessage = message;
      },

      statusDone(message?: string): void {
        if (message) {
          emitLine(message);
        }
        statusMessage = "";
      },

      toolCall(
        persona: string,
        toolName: string,
        toolInput: Record<string, unknown>,
      ): void {
        let detail = "";
        if (toolInput.file_path) {
          detail = String(toolInput.file_path);
        } else if (toolInput.path) {
          detail = String(toolInput.path);
        } else if (toolInput.command) {
          const cmd = String(toolInput.command);
          detail = cmd.length > 120 ? cmd.slice(0, 117) + "..." : cmd;
        } else if (toolInput.query) {
          detail = String(toolInput.query).slice(0, 120);
        } else if (toolInput.prompt) {
          detail = String(toolInput.prompt).slice(0, 120);
        } else if (toolInput.pattern) {
          detail = `pattern: ${String(toolInput.pattern)}`;
        } else if (toolInput.url) {
          detail = String(toolInput.url);
        } else if (toolInput.action) {
          detail = String(toolInput.action);
        } else {
          const keys = Object.keys(toolInput).slice(0, 3);
          if (keys.length > 0) {
            detail = keys
              .map((k) => `${k}: ${String(toolInput[k]).slice(0, 80)}`)
              .join(", ");
          }
        }

        const emoji = getEmoji(persona);
        emitLine(
          `[${emoji} ${persona}] \u{2193} ${toolName}${detail ? " " + detail : ""}`,
        );
        toolCounts[toolName] = (toolCounts[toolName] || 0) + 1;
        statusMessage = `${persona}: working...`;
      },
    };
  }

  beforeEach(() => {
    emittedLines = [];
    statusMessage = "";
    toolCounts = {};
  });

  describe("log()", () => {
    it("formats persona log with emoji", () => {
      const output = createOutput();
      output.log("frontend_developer", "Building components");
      expect(emittedLines).toEqual(["[🎨 frontend_developer] Building components"]);
    });

    it("trims whitespace from messages", () => {
      const output = createOutput();
      output.log("backend_developer", "  spaced out  ");
      expect(emittedLines).toEqual(["[💻 backend_developer] spaced out"]);
    });

    it("skips empty messages after trim", () => {
      const output = createOutput();
      output.log("backend_developer", "   ");
      expect(emittedLines).toHaveLength(0);
    });

    it("uses robot emoji for unknown persona", () => {
      const output = createOutput();
      output.log("mystery_agent", "doing things");
      expect(emittedLines[0]).toContain("🤖");
      expect(emittedLines[0]).toContain("mystery_agent");
    });
  });

  describe("coordinatorLog()", () => {
    it("formats with coordinator emoji and label", () => {
      const output = createOutput();
      output.coordinatorLog("Planning phase started");
      expect(emittedLines).toEqual(["[🎯 coordinator] Planning phase started"]);
    });
  });

  describe("error()", () => {
    it("formats error with bold markdown", () => {
      const output = createOutput();
      output.error("Something broke");
      expect(emittedLines).toEqual(["**Error:** Something broke"]);
    });
  });

  describe("status()", () => {
    it("sets the status message", () => {
      const output = createOutput();
      output.status("Analyzing codebase...");
      expect(statusMessage).toBe("Analyzing codebase...");
    });
  });

  describe("statusDone()", () => {
    it("clears status and emits message when provided", () => {
      const output = createOutput();
      output.status("Working...");
      output.statusDone("Done working");
      expect(statusMessage).toBe("");
      expect(emittedLines).toEqual(["Done working"]);
    });

    it("clears status without emitting when no message", () => {
      const output = createOutput();
      output.status("Working...");
      output.statusDone();
      expect(statusMessage).toBe("");
      expect(emittedLines).toHaveLength(0);
    });
  });

  describe("toolCall()", () => {
    it("formats tool call with file_path detail", () => {
      const output = createOutput();
      output.toolCall("frontend_developer", "read_file", {
        file_path: "/src/App.tsx",
      });
      expect(emittedLines[0]).toBe(
        "[🎨 frontend_developer] ↓ read_file /src/App.tsx",
      );
    });

    it("formats tool call with path detail", () => {
      const output = createOutput();
      output.toolCall("backend_developer", "list_dir", { path: "/src" });
      expect(emittedLines[0]).toBe("[💻 backend_developer] ↓ list_dir /src");
    });

    it("truncates long commands to 120 chars", () => {
      const output = createOutput();
      const longCmd = "npm run build " + "x".repeat(200);
      output.toolCall("devops_engineer", "bash", { command: longCmd });
      const detail = emittedLines[0].split("↓ bash ")[1];
      expect(detail.length).toBeLessThanOrEqual(120);
      expect(detail).toMatch(/\.\.\.$/);
    });

    it("does not truncate short commands", () => {
      const output = createOutput();
      output.toolCall("devops_engineer", "bash", { command: "ls -la" });
      expect(emittedLines[0]).toContain("ls -la");
      expect(emittedLines[0]).not.toContain("...");
    });

    it("formats tool call with query detail", () => {
      const output = createOutput();
      output.toolCall("qa_engineer", "web_search", {
        query: "vitest mock guide",
      });
      expect(emittedLines[0]).toContain("vitest mock guide");
    });

    it("formats tool call with prompt detail", () => {
      const output = createOutput();
      output.toolCall("architect", "sub_agent", {
        prompt: "Review this design",
      });
      expect(emittedLines[0]).toContain("Review this design");
    });

    it("formats tool call with pattern detail", () => {
      const output = createOutput();
      output.toolCall("qa_engineer", "grep", { pattern: "TODO" });
      expect(emittedLines[0]).toContain("pattern: TODO");
    });

    it("formats tool call with url detail", () => {
      const output = createOutput();
      output.toolCall("frontend_developer", "browser_navigate", {
        url: "http://localhost:3000",
      });
      expect(emittedLines[0]).toContain("http://localhost:3000");
    });

    it("formats tool call with action detail", () => {
      const output = createOutput();
      output.toolCall("frontend_developer", "browser_click", {
        action: "click button",
      });
      expect(emittedLines[0]).toContain("click button");
    });

    it("uses fallback key=value for unknown input shapes", () => {
      const output = createOutput();
      output.toolCall("tech_lead", "custom_tool", {
        foo: "bar",
        baz: "qux",
      });
      expect(emittedLines[0]).toContain("foo: bar");
      expect(emittedLines[0]).toContain("baz: qux");
    });

    it("shows no detail for empty toolInput", () => {
      const output = createOutput();
      output.toolCall("tech_lead", "noop_tool", {});
      expect(emittedLines[0]).toBe("[👑 tech_lead] ↓ noop_tool");
    });

    it("increments tool count", () => {
      const output = createOutput();
      output.toolCall("qa_engineer", "bash", { command: "echo hi" });
      output.toolCall("qa_engineer", "bash", { command: "echo bye" });
      expect(toolCounts["bash"]).toBe(2);
    });

    it("sets status to persona working", () => {
      const output = createOutput();
      output.toolCall("frontend_developer", "read_file", {
        file_path: "/a.ts",
      });
      expect(statusMessage).toBe("frontend_developer: working...");
    });

    it("prefers file_path over path when both present", () => {
      const output = createOutput();
      output.toolCall("backend_developer", "edit_file", {
        file_path: "/exact.ts",
        path: "/fallback.ts",
      });
      expect(emittedLines[0]).toContain("/exact.ts");
      expect(emittedLines[0]).not.toContain("/fallback.ts");
    });
  });
});
