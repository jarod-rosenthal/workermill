import { execSync } from "child_process";
import { createWriteStream, chmodSync, renameSync, unlinkSync } from "fs";
import { tmpdir, platform, arch } from "os";
import { join } from "path";
import chalk from "chalk";
import { AGENT_VERSION } from "./version.js";

const GITHUB_REPO = "workermill/workermill";

interface GHRelease {
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

function getBinaryName(): string {
  const os = platform();
  const cpu = arch();
  if (os === "win32") return "workermill-agent-win-x64.exe";
  if (os === "darwin" && cpu === "arm64") return "workermill-agent-darwin-arm64";
  if (os === "darwin") return "workermill-agent-darwin-x64";
  return "workermill-agent-linux-x64";
}

/**
 * Detect whether this is an npm-installed agent or a compiled binary.
 * npm installs run via node/bun interpreting a .js file.
 * Compiled binaries have their own execPath.
 */
function isNpmInstall(): boolean {
  const exe = process.execPath.toLowerCase();
  return exe.includes("node") || exe.includes("bun");
}

/**
 * Self-update the agent. Detects npm vs binary install and uses the right method.
 */
export async function selfUpdate(): Promise<boolean> {
  try {
    if (isNpmInstall()) {
      console.log(chalk.dim("  Detected npm installation, using npm update..."));
      try {
        execSync("npm install -g @workermill/agent@latest", { stdio: "inherit" });
        return true;
      } catch {
        return false;
      }
    }

    // Compiled binary: download from GitHub Releases
    console.log(chalk.cyan("  Checking for updates..."));

    const resp = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      { headers: { Accept: "application/vnd.github.v3+json" } },
    );
    if (!resp.ok) {
      console.error(chalk.red(`  Failed to check releases: ${resp.status}`));
      return false;
    }

    const release = (await resp.json()) as GHRelease;
    const latestVersion = release.tag_name.replace(/^agent-v/, "");

    if (latestVersion === AGENT_VERSION) {
      console.log(chalk.green(`  Already on latest version (${AGENT_VERSION})`));
      return true;
    }

    console.log(chalk.cyan(`  Updating ${AGENT_VERSION} → ${latestVersion}...`));

    const binaryName = getBinaryName();
    const asset = release.assets.find((a) => a.name === binaryName);
    if (!asset) {
      console.error(chalk.red(`  No binary found for ${binaryName} in release ${release.tag_name}`));
      return false;
    }

    // Download to temp file
    const tmpFile = join(tmpdir(), `workermill-agent-update-${Date.now()}`);
    const dlResp = await fetch(asset.browser_download_url);
    if (!dlResp.ok || !dlResp.body) {
      console.error(chalk.red(`  Download failed: ${dlResp.status}`));
      return false;
    }

    const writer = createWriteStream(tmpFile);
    const reader = dlResp.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writer.write(value);
    }
    await new Promise<void>((resolve) => writer.end(resolve));

    // Replace self
    const selfPath = process.execPath;
    try {
      chmodSync(tmpFile, 0o755);
    } catch {
      /* Windows doesn't support chmod */
    }

    const backupPath = selfPath + ".bak";
    try {
      unlinkSync(backupPath);
    } catch {
      /* may not exist */
    }
    try {
      renameSync(selfPath, backupPath);
      renameSync(tmpFile, selfPath);
      try {
        unlinkSync(backupPath);
      } catch {
        /* cleanup best-effort */
      }
    } catch {
      // Fallback: on Windows, can't rename running exe
      try {
        execSync(`copy /Y "${tmpFile}" "${selfPath}"`, { stdio: "ignore" });
      } catch {
        console.error(chalk.red("  Could not replace binary. Download manually from:"));
        console.error(chalk.cyan(`  https://github.com/${GITHUB_REPO}/releases/latest`));
        return false;
      }
    }

    console.log(chalk.green(`  Updated to ${latestVersion}`));
    return true;
  } catch (err) {
    console.error(chalk.red(`  Update failed: ${err instanceof Error ? err.message : err}`));
    return false;
  }
}

/**
 * Restart the current process by spawning a new one and exiting.
 */
export function restartAgent(): never {
  console.log(chalk.cyan("  Restarting agent..."));

  const { spawn } = require("child_process") as typeof import("child_process");
  const child = spawn(process.execPath, process.argv.slice(1), {
    stdio: "inherit",
    detached: true,
  });

  child.unref();
  process.exit(0);
}
