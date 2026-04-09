import fs from "fs";
import os from "os";
import path from "path";
import { vi } from "vitest";

export interface TempHome {
  homeDir: string;
  wmDir: string;
  cleanup: () => void;
  restore: () => void;
}

export function createTempWorkerMillHome(): TempHome {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-home-"));
  const wmDir = path.join(homeDir, ".workermill");
  fs.mkdirSync(wmDir, { recursive: true });
  fs.mkdirSync(path.join(wmDir, "sessions"), { recursive: true });
  fs.mkdirSync(path.join(wmDir, "memory"), { recursive: true });
  fs.mkdirSync(path.join(wmDir, "logs"), { recursive: true });
  fs.mkdirSync(path.join(wmDir, "projects"), { recursive: true });
  fs.mkdirSync(path.join(wmDir, "commands"), { recursive: true });
  fs.mkdirSync(path.join(wmDir, "personas"), { recursive: true });

  const origHomedir = os.homedir;
  const originalStateRoot = process.env.WM_STATE_ROOT;
  vi.spyOn(os, "homedir").mockReturnValue(homeDir);
  process.env.WM_STATE_ROOT = wmDir;

  return {
    homeDir,
    wmDir,
    cleanup: () => {
      fs.rmSync(homeDir, { recursive: true, force: true });
    },
    restore: () => {
      vi.spyOn(os, "homedir").mockImplementation(origHomedir);
      if (originalStateRoot === undefined) {
        delete process.env.WM_STATE_ROOT;
      } else {
        process.env.WM_STATE_ROOT = originalStateRoot;
      }
    },
  };
}
