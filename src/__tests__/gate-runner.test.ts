import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import { runGate } from "../gate-runner.ts";

describe("runGate", () => {
  it("runs all commands in a gate sequentially", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "wm-gate-"));
    try {
      const markerFile = path.join(cwd, "marker.txt");
      const result = await runGate({
        name: "multi-step",
        commands: [
          "printf 'first' > marker.txt",
          "test -f marker.txt",
        ],
      }, cwd);

      expect(result.passed).toBe(true);
      expect(fs.readFileSync(markerFile, "utf8")).toBe("first");
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
