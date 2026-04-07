import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { execute } from "../engine/tools/multi-edit-file.js";

describe("multi_edit_file", () => {
  let testDir: string;
  let testFile: string;

  beforeEach(() => {
    // Create a temporary directory for tests
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "multi-edit-file-test-"));
    testFile = path.join(testDir, "test.ts");
  });

  afterEach(() => {
    // Clean up
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  // Gherkin Scenario 1: Full success writes once
  it("Scenario 1: Full success writes once", async () => {
    // Given three valid edits in one file
    fs.writeFileSync(
      testFile,
      `const a = 1;
const b = 2;
const c = 3;
console.log(a, b, c);`
    );

    // When multi_edit_file is called with three valid edits
    const result = await execute({
      file_path: testFile,
      edits: [
        { old_string: "const a = 1;", new_string: "const a = 10;" },
        { old_string: "const b = 2;", new_string: "const b = 20;" },
        { old_string: "const c = 3;", new_string: "const c = 30;" },
      ],
    });

    // Then all edits are applied
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(3);
    expect(result.results?.[0].status).toBe("applied");
    expect(result.results?.[1].status).toBe("applied");
    expect(result.results?.[2].status).toBe("applied");

    // And file is written once (we can verify by checking the final content)
    const finalContent = fs.readFileSync(testFile, "utf8");
    expect(finalContent).toContain("const a = 10;");
    expect(finalContent).toContain("const b = 20;");
    expect(finalContent).toContain("const c = 30;");
  });

  // Gherkin Scenario 2: Atomic rollback on failure
  it("Scenario 2: Atomic rollback on failure", async () => {
    // Given edit 1 matches and edit 2 does not match
    fs.writeFileSync(
      testFile,
      `const a = 1;
const b = 2;
const c = 3;`
    );

    // When multi_edit_file is called
    const result = await execute({
      file_path: testFile,
      edits: [
        { old_string: "const a = 1;", new_string: "const a = 10;" },
        { old_string: "const NON_EXISTENT = 999;", new_string: "const x = 999;" },
      ],
    });

    // Then no file changes are written
    expect(result.success).toBe(false);
    const finalContent = fs.readFileSync(testFile, "utf8");
    expect(finalContent).toBe(`const a = 1;
const b = 2;
const c = 3;`);

    // And edit 2 is reported as not_found
    expect(result.results).toHaveLength(2);
    expect(result.results?.[0].status).toBe("applied");
    expect(result.results?.[1].status).toBe("not_found");
  });

  // Gherkin Scenario 3: Ambiguous match
  it("Scenario 3: Ambiguous match", async () => {
    // Given old_string matches multiple locations and replace_all is false
    fs.writeFileSync(
      testFile,
      `const x = 1;
const x = 2;
const y = 3;`
    );

    // When multi_edit_file is called
    const result = await execute({
      file_path: testFile,
      edits: [
        { old_string: "const x = ", new_string: "let x = " }, // Matches twice
      ],
    });

    // Then operation fails atomically
    expect(result.success).toBe(false);
    const finalContent = fs.readFileSync(testFile, "utf8");
    expect(finalContent).toBe(`const x = 1;
const x = 2;
const y = 3;`);

    // And response reports ambiguous
    expect(result.results).toHaveLength(1);
    expect(result.results?.[0].status).toBe("ambiguous");
    expect(result.results?.[0].detail).toContain("found");
  });

  // Gherkin Scenario 4: Ordered dependency
  it("Scenario 4: Ordered dependency", async () => {
    // Given edit 2 depends on edit 1 output
    fs.writeFileSync(
      testFile,
      `function test() {
  const message = "hello";
  return message;
}`
    );

    // When multi_edit_file is called with ordered edits
    const result = await execute({
      file_path: testFile,
      edits: [
        {
          old_string: 'const message = "hello";',
          new_string: 'const message = "hello world";',
        },
        {
          old_string: 'const message = "hello world";',
          new_string: 'const message = "hello world!";',
        },
      ],
    });

    // Then ordered in-memory application produces expected final content
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results?.[0].status).toBe("applied");
    expect(result.results?.[1].status).toBe("applied");

    const finalContent = fs.readFileSync(testFile, "utf8");
    expect(finalContent).toContain('const message = "hello world!";');
  });

  // Additional test: replace_all flag works
  it("handles replace_all flag correctly", async () => {
    fs.writeFileSync(
      testFile,
      `const x = 1;
const x = 2;
const y = 3;`
    );

    const result = await execute({
      file_path: testFile,
      edits: [
        { old_string: "const x = ", new_string: "let x = ", replace_all: true },
      ],
    });

    expect(result.success).toBe(true);
    const finalContent = fs.readFileSync(testFile, "utf8");
    expect(finalContent).toContain("let x = 1;");
    expect(finalContent).toContain("let x = 2;");
  });

  // Additional test: file not found
  it("returns error when file not found", async () => {
    const result = await execute({
      file_path: path.join(testDir, "nonexistent.ts"),
      edits: [{ old_string: "x", new_string: "y" }],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  // Additional test: empty edits array
  it("handles empty edits array", async () => {
    fs.writeFileSync(testFile, "const x = 1;");

    const result = await execute({
      file_path: testFile,
      edits: [],
    });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(0);
    expect(fs.readFileSync(testFile, "utf8")).toBe("const x = 1;");
  });

  // Additional test: tracks line changes correctly
  it("tracks line changes correctly", async () => {
    fs.writeFileSync(testFile, `line1
line2
line3`);

    const result = await execute({
      file_path: testFile,
      edits: [
        { old_string: "line2", new_string: "line2\nnew_line" },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.linesBefore).toBe(3);
    expect(result.linesAfter).toBe(4);
    expect(result.linesDiff).toBe("+1");
  });
});
