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

  const origHomedir = os.homedir;
  vi.spyOn(os, "homedir").mockReturnValue(homeDir);

  return {
    homeDir,
    wmDir,
    cleanup: () => {
      fs.rmSync(homeDir, { recursive: true, force: true });
    },
    restore: () => {
      vi.spyOn(os, "homedir").mockImplementation(origHomedir);
    },
  };
}
