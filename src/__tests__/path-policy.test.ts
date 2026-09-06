import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalizePath,
  createPathScope,
  resolveAllPaths,
  resolvePath,
  type PathGrant,
} from "../engine/path-policy.js";
import { createToolDefinitions } from "../engine/tools/index.js";

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wm-path-policy-")));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("canonical filesystem path policy", () => {
  it("canonicalizes existing paths and the nearest parent for new files", () => {
    const workspace = tempDir();
    fs.mkdirSync(path.join(workspace, "src"));
    fs.writeFileSync(path.join(workspace, "src", "file.ts"), "ok");
    const scope = createPathScope(workspace);

    expect(resolvePath(scope, "src/file.ts", "read")).toBe(
      fs.realpathSync(path.join(workspace, "src/file.ts")),
    );
    expect(resolvePath(scope, "src/new/deep/file.ts", "read_write")).toBe(
      path.join(workspace, "src", "new", "deep", "file.ts"),
    );
  });

  it("preserves repeated directory basenames while resolving new files", () => {
    const workspace = tempDir();
    const scope = createPathScope(workspace);
    expect(resolvePath(scope, "new/new/file.txt", "read_write")).toBe(
      path.join(workspace, "new", "new", "file.txt"),
    );
  });

  it("rejects traversal and sibling-prefix escapes", () => {
    const workspace = tempDir();
    const sibling = `${workspace}-sibling`;
    fs.mkdirSync(sibling);
    tempDirs.push(sibling);
    const scope = createPathScope(workspace);
    expect(() => resolvePath(scope, "../outside.txt", "read")).toThrow();
    expect(() => resolvePath(scope, sibling, "read")).toThrow();
  });

  it("rejects existing and parent symlink escapes, including new writes", () => {
    const workspace = tempDir();
    const outside = tempDir();
    fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
    fs.symlinkSync(outside, path.join(workspace, "linked"), "dir");
    const scope = createPathScope(workspace);

    expect(() => resolvePath(scope, "linked/secret.txt", "read")).toThrow();
    expect(() => resolvePath(scope, "linked/new.txt", "read_write")).toThrow();
  });

  it("requires read_write for mutations and does not expand exact-file grants", () => {
    const workspace = tempDir();
    const approved = tempDir();
    const file = path.join(approved, "approved.txt");
    fs.writeFileSync(file, "approved");
    const grant: PathGrant = { root: file, access: "read" };
    const scope = createPathScope(workspace, [grant]);

    expect(resolvePath(scope, file, "read")).toBe(fs.realpathSync(file));
    expect(() => resolvePath(scope, file, "read_write")).toThrow();
    expect(() => resolvePath(scope, `${file}/child`, "read")).toThrow();
  });

  it("preserves an exact file grant if the filesystem entry is replaced by a directory", () => {
    const workspace = tempDir();
    const approved = path.join(tempDir(), "approved");
    fs.writeFileSync(approved, "approved");
    const scope = createPathScope(workspace, [{ root: approved, access: "read" }]);
    fs.rmSync(approved);
    fs.mkdirSync(approved);
    fs.writeFileSync(path.join(approved, "secret.txt"), "secret");

    expect(() => resolvePath(scope, path.join(approved, "secret.txt"), "read")).toThrow();
  });

  it("validates every path in a request before returning any", () => {
    const workspace = tempDir();
    fs.writeFileSync(path.join(workspace, "ok.txt"), "ok");
    const scope = createPathScope(workspace);
    expect(() => resolveAllPaths(scope, ["ok.txt", "../escape.txt"], "read_write")).toThrow();
  });

  it("uses explicit grants for absolute image/file tools", async () => {
    const workspace = tempDir();
    const approved = tempDir();
    const imagePath = path.join(approved, "image.bin");
    fs.writeFileSync(imagePath, Buffer.from("not an image"));
    const pngPath = path.join(approved, "image.png");
    fs.writeFileSync(pngPath, Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
      "0000000a49444154789c6260000000020001e221bc330000000049454e44ae426082",
      "hex",
    ));
    const tools = createToolDefinitions(workspace, undefined, true, {
      extraPathGrants: [{ root: approved, access: "read" }],
    }) as Record<string, { execute: (input: unknown) => Promise<unknown> }>;

    await expect(tools.read_file.execute({ path: imagePath })).resolves.toBe("not an image");
    await expect(tools.view_image.execute({ path: pngPath })).resolves.toMatchObject({ content: expect.any(Array) });
    await expect(tools.view_image.execute({ path: path.join(tempDir(), "outside.png") })).rejects.toThrow();
    await expect(tools.read_file.execute({ path: path.join(tempDir(), "nope") })).rejects.toThrow();
  });

  it("keeps full-disk mode canonical while allowing an outside path", () => {
    const workspace = tempDir();
    const outside = tempDir();
    const scope = createPathScope(workspace);
    expect(resolvePath(scope, path.join(outside, "new.txt"), "read_write", { enforceScope: false })).toBe(
      path.join(outside, "new.txt"),
    );
    expect(canonicalizePath(workspace)).toBe(fs.realpathSync(workspace));
  });

  it("preflights every unified-diff target before patch mutation", async () => {
    const workspace = tempDir();
    const file = path.join(workspace, "safe.txt");
    fs.writeFileSync(file, "safe\n");
    const tools = createToolDefinitions(workspace) as Record<string, { execute: (input: unknown) => Promise<unknown> }>;
    const patch = [
      "--- a/safe.txt",
      "+++ b/safe.txt",
      "@@ -1 +1 @@",
      "-safe",
      "+changed",
      "--- a/../escape.txt",
      "+++ b/../escape.txt",
      "@@ -1 +1 @@",
      "-outside",
      "+escaped",
      "",
    ].join("\n");

    await expect(tools.patch.execute({ patch_text: patch })).rejects.toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe("safe\n");
  });

  it("applies timestamped multi-file patches, additions, deletions, and marker-like hunk text", async () => {
    const workspace = tempDir();
    const safe = path.join(workspace, "safe.txt");
    const deleted = path.join(workspace, "deleted.txt");
    fs.writeFileSync(safe, "old\n--- remove\n+++ add\n");
    fs.writeFileSync(deleted, "gone\n");
    const tools = createToolDefinitions(workspace) as Record<string, { execute: (input: unknown) => Promise<unknown> }>;
    const patch = [
      "--- a/safe.txt\t2024-01-01",
      "+++ b/safe.txt\t2024-01-01",
      "@@ -1,3 +1,3 @@",
      " old",
      "---- remove",
      "+--- changed",
      " +++ add",
      "--- a/deleted.txt",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-gone",
      "--- /dev/null",
      "+++ b/created.txt",
      "@@ -0,0 +1 @@",
      "+created",
      "",
    ].join("\n");

    await expect(tools.patch.execute({ patch_text: patch })).resolves.toContain("Patch applied successfully");
    expect(fs.readFileSync(safe, "utf8")).toBe("old\n--- changed\n+++ add\n");
    expect(fs.existsSync(deleted)).toBe(false);
    expect(fs.readFileSync(path.join(workspace, "created.txt"), "utf8")).toBe("created\n");
  });

  it("continues through no-newline metadata to validate and apply later hunks", async () => {
    const workspace = tempDir();
    const file = path.join(workspace, "two-hunks.txt");
    fs.writeFileSync(file, "one\ntwo\nthree\n");
    const tools = createToolDefinitions(workspace) as Record<string, { execute: (input: unknown) => Promise<unknown> }>;
    const patch = [
      "--- a/two-hunks.txt",
      "+++ b/two-hunks.txt",
      "@@ -1 +1 @@",
      "-one",
      "+ONE",
      "\\ No newline at end of file",
      "@@ -3 +3 @@",
      "-three",
      "+THREE",
      "",
    ].join("\n");

    await expect(tools.patch.execute({ patch_text: patch })).resolves.toContain("Patch applied successfully");
    expect(fs.readFileSync(file, "utf8")).toBe("ONE\ntwo\nTHREE\n");
  });
});
