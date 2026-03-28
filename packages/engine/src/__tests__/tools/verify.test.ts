import { createTempDir, cleanupTempDir } from "../helpers/temp-dir.js";
import { createToolDefinitions } from "../../tools/index.js";

const CTX = { toolCallId: "1", messages: [] as any[] };

describe("verify tool", () => {
  let dir: string;
  let tools: ReturnType<typeof createToolDefinitions>;

  beforeEach(() => {
    dir = createTempDir("wm-verify-");
    tools = createToolDefinitions(dir);
  });

  afterEach(() => cleanupTempDir(dir));

  it("reports passing command", async () => {
    const result = await tools.verify.execute({ command: "echo ok" }, CTX);
    expect(result).toContain("PASSED");
    expect(result).toContain("exit code 0");
  });

  it("reports failing command", async () => {
    const result = await tools.verify.execute({ command: "exit 1" }, CTX);
    expect(result).toContain("FAILED");
  });

  describe("output parsing", () => {
    it("parses Jest output with failures", async () => {
      const jestOutput = `FAIL src/app.test.ts
  ● some test

    expect(received).toBe(expected)

Tests:  1 failed, 3 passed, 4 total
Test Suites:  1 failed, 2 passed, 3 total`;
      const result = await tools.verify.execute(
        { command: `echo '${jestOutput}'; exit 1` },
        CTX
      );
      expect(result).toContain("FAILED");
      expect(result).toContain("3 passed, 1 failed");
    });

    it("parses Jest output all passing", async () => {
      const jestOutput = `PASS src/app.test.ts
  ✓ test one (5 ms)
  ✓ test two (2 ms)

Tests:  3 passed, 3 total
Test Suites:  1 passed, 1 total`;
      const result = await tools.verify.execute(
        { command: `echo '${jestOutput}'` },
        CTX
      );
      expect(result).toContain("PASSED");
      expect(result).toContain("3 passed, 0 failed");
    });

    it("parses Vitest output", async () => {
      const vitestOutput = ` ✓ src/utils.test.ts (3 tests)

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  10:00:00
   Duration  1.23s`;
      const result = await tools.verify.execute(
        { command: `printf '%s' '${vitestOutput.replace(/'/g, "'\\''")}'` },
        CTX
      );
      expect(result).toContain("PASSED");
      expect(result).toContain("3 passed");
    });

    it("parses pytest output with failures", async () => {
      const pytestOutput = `============================= test session starts ==============================
collected 5 items

tests/test_app.py ..F.F

=============================== FAILURES =======================================
...
========================= 3 passed, 2 failed =========================`;
      const result = await tools.verify.execute(
        { command: `echo '${pytestOutput}'; exit 1` },
        CTX
      );
      expect(result).toContain("FAILED");
      expect(result).toContain("3 passed, 2 failed");
    });

    it("parses pytest output all passing", async () => {
      const pytestOutput = `============================= test session starts ==============================
collected 5 items

tests/test_app.py .....

============================== 5 passed ==============================`;
      const result = await tools.verify.execute(
        { command: `echo '${pytestOutput}'` },
        CTX
      );
      expect(result).toContain("PASSED");
      expect(result).toContain("5 passed, 0 failed");
    });

    it("parses Go test output with failures", async () => {
      const goOutput = `--- FAIL: TestSomething (0.00s)
    app_test.go:10: expected 1, got 2
FAIL	github.com/user/repo/pkg	0.005s
ok  	github.com/user/repo/other	0.003s`;
      const result = await tools.verify.execute(
        { command: `printf '%s' '${goOutput.replace(/'/g, "'\\''")}'; exit 1` },
        CTX
      );
      expect(result).toContain("FAILED");
      expect(result).toContain("1 ok");
      expect(result).toContain("failed");
    });

    it("parses eslint output with errors", async () => {
      const eslintOutput = `/src/app.ts
  1:1  error  Unexpected var, use let or const instead  no-var
  2:5  warning  Unexpected console statement             no-console

✖ 2 problems (1 error, 1 warning)`;
      const result = await tools.verify.execute(
        { command: `printf '%s' '${eslintOutput.replace(/'/g, "'\\''")}'; exit 1` },
        CTX
      );
      expect(result).toContain("FAILED");
      expect(result).toContain("1 error");
      expect(result).toContain("1 warning");
    });

    it("parses Playwright output", async () => {
      // Playwright puts pass/fail on one line like "4 passed, 1 failed"
      const result = await tools.verify.execute(
        { command: `echo '  4 passed, 1 failed'; exit 1` },
        CTX
      );
      expect(result).toContain("FAILED");
      expect(result).toContain("4 passed, 1 failed");
    });

    it("parses tsc type errors from non-zero exit", async () => {
      const tscOutput = `src/app.ts(5,3): error TS2322: Type 'string' is not assignable to type 'number'.
src/app.ts(10,7): error TS2345: Argument of type 'number' is not assignable.`;
      const result = await tools.verify.execute(
        { command: `echo '${tscOutput}'; exit 1` },
        CTX
      );
      expect(result).toContain("FAILED");
      expect(result).toContain("2 type error");
    });
  });
});
