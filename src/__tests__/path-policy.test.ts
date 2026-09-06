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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-path-policy-"));
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

  it("rejects traversal and sibling-prefix escapes", () => {
    const workspace = tempDir();
    const sibling = `${workspace}-sibling`;
    fs.mkdirSync(sibling);
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
    const tools = createToolDefinitions(workspace, undefined, true, {
      extraPathGrants: [{ root: approved, access: "read" }],
    }) as Record<string, { execute: (input: unknown) => Promise<unknown> }>;

    await expect(tools.read_file.execute({ path: imagePath })).resolves.toBe("not an image");
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
});
