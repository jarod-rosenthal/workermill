import fs from "fs";
import os from "os";
import path from "path";

const markerPath = path.join(os.tmpdir(), `wm-test-state-marker-${process.pid}`);

export default function globalSetup(): () => void {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "wm-test-state-suite-"));
  fs.writeFileSync(markerPath, parent, "utf-8");

  return () => {
    const recorded = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, "utf-8").trim() : "";
    if (recorded === parent && path.basename(parent).startsWith("wm-test-state-suite-")) {
      fs.rmSync(parent, { recursive: true, force: true });
      fs.rmSync(markerPath, { force: true });
    }
  };
}
