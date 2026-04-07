import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("../logger.js", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

// Mock child_process.execSync for URL tests — must be hoisted before importing the module
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

import { execSync } from "child_process";
import {
  parseImageReferences,
  toMessageContent,
  resolveFileReferences,
  resolveFolderReferences,
  resolveUrlReferences,
} from "../image-support.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wm-img-test-"));
}

function writeFile(dir: string, name: string, content: string | Buffer): string {
  const full = path.join(dir, name);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  if (typeof content === "string") {
    fs.writeFileSync(full, content, "utf-8");
  } else {
    fs.writeFileSync(full, content);
  }
  return full;
}

// Minimal 1x1 transparent PNG (67 bytes)
const TINY_PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
    "0000000a49444154789c6260000000020001e221bc330000000049454e44ae426082",
  "hex",
);

// ---------------------------------------------------------------------------
// parseImageReferences
// ---------------------------------------------------------------------------

describe("parseImageReferences", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns plain text part when there are no image references", () => {
    const result = parseImageReferences("just some text", tmpDir);
    expect(result.hasImages).toBe(false);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toEqual({ type: "text", text: "just some text" });
  });

  it("reads a valid PNG file and returns an image part", () => {
    writeFile(tmpDir, "screenshot.png", TINY_PNG_BYTES);
    const result = parseImageReferences("@screenshot.png", tmpDir);
    expect(result.hasImages).toBe(true);
    const imagePart = result.parts.find((p) => p.type === "image");
    expect(imagePart).toBeDefined();
    expect(imagePart!.mimeType).toBe("image/png");
    expect(imagePart!.image).toBe(TINY_PNG_BYTES.toString("base64"));
  });

  it("preserves text before and after the image reference", () => {
    writeFile(tmpDir, "photo.jpg", TINY_PNG_BYTES);
    const result = parseImageReferences("here is the image @photo.jpg and some trailing text", tmpDir);
    expect(result.hasImages).toBe(true);
    const types = result.parts.map((p) => p.type);
    expect(types).toContain("text");
    expect(types).toContain("image");
    const texts = result.parts.filter((p) => p.type === "text").map((p) => p.text);
    expect(texts.some((t) => t!.includes("here is the image"))).toBe(true);
    expect(texts.some((t) => t!.includes("and some trailing text"))).toBe(true);
  });

  it("returns (image not found: ...) text part for missing image file", () => {
    const result = parseImageReferences("check @missing.png out", tmpDir);
    expect(result.hasImages).toBe(false);
    const found = result.parts.find((p) => p.type === "text" && p.text!.includes("image not found: missing.png"));
    expect(found).toBeDefined();
  });

  it("blocks path traversal with ../ references", () => {
    const result = parseImageReferences("@../outside.png", tmpDir);
    expect(result.hasImages).toBe(false);
    const blocked = result.parts.find((p) => p.text!.includes("blocked") && p.text!.includes("outside working directory"));
    expect(blocked).toBeDefined();
  });

  it("allows explicit absolute image paths outside working directory", () => {
    const outsideDir = makeTempDir();
    try {
      const absoluteImagePath = writeFile(outsideDir, "outside.png", TINY_PNG_BYTES);
      const result = parseImageReferences(`check @${absoluteImagePath} please`, tmpDir);
      expect(result.hasImages).toBe(true);
      const imagePart = result.parts.find((p) => p.type === "image");
      expect(imagePart).toBeDefined();
      expect(imagePart!.mimeType).toBe("image/png");
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("supports quoted image paths with spaces", () => {
    const imagePath = writeFile(tmpDir, "my screenshot.png", TINY_PNG_BYTES);
    const result = parseImageReferences(`analyze @"${imagePath}"`, tmpDir);
    expect(result.hasImages).toBe(true);
    const imagePart = result.parts.find((p) => p.type === "image");
    expect(imagePart).toBeDefined();
    expect(imagePart!.mimeType).toBe("image/png");
  });

  it("handles multiple image references in one input", () => {
    writeFile(tmpDir, "a.png", TINY_PNG_BYTES);
    writeFile(tmpDir, "b.webp", TINY_PNG_BYTES);
    const result = parseImageReferences("first @a.png and second @b.webp", tmpDir);
    expect(result.hasImages).toBe(true);
    const imageParts = result.parts.filter((p) => p.type === "image");
    expect(imageParts).toHaveLength(2);
  });

  it("assigns correct mimeType for jpg", () => {
    writeFile(tmpDir, "photo.jpg", TINY_PNG_BYTES);
    const result = parseImageReferences("@photo.jpg", tmpDir);
    const img = result.parts.find((p) => p.type === "image");
    expect(img!.mimeType).toBe("image/jpeg");
  });

  it("assigns correct mimeType for gif", () => {
    writeFile(tmpDir, "anim.gif", TINY_PNG_BYTES);
    const result = parseImageReferences("@anim.gif", tmpDir);
    const img = result.parts.find((p) => p.type === "image");
    expect(img!.mimeType).toBe("image/gif");
  });

  it("assigns correct mimeType for webp", () => {
    writeFile(tmpDir, "img.webp", TINY_PNG_BYTES);
    const result = parseImageReferences("@img.webp", tmpDir);
    const img = result.parts.find((p) => p.type === "image");
    expect(img!.mimeType).toBe("image/webp");
  });
});

// ---------------------------------------------------------------------------
// toMessageContent
// ---------------------------------------------------------------------------

describe("toMessageContent", () => {
  it("returns a string when there is a single text part", () => {
    const result = toMessageContent([{ type: "text", text: "hello world" }]);
    expect(result).toBe("hello world");
  });

  it("returns an empty string for a single text part with no text", () => {
    const result = toMessageContent([{ type: "text" }]);
    expect(result).toBe("");
  });

  it("returns an array when there are multiple parts", () => {
    const parts = [
      { type: "text" as const, text: "describe this:" },
      { type: "image" as const, image: "base64data", mimeType: "image/png" },
    ];
    const result = toMessageContent(parts);
    expect(Array.isArray(result)).toBe(true);
    const arr = result as Array<{ type: string }>;
    expect(arr).toHaveLength(2);
    expect(arr[0]).toEqual({ type: "text", text: "describe this:" });
    expect(arr[1]).toEqual({ type: "image", image: "base64data", mimeType: "image/png" });
  });

  it("returns an array when there is a single image part", () => {
    const parts = [{ type: "image" as const, image: "b64", mimeType: "image/png" }];
    const result = toMessageContent(parts);
    expect(Array.isArray(result)).toBe(true);
  });

  it("preserves mimeType undefined when not set on image part", () => {
    const parts = [
      { type: "text" as const, text: "a" },
      { type: "image" as const, image: "b64" },
    ];
    const result = toMessageContent(parts) as Array<{ type: string; mimeType?: string }>;
    const imgEntry = result.find((r) => r.type === "image");
    expect(imgEntry!.mimeType).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resolveFileReferences
// ---------------------------------------------------------------------------

describe("resolveFileReferences", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns input unchanged when there are no @file references", () => {
    const input = "just some regular text with no refs";
    expect(resolveFileReferences(input, tmpDir)).toBe(input);
  });

  it("replaces @file.ts with a fenced code block containing its contents", () => {
    writeFile(tmpDir, "hello.ts", "export const x = 1;\n");
    const result = resolveFileReferences("check @hello.ts please", tmpDir);
    expect(result).toContain("```ts");
    expect(result).toContain("// hello.ts");
    expect(result).toContain("export const x = 1;");
    expect(result).not.toContain("@hello.ts");
  });

  it("uses the correct language tag for .json files", () => {
    writeFile(tmpDir, "config.json", '{"key": "value"}');
    const result = resolveFileReferences("@config.json", tmpDir);
    expect(result).toContain("```json");
  });

  it("uses the correct language tag for .py files", () => {
    writeFile(tmpDir, "script.py", "print('hi')");
    const result = resolveFileReferences("@script.py", tmpDir);
    expect(result).toContain("```py");
  });

  it("replaces missing file with (file not found: ...) message", () => {
    const result = resolveFileReferences("look at @nonexistent.ts", tmpDir);
    expect(result).toContain("(file not found: nonexistent.ts)");
  });

  it("blocks path traversal for @../outside.ts", () => {
    const result = resolveFileReferences("@../outside.ts", tmpDir);
    expect(result).toContain("blocked");
    expect(result).toContain("outside working directory");
  });

  it("handles multiple file references in one input", () => {
    writeFile(tmpDir, "a.ts", "const a = 1;");
    writeFile(tmpDir, "b.ts", "const b = 2;");
    const result = resolveFileReferences("@a.ts and @b.ts", tmpDir);
    expect(result).toContain("const a = 1;");
    expect(result).toContain("const b = 2;");
  });

  it("handles .tsx files", () => {
    writeFile(tmpDir, "Component.tsx", "export default function Comp() { return null; }");
    const result = resolveFileReferences("@Component.tsx", tmpDir);
    expect(result).toContain("```tsx");
    expect(result).toContain("export default function Comp");
  });

  it("handles .md files", () => {
    writeFile(tmpDir, "README.md", "# Hello");
    const result = resolveFileReferences("@README.md", tmpDir);
    expect(result).toContain("```md");
    expect(result).toContain("# Hello");
  });
});

// ---------------------------------------------------------------------------
// resolveFolderReferences
// ---------------------------------------------------------------------------

describe("resolveFolderReferences", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns input unchanged when there are no @dir/ references", () => {
    const input = "no folder references here";
    expect(resolveFolderReferences(input, tmpDir)).toBe(input);
  });

  it("replaces @subdir/ with a tree listing of the directory", () => {
    const subdir = path.join(tmpDir, "mydir");
    fs.mkdirSync(subdir);
    writeFile(tmpDir, "mydir/file.ts", "const x = 1;");
    const result = resolveFolderReferences("@mydir/", tmpDir);
    expect(result).toContain("```");
    expect(result).toContain("// mydir/");
    expect(result).toContain("file.ts");
  });

  it("skips node_modules in the directory tree", () => {
    const subdir = path.join(tmpDir, "project");
    fs.mkdirSync(subdir);
    fs.mkdirSync(path.join(subdir, "node_modules"));
    writeFile(tmpDir, "project/node_modules/pkg.js", "module.exports = {};");
    writeFile(tmpDir, "project/index.ts", "export {};");
    const result = resolveFolderReferences("@project/", tmpDir);
    expect(result).not.toContain("node_modules");
    expect(result).toContain("index.ts");
  });

  it("skips .git in the directory tree", () => {
    const subdir = path.join(tmpDir, "repo");
    fs.mkdirSync(subdir);
    fs.mkdirSync(path.join(subdir, ".git"));
    writeFile(tmpDir, "repo/.git/HEAD", "ref: refs/heads/main");
    writeFile(tmpDir, "repo/main.ts", "export {};");
    const result = resolveFolderReferences("@repo/", tmpDir);
    expect(result).not.toContain(".git");
    expect(result).toContain("main.ts");
  });

  it("blocks path traversal for @../", () => {
    const result = resolveFolderReferences("@../", tmpDir);
    expect(result).toContain("blocked");
    expect(result).toContain("outside working directory");
  });

  it("replaces missing directory with (directory not found: ...) message", () => {
    const result = resolveFolderReferences("@nonexistent/", tmpDir);
    expect(result).toContain("(directory not found: nonexistent/)");
  });

  it("lists nested directories up to depth 2", () => {
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "src", "utils"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "src", "utils", "deep"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "src", "utils", "deep", "extra"), { recursive: true });
    writeFile(tmpDir, "src/index.ts", "");
    writeFile(tmpDir, "src/utils/helper.ts", "");
    writeFile(tmpDir, "src/utils/deep/buried.ts", "");
    writeFile(tmpDir, "src/utils/deep/extra/toodeep.ts", "");
    const result = resolveFolderReferences("@src/", tmpDir);
    // depth 0: src/ contents — index.ts, utils/
    // depth 1: utils/ contents — deep/, helper.ts
    // depth 2: deep/ contents — buried.ts, extra/ (listed but not recursed into)
    // depth 3 would be extra/ contents — toodeep.ts should NOT appear (depth > maxDepth)
    expect(result).toContain("index.ts");
    expect(result).toContain("helper.ts");
    expect(result).toContain("buried.ts");
    expect(result).not.toContain("toodeep.ts");
  });

  it("skips hidden directories (starting with .)", () => {
    const subdir = path.join(tmpDir, "proj");
    fs.mkdirSync(subdir);
    fs.mkdirSync(path.join(subdir, ".cache"), { recursive: true });
    writeFile(tmpDir, "proj/.cache/data.json", "{}");
    writeFile(tmpDir, "proj/app.ts", "");
    const result = resolveFolderReferences("@proj/", tmpDir);
    expect(result).not.toContain(".cache");
    expect(result).toContain("app.ts");
  });
});

// ---------------------------------------------------------------------------
// resolveUrlReferences
// ---------------------------------------------------------------------------

describe("resolveUrlReferences", () => {
  const mockedExecSync = execSync as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns input unchanged when there are no @https:// references", async () => {
    const input = "no urls here";
    const result = await resolveUrlReferences(input);
    expect(result).toBe(input);
    expect(mockedExecSync).not.toHaveBeenCalled();
  });

  it("replaces @https://url with fetched content in a code block", async () => {
    mockedExecSync.mockReturnValueOnce("fetched page content");
    const result = await resolveUrlReferences("see @https://example.com/api");
    expect(result).toContain("```");
    expect(result).toContain("// fetched from https://example.com/api");
    expect(result).toContain("fetched page content");
    expect(result).not.toContain("@https://example.com/api");
  });

  it("calls curl with the correct flags and URL", async () => {
    mockedExecSync.mockReturnValueOnce("response body");
    await resolveUrlReferences("@https://api.example.com/data");
    expect(mockedExecSync).toHaveBeenCalledOnce();
    const [cmd] = mockedExecSync.mock.calls[0] as [string, ...unknown[]];
    expect(cmd).toContain("curl -sL");
    expect(cmd).toContain("--max-time 10");
    expect(cmd).toContain("--max-filesize 10240");
    expect(cmd).toContain('"https://api.example.com/data"');
  });

  it("replaces URL with (failed to fetch: ...) when curl throws", async () => {
    mockedExecSync.mockImplementationOnce(() => {
      throw new Error("curl: (6) Could not resolve host");
    });
    const result = await resolveUrlReferences("@https://unreachable.invalid");
    expect(result).toContain("(failed to fetch: https://unreachable.invalid)");
  });

  it("handles http:// URLs in addition to https://", async () => {
    mockedExecSync.mockReturnValueOnce("plain http response");
    const result = await resolveUrlReferences("@http://example.com/page");
    expect(result).toContain("// fetched from http://example.com/page");
    expect(result).toContain("plain http response");
  });

  it("handles multiple URL references in one input", async () => {
    mockedExecSync
      .mockReturnValueOnce("first content")
      .mockReturnValueOnce("second content");
    const result = await resolveUrlReferences("@https://a.com and @https://b.com");
    expect(result).toContain("first content");
    expect(result).toContain("second content");
    expect(mockedExecSync).toHaveBeenCalledTimes(2);
  });

  it("trims whitespace from fetched content", async () => {
    mockedExecSync.mockReturnValueOnce("   trimmed content   ");
    const result = await resolveUrlReferences("@https://example.com");
    expect(result).toContain("trimmed content");
    expect(result).not.toContain("   trimmed content   ");
  });
});
