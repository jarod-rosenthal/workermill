import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Mocks (must be declared before imports) ----

const mockExecSync = vi.fn();
const mockSpawn = vi.fn();
const mockExistsSync = vi.fn(() => false);
const mockReadFileSync = vi.fn(() => "");

vi.mock("child_process", () => ({
  execSync: (...args: any[]) => mockExecSync(...args),
  spawn: (...args: any[]) => mockSpawn(...args),
}));

vi.mock("fs", () => ({
  default: {
    existsSync: (...args: any[]) => mockExistsSync(...args),
    readFileSync: (...args: any[]) => mockReadFileSync(...args),
  },
  existsSync: (...args: any[]) => mockExistsSync(...args),
  readFileSync: (...args: any[]) => mockReadFileSync(...args),
}));

// ---- Helpers ----

function createMockProcess() {
  const stdin = { writable: true, write: vi.fn() };
  const dataHandlers: Function[] = [];
  const stdout = {
    on: vi.fn((evt: string, handler: Function) => {
      if (evt === "data") dataHandlers.push(handler);
    }),
  };
  const stderr = { on: vi.fn() };
  const exitHandlers: Function[] = [];
  const proc: any = {
    stdin,
    stdout,
    stderr,
    on: vi.fn((evt: string, handler: Function) => {
      if (evt === "exit") exitHandlers.push(handler);
    }),
    kill: vi.fn(),
    pid: 12345,
    _feedData(buf: Buffer) {
      for (const h of dataHandlers) h(buf);
    },
    _triggerExit() {
      for (const h of exitHandlers) h();
    },
  };
  return proc;
}

function buildLspMessage(id: number, result: unknown): Buffer {
  const body = JSON.stringify({ jsonrpc: "2.0", id, result });
  const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
  return Buffer.from(header + body);
}

function buildLspError(id: number, code: number, message: string): Buffer {
  const body = JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
  const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
  return Buffer.from(header + body);
}

// ---- Tests ----

describe("LSP tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue("");
  });

  // ---- Static exports ----

  describe("exports", () => {
    it("has correct name", async () => {
      const mod = await import("../../tools/lsp.js");
      expect(mod.name).toBe("lsp");
    });

    it("has a description", async () => {
      const mod = await import("../../tools/lsp.js");
      expect(mod.description).toBeTruthy();
      expect(mod.description).toContain("diagnostics");
      expect(mod.description).toContain("go-to-definition");
      expect(mod.description).toContain("find-references");
    });

    it("has correct parameter schema", async () => {
      const mod = await import("../../tools/lsp.js");
      expect(mod.parameters.type).toBe("object");
      expect(mod.parameters.properties.action.enum).toEqual([
        "diagnostics", "definition", "references", "hover", "symbols",
      ]);
      expect(mod.parameters.required).toContain("action");
      expect(mod.parameters.required).toContain("file");
      expect(mod.parameters.properties.line.type).toBe("number");
      expect(mod.parameters.properties.character.type).toBe("number");
    });
  });

  // ---- execute — file not found ----

  describe("execute — file not found", () => {
    it("returns error for missing file", async () => {
      mockExistsSync.mockReturnValue(false);
      vi.resetModules();
      const { execute } = await import("../../tools/lsp.js");
      const result = await execute({ action: "diagnostics", file: "missing.ts" }, "/tmp/project");
      expect(result.success).toBe(false);
      expect(result.error).toContain("File not found");
    });

    it("returns error with the original file path", async () => {
      mockExistsSync.mockReturnValue(false);
      vi.resetModules();
      const { execute } = await import("../../tools/lsp.js");
      const result = await execute({ action: "symbols", file: "nonexistent/file.py" }, "/tmp/project");
      expect(result.success).toBe(false);
      expect(result.error).toContain("nonexistent/file.py");
    });
  });

  // ---- execute — missing line/character for positional actions ----

  describe("execute — missing position params", () => {
    it("returns error for definition without line", async () => {
      mockExistsSync.mockReturnValue(true);
      vi.resetModules();
      const { execute } = await import("../../tools/lsp.js");
      const result = await execute({ action: "definition", file: "test.ts" }, "/tmp/project");
      expect(result.success).toBe(false);
      expect(result.error).toContain("definition requires line and character");
    });

    it("returns error for references without character", async () => {
      mockExistsSync.mockReturnValue(true);
      vi.resetModules();
      const { execute } = await import("../../tools/lsp.js");
      const result = await execute({ action: "references", file: "test.ts", line: 5 }, "/tmp/project");
      expect(result.success).toBe(false);
      expect(result.error).toContain("references requires line and character");
    });

    it("returns error for hover without position", async () => {
      mockExistsSync.mockReturnValue(true);
      vi.resetModules();
      const { execute } = await import("../../tools/lsp.js");
      const result = await execute({ action: "hover", file: "test.ts" }, "/tmp/project");
      expect(result.success).toBe(false);
      expect(result.error).toContain("hover requires line and character");
    });

    it("allows diagnostics without line/character", async () => {
      // diagnostics does NOT require position, but the file must exist
      // and it will try to ensureServer, which will fail because no lang server
      mockExistsSync.mockImplementation((p: any) => {
        const s = String(p);
        if (s.endsWith("test.ts")) return true;
        return false;
      });
      vi.resetModules();
      const { execute } = await import("../../tools/lsp.js");
      const result = await execute({ action: "diagnostics", file: "/tmp/project/test.ts" }, "/tmp/project");
      // Should fail due to no language server, NOT due to missing position
      expect(result.success).toBe(false);
      expect(result.error).toContain("No language server found");
    });

    it("allows symbols without line/character", async () => {
      mockExistsSync.mockImplementation((p: any) => {
        const s = String(p);
        if (s.endsWith("test.ts")) return true;
        return false;
      });
      vi.resetModules();
      const { execute } = await import("../../tools/lsp.js");
      const result = await execute({ action: "symbols", file: "/tmp/project/test.ts" }, "/tmp/project");
      expect(result.success).toBe(false);
      expect(result.error).toContain("No language server found");
    });
  });

  // ---- execute — no language server detected ----

  describe("execute — no language server", () => {
    it("returns error when no project markers found", async () => {
      mockExistsSync.mockImplementation((p: any) => {
        const s = String(p);
        if (s.endsWith("test.ts")) return true;
        // No tsconfig.json, package.json, pyproject.toml, go.mod, Cargo.toml
        return false;
      });
      vi.resetModules();
      const { execute } = await import("../../tools/lsp.js");
      const result = await execute({ action: "diagnostics", file: "/tmp/project/test.ts" }, "/tmp/project");
      expect(result.success).toBe(false);
      expect(result.error).toContain("No language server found");
      expect(result.error).toContain("Install one");
    });

    it("returns error when TS project exists but server not installed", async () => {
      mockExistsSync.mockImplementation((p: any) => {
        const s = String(p);
        if (s.endsWith("test.ts") || s.endsWith("package.json")) return true;
        return false;
      });
      // Both "which" and "npx" fail
      mockExecSync.mockImplementation(() => { throw new Error("not found"); });
      vi.resetModules();
      const { execute } = await import("../../tools/lsp.js");
      const result = await execute({ action: "diagnostics", file: "/tmp/project/test.ts" }, "/tmp/project");
      expect(result.success).toBe(false);
      expect(result.error).toContain("No language server found");
    });
  });

  // ---- Server-dependent tests using fake timers with shouldAdvanceTime ----
  // The LSP module has a 1000ms indexing delay and 30s request timeouts.
  // Using shouldAdvanceTime lets real async flow proceed while controlling timers.

  async function setupServerTest() {
    vi.resetModules();
    const mockProc = createMockProcess();
    mockSpawn.mockReturnValue(mockProc);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("const x = 1;");
    mockExecSync.mockReturnValue("" as any); // "which" succeeds
    const { execute, shutdown } = await import("../../tools/lsp.js");
    return { execute, shutdown, mockProc };
  }

  /**
   * Start execute, feed the init response when the server sends the init request,
   * wait for the indexing delay, then feed the action response.
   * Uses a polling approach to detect when the mock stdin receives messages.
   */
  async function executeWithResponses(
    execute: Function,
    mockProc: any,
    params: any,
    actionResponse: Buffer,
    workingDir = "/tmp/project",
  ): Promise<any> {
    const promise = execute(params, workingDir);

    // Poll for init request (stdin.write called with "initialize" method)
    await waitForWrite(mockProc, 1);
    // Feed initialize response
    mockProc._feedData(buildLspMessage(1, { capabilities: {} }));

    // Wait for the 1000ms indexing delay (real time, since these tests use real timers)
    await new Promise(r => setTimeout(r, 1200));

    // Poll for action request
    // After init, there's a didOpen notification and then the action request.
    // The action request is the last write. We need to wait for it.
    await waitForWrite(mockProc, 4); // init + initialized notification + didOpen + action = 4 writes

    // Feed action response
    mockProc._feedData(actionResponse);

    return promise;
  }

  async function waitForWrite(mockProc: any, count: number, timeoutMs = 3000) {
    const start = Date.now();
    while (mockProc.stdin.write.mock.calls.length < count) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Timed out waiting for ${count} writes, got ${mockProc.stdin.write.mock.calls.length}`);
      }
      await new Promise(r => setTimeout(r, 10));
    }
  }

  // ---- diagnostics ----

  describe("execute — diagnostics", () => {
    it("returns diagnostics from pull model", async () => {
      const { execute, mockProc } = await setupServerTest();
      const result = await executeWithResponses(execute, mockProc, {
        action: "diagnostics", file: "/tmp/project/test.ts",
      }, buildLspMessage(2, {
        items: [{
          range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
          message: "Type error: unused variable",
          severity: 1,
          source: "ts",
        }],
      }));
      expect(result.success).toBe(true);
      expect(result.content).toContain("ERROR");
      expect(result.content).toContain("unused variable");
      expect(result.content).toContain("1:7");
      expect(result.content).toContain("[ts]");
    }, 10000);

    it("returns no-diagnostics message for clean file", async () => {
      const { execute, mockProc } = await setupServerTest();
      const result = await executeWithResponses(execute, mockProc, {
        action: "diagnostics", file: "/tmp/project/test.ts",
      }, buildLspMessage(2, { items: [] }));
      expect(result.success).toBe(true);
      expect(result.content).toContain("No diagnostics");
    }, 10000);

    it("falls back when pull diagnostics not supported", async () => {
      const { execute, mockProc } = await setupServerTest();
      const result = await executeWithResponses(execute, mockProc, {
        action: "diagnostics", file: "/tmp/project/test.ts",
      }, buildLspError(2, -32601, "Method not found"));
      expect(result.success).toBe(true);
      expect(result.content).toContain("not available via pull model");
    }, 10000);

    it("formats multiple diagnostics with severity levels", async () => {
      const { execute, mockProc } = await setupServerTest();
      const result = await executeWithResponses(execute, mockProc, {
        action: "diagnostics", file: "/tmp/project/test.ts",
      }, buildLspMessage(2, {
        items: [
          { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, message: "err", severity: 1 },
          { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } }, message: "warn", severity: 2 },
          { range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } }, message: "info", severity: 3 },
          { range: { start: { line: 3, character: 0 }, end: { line: 3, character: 5 } }, message: "hint", severity: 4 },
        ],
      }));
      expect(result.success).toBe(true);
      expect(result.content).toContain("4 diagnostic(s)");
      expect(result.content).toContain("ERROR");
      expect(result.content).toContain("WARNING");
      expect(result.content).toContain("INFO");
      expect(result.content).toContain("HINT");
    }, 10000);
  });

  // ---- definition ----

  describe("execute — definition", () => {
    it("returns definition locations", async () => {
      const { execute, mockProc } = await setupServerTest();
      const result = await executeWithResponses(execute, mockProc, {
        action: "definition", file: "/tmp/project/test.ts", line: 1, character: 10,
      }, buildLspMessage(2, [
        { uri: "file:///tmp/project/src/foo.ts", range: { start: { line: 4, character: 0 } } },
      ]));
      expect(result.success).toBe(true);
      expect(result.content).toContain("Definition(s)");
      expect(result.content).toContain("src/foo.ts:5:1");
    }, 10000);

    it("returns no-definition message for null result", async () => {
      const { execute, mockProc } = await setupServerTest();
      const result = await executeWithResponses(execute, mockProc, {
        action: "definition", file: "/tmp/project/test.ts", line: 1, character: 5,
      }, buildLspMessage(2, null));
      expect(result.success).toBe(true);
      expect(result.content).toContain("No definition found");
    }, 10000);

    it("handles single location (non-array) result", async () => {
      const { execute, mockProc } = await setupServerTest();
      const result = await executeWithResponses(execute, mockProc, {
        action: "definition", file: "/tmp/project/test.ts", line: 1, character: 5,
      }, buildLspMessage(2, {
        uri: "file:///tmp/project/lib.ts", range: { start: { line: 9, character: 2 } },
      }));
      expect(result.success).toBe(true);
      expect(result.content).toContain("lib.ts:10:3");
    }, 10000);
  });

  // ---- references ----

  describe("execute — references", () => {
    it("returns reference locations", async () => {
      const { execute, mockProc } = await setupServerTest();
      const result = await executeWithResponses(execute, mockProc, {
        action: "references", file: "/tmp/project/test.ts", line: 1, character: 14,
      }, buildLspMessage(2, [
        { uri: "file:///tmp/project/test.ts", range: { start: { line: 0, character: 13 } } },
        { uri: "file:///tmp/project/app.ts", range: { start: { line: 2, character: 0 } } },
      ]));
      expect(result.success).toBe(true);
      expect(result.content).toContain("2 reference(s)");
      expect(result.content).toContain("test.ts:1:14");
      expect(result.content).toContain("app.ts:3:1");
    }, 10000);

    it("returns no-references for null result", async () => {
      const { execute, mockProc } = await setupServerTest();
      const result = await executeWithResponses(execute, mockProc, {
        action: "references", file: "/tmp/project/test.ts", line: 1, character: 5,
      }, buildLspMessage(2, null));
      expect(result.success).toBe(true);
      expect(result.content).toContain("No references found");
    }, 10000);

    it("returns no-references for empty array", async () => {
      const { execute, mockProc } = await setupServerTest();
      const result = await executeWithResponses(execute, mockProc, {
        action: "references", file: "/tmp/project/test.ts", line: 1, character: 5,
      }, buildLspMessage(2, []));
      expect(result.success).toBe(true);
      expect(result.content).toContain("No references found");
    }, 10000);
  });

  // ---- hover ----

  describe("execute — hover", () => {
    it("returns string hover content", async () => {
      const { execute, mockProc } = await setupServerTest();
      const result = await executeWithResponses(execute, mockProc, {
        action: "hover", file: "/tmp/project/test.ts", line: 1, character: 7,
      }, buildLspMessage(2, { contents: "const x: number" }));
      expect(result.success).toBe(true);
      expect(result.content).toBe("const x: number");
    }, 10000);

    it("returns MarkupContent hover", async () => {
      const { execute, mockProc } = await setupServerTest();
      const result = await executeWithResponses(execute, mockProc, {
        action: "hover", file: "/tmp/project/test.ts", line: 1, character: 7,
      }, buildLspMessage(2, { contents: { value: "let x: number", kind: "markdown" } }));
      expect(result.success).toBe(true);
      expect(result.content).toBe("let x: number");
    }, 10000);

    it("returns array hover content", async () => {
      const { execute, mockProc } = await setupServerTest();
      const result = await executeWithResponses(execute, mockProc, {
        action: "hover", file: "/tmp/project/test.ts", line: 1, character: 7,
      }, buildLspMessage(2, { contents: ["first part", { value: "second part" }] }));
      expect(result.success).toBe(true);
      expect(result.content).toContain("first part");
      expect(result.content).toContain("second part");
    }, 10000);

    it("returns no-hover for null result", async () => {
      const { execute, mockProc } = await setupServerTest();
      const result = await executeWithResponses(execute, mockProc, {
        action: "hover", file: "/tmp/project/test.ts", line: 1, character: 7,
      }, buildLspMessage(2, null));
      expect(result.success).toBe(true);
      expect(result.content).toContain("No hover info");
    }, 10000);
  });

  // ---- symbols ----

  describe("execute — symbols", () => {
    it("returns document symbols with children", async () => {
      const { execute, mockProc } = await setupServerTest();
      const result = await executeWithResponses(execute, mockProc, {
        action: "symbols", file: "/tmp/project/test.ts",
      }, buildLspMessage(2, [
        {
          name: "Foo",
          kind: 5, // Class
          range: { start: { line: 0 } },
          children: [
            { name: "bar", kind: 6, range: { start: { line: 0 } } }, // Method
          ],
        },
      ]));
      expect(result.success).toBe(true);
      expect(result.content).toContain("1 symbol(s)");
      expect(result.content).toContain("Class Foo");
      expect(result.content).toContain("Method bar");
    }, 10000);

    it("returns no-symbols for empty result", async () => {
      const { execute, mockProc } = await setupServerTest();
      const result = await executeWithResponses(execute, mockProc, {
        action: "symbols", file: "/tmp/project/test.ts",
      }, buildLspMessage(2, []));
      expect(result.success).toBe(true);
      expect(result.content).toContain("No symbols found");
    }, 10000);

    it("maps symbol kind numbers to names", async () => {
      const { execute, mockProc } = await setupServerTest();
      const result = await executeWithResponses(execute, mockProc, {
        action: "symbols", file: "/tmp/project/test.ts",
      }, buildLspMessage(2, [
        { name: "myFunc", kind: 12, range: { start: { line: 0 } } },     // Function
        { name: "myVar", kind: 13, range: { start: { line: 5 } } },      // Variable
        { name: "MyInterface", kind: 11, range: { start: { line: 10 } } }, // Interface
      ]));
      expect(result.success).toBe(true);
      expect(result.content).toContain("Function myFunc");
      expect(result.content).toContain("Variable myVar");
      expect(result.content).toContain("Interface MyInterface");
    }, 10000);
  });

  // ---- error handling ----

  describe("execute — error handling", () => {
    it("returns error when server request fails", async () => {
      const { execute, mockProc } = await setupServerTest();
      const result = await executeWithResponses(execute, mockProc, {
        action: "symbols", file: "/tmp/project/test.ts",
      }, buildLspError(2, -32600, "Invalid request"));
      expect(result.success).toBe(false);
      expect(result.error).toContain("LSP symbols failed");
      expect(result.error).toContain("Invalid request");
    }, 10000);
  });

  // ---- language detection ----

  describe("language detection", () => {
    it("detects TypeScript via tsconfig.json", async () => {
      mockExistsSync.mockImplementation((p: any) => {
        const s = String(p);
        return s.endsWith("test.ts") || s.endsWith("tsconfig.json");
      });
      mockExecSync.mockReturnValue("" as any);
      vi.resetModules();
      const { execute } = await import("../../tools/lsp.js");
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);
      mockReadFileSync.mockReturnValue("const x = 1;");

      // Just verify spawn is called with the right command
      const promise = execute({ action: "symbols", file: "/tmp/project/test.ts" }, "/tmp/project");
      await new Promise(r => setTimeout(r, 50));

      expect(mockSpawn).toHaveBeenCalledWith(
        "typescript-language-server",
        ["--stdio"],
        expect.any(Object),
      );

      // Clean up: feed responses so the promise resolves
      mockProc._feedData(buildLspMessage(1, { capabilities: {} }));
      await new Promise(r => setTimeout(r, 1200));
      mockProc._feedData(buildLspMessage(2, []));
      await promise;
    }, 10000);

    it("detects Python via pyproject.toml", async () => {
      mockExistsSync.mockImplementation((p: any) => {
        const s = String(p);
        return s.endsWith("test.py") || s.endsWith("pyproject.toml");
      });
      mockExecSync.mockReturnValue("" as any); // "which pyright-langserver" succeeds
      vi.resetModules();
      const { execute } = await import("../../tools/lsp.js");
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);
      mockReadFileSync.mockReturnValue("x = 1");

      const promise = execute({ action: "symbols", file: "/tmp/project/test.py" }, "/tmp/project");
      await new Promise(r => setTimeout(r, 50));

      expect(mockSpawn).toHaveBeenCalledWith(
        "pyright-langserver",
        ["--stdio"],
        expect.any(Object),
      );

      mockProc._feedData(buildLspMessage(1, { capabilities: {} }));
      await new Promise(r => setTimeout(r, 1200));
      mockProc._feedData(buildLspMessage(2, []));
      await promise;
    }, 10000);

    it("detects Go via go.mod", async () => {
      mockExistsSync.mockImplementation((p: any) => {
        const s = String(p);
        return s.endsWith("test.go") || s.endsWith("go.mod");
      });
      mockExecSync.mockReturnValue("" as any);
      vi.resetModules();
      const { execute } = await import("../../tools/lsp.js");
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);
      mockReadFileSync.mockReturnValue("package main");

      const promise = execute({ action: "symbols", file: "/tmp/project/test.go" }, "/tmp/project");
      await new Promise(r => setTimeout(r, 50));

      expect(mockSpawn).toHaveBeenCalledWith(
        "gopls",
        ["serve"],
        expect.any(Object),
      );

      mockProc._feedData(buildLspMessage(1, { capabilities: {} }));
      await new Promise(r => setTimeout(r, 1200));
      mockProc._feedData(buildLspMessage(2, []));
      await promise;
    }, 10000);

    it("detects Rust via Cargo.toml", async () => {
      mockExistsSync.mockImplementation((p: any) => {
        const s = String(p);
        return s.endsWith("test.rs") || s.endsWith("Cargo.toml");
      });
      mockExecSync.mockReturnValue("" as any);
      vi.resetModules();
      const { execute } = await import("../../tools/lsp.js");
      const mockProc = createMockProcess();
      mockSpawn.mockReturnValue(mockProc);
      mockReadFileSync.mockReturnValue("fn main() {}");

      const promise = execute({ action: "symbols", file: "/tmp/project/test.rs" }, "/tmp/project");
      await new Promise(r => setTimeout(r, 50));

      expect(mockSpawn).toHaveBeenCalledWith(
        "rust-analyzer",
        [],
        expect.any(Object),
      );

      mockProc._feedData(buildLspMessage(1, { capabilities: {} }));
      await new Promise(r => setTimeout(r, 1200));
      mockProc._feedData(buildLspMessage(2, []));
      await promise;
    }, 10000);
  });

  // ---- shutdown ----

  describe("shutdown", () => {
    it("does not throw when no server is running", async () => {
      vi.resetModules();
      const { shutdown } = await import("../../tools/lsp.js");
      expect(() => shutdown()).not.toThrow();
    });
  });
});
