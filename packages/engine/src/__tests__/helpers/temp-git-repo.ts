import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { createTempDir, cleanupTempDir } from "./temp-dir.js";

export interface TempGitRepo {
  dir: string;
  cleanup: () => void;
}

export function createTempGitRepo(files?: Record<string, string>): TempGitRepo {
  const dir = createTempDir("wm-git-");
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@workermill.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });

  if (files) {
    for (const [name, content] of Object.entries(files)) {
      const filePath = path.join(dir, name);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content);
    }
    execSync("git add -A", { cwd: dir, stdio: "pipe" });
    execSync('git commit -m "initial"', { cwd: dir, stdio: "pipe" });
  }

  return { dir, cleanup: () => cleanupTempDir(dir) };
}
