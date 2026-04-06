import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { createLiveViewServer } from "../live-view-server.js";

function createTempGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-live-view-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@example.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
  fs.writeFileSync(path.join(dir, "README.md"), "# test\n", "utf-8");
  execSync("git add README.md", { cwd: dir, stdio: "pipe" });
  execSync('git commit -m "init"', { cwd: dir, stdio: "pipe" });
  return dir;
}

async function readFirstSseEvent(port: number): Promise<any> {
  return await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: "/events",
      method: "GET",
      headers: { Accept: "text/event-stream" },
    }, (res) => {
      let buffer = "";
      res.setEncoding("utf-8");
      res.on("data", (chunk: string) => {
        buffer += chunk;
        const marker = "\n\n";
        const idx = buffer.indexOf(marker);
        if (idx === -1) return;
        const packet = buffer.slice(0, idx);
        const line = packet.split("\n").find((l) => l.startsWith("data: "));
        if (!line) return;
        try {
          const parsed = JSON.parse(line.slice(6));
          req.destroy();
          resolve(parsed);
        } catch (err) {
          reject(err);
        }
      });
      res.on("error", reject);
    });

    req.on("error", reject);
    req.end();
  });
}

describe("live-view-server", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo();
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it("emits a line-level diff for edited tracked files", async () => {
    const filePath = path.join(repoDir, "app.ts");
    fs.writeFileSync(filePath, "export const x = 1;\n", "utf-8");
    execSync("git add app.ts", { cwd: repoDir, stdio: "pipe" });
    execSync('git commit -m "add app"', { cwd: repoDir, stdio: "pipe" });

    fs.writeFileSync(filePath, "export const x = 1;\nexport const y = 2;\n", "utf-8");

    const server = createLiveViewServer(repoDir, "main");
    server.emitFileChange("backend_developer", 1, "Edit app", "app.ts", "edited");

    const event = await readFirstSseEvent(server.port);
    server.stop();

    expect(event.type).toBe("file-changed");
    expect(event.filePath).toBe("app.ts");
    expect(event.diff).toContain("+export const y = 2;");
  });

  it("emits a synthesized diff for created untracked files", async () => {
    const filePath = path.join(repoDir, "new-file.ts");
    fs.writeFileSync(filePath, "export const created = true;\n", "utf-8");

    const server = createLiveViewServer(repoDir, "main");
    server.emitFileChange("backend_developer", 2, "Create file", "new-file.ts", "created");

    const event = await readFirstSseEvent(server.port);
    server.stop();

    expect(event.type).toBe("file-changed");
    expect(event.filePath).toBe("new-file.ts");
    expect(event.diff).toContain("+export const created = true;");
  });

  it("can stop safely more than once", () => {
    const server = createLiveViewServer(repoDir, "main");
    server.stop();
    expect(() => server.stop()).not.toThrow();
  });
});
