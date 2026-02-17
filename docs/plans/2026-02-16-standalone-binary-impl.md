# Standalone Binary Distribution — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Compile @workermill/agent into a standalone binary (no Node.js required) with curl/PowerShell one-liner install.

**Architecture:** Single "polyglot" binary that routes to CLI, worker, or manager based on `__WORKERMILL_MODE` env var. Built with `bun build --compile` for 4 targets (linux-x64, darwin-x64, darwin-arm64, windows-x64). Self-updates via GitHub Releases.

**Tech Stack:** esbuild (bundling), Bun (compilation), GitHub Releases (distribution)

**Design doc:** `docs/plans/2026-02-16-standalone-binary-design.md`

---

### Task 1: Install Bun as build dependency

**Files:**
- Modify: `agent/package.json`

**Step 1: Add Bun to dev dependencies and add build:binary script**

In `agent/package.json`, add to `scripts`:
```json
"build:binary": "tsc; node build.mjs && bun build --compile --target=bun-linux-x64 dist/entry.js --outfile dist/bin/workermill-agent-linux-x64 && bun build --compile --target=bun-darwin-x64 dist/entry.js --outfile dist/bin/workermill-agent-darwin-x64 && bun build --compile --target=bun-darwin-arm64 dist/entry.js --outfile dist/bin/workermill-agent-darwin-arm64 && bun build --compile --target=bun-windows-x64 dist/entry.js --outfile dist/bin/workermill-agent-win-x64.exe"
```

**Step 2: Install Bun globally (build tool, not a dep)**

```bash
curl -fsSL https://bun.sh/install | bash
```

Bun is a build tool like esbuild — it's only needed on the dev machine, not in package.json. Verify with `bun --version`.

**Step 3: Commit**

```bash
git add agent/package.json
git commit -m "chore: add build:binary script for standalone compilation"
```

---

### Task 2: Create unified entry point with mode routing

**Files:**
- Create: `agent/src/entry.ts`

**Step 1: Create the polyglot entry point**

Create `agent/src/entry.ts`:

```typescript
#!/usr/bin/env node
/**
 * Unified Entry Point for WorkerMill Agent Binary
 *
 * Routes to CLI, worker, or manager based on __WORKERMILL_MODE env var.
 * When compiled with `bun build --compile`, this single binary serves
 * all three roles — the agent re-invokes itself with the mode env var
 * set to spawn workers as child processes.
 */

const mode = process.env.__WORKERMILL_MODE;

if (mode === "worker") {
  // Dynamic import so CLI code isn't loaded in worker mode
  await import("./worker-shim.js");
} else if (mode === "manager") {
  await import("./manager-shim.js");
} else {
  await import("./cli.js");
}
```

**Step 2: Create worker and manager shims**

These are thin re-exports that esbuild will bundle. They import the same entry points currently used in `build.mjs`.

Create `agent/src/worker-shim.ts`:

```typescript
/**
 * Worker shim — imports the remote bootstrap entry point.
 * Used when the binary is invoked with __WORKERMILL_MODE=worker.
 */
import "../../worker/epic/remote-bootstrap.js";
```

Create `agent/src/manager-shim.ts`:

```typescript
/**
 * Manager shim — imports the manager entry point.
 * Used when the binary is invoked with __WORKERMILL_MODE=manager.
 */
import "../../worker/manager/index.js";
```

**Step 3: Commit**

```bash
git add agent/src/entry.ts agent/src/worker-shim.ts agent/src/manager-shim.ts
git commit -m "feat: add unified entry point with worker/manager/CLI mode routing"
```

---

### Task 3: Update build.mjs to produce unified bundle

**Files:**
- Modify: `agent/build.mjs`

**Step 1: Add unified entry bundle step**

After the existing 4 bundle steps (cli, index, worker, manager-worker), add a new step that bundles everything into one file for `bun build --compile`:

```javascript
// Step 5: Bundle unified entry point (for standalone binary compilation)
// This inlines ALL dependencies (no external packages) so the binary is self-contained.
await build({
  ...shared,
  entryPoints: ["dist/entry.js"],
  outfile: "dist/entry.bundle.js",
  packages: undefined, // Override: inline ALL packages (not external)
  external: [], // Nothing external — everything bundled
});
rmSync("dist/entry.js");
renameSync("dist/entry.bundle.js", "dist/entry.js");
console.log("✓ dist/entry.js unified bundle (for binary compilation)");
```

Key difference from the other bundles: `packages: undefined` and `external: []` — this inlines all npm deps (axios, chalk, commander, inquirer, etc.) into the single file. The existing bundles keep Node builtins external (`packages: "external"`) which is fine for npm distribution but won't work for a standalone binary.

Also add `dist/entry.js` to the `keepFiles` set:
```javascript
const keepFiles = new Set(["cli.js", "index.js", "worker.js", "manager-worker.js", "entry.js"]);
```

**Step 2: Verify the bundle builds**

```bash
cd agent && npm run build
ls -lh dist/entry.js
```

Expected: `dist/entry.js` exists, ~400-500KB (all code + all deps inlined).

**Step 3: Commit**

```bash
git add agent/build.mjs
git commit -m "feat: add unified entry bundle for standalone binary compilation"
```

---

### Task 4: Embed version at compile time

**Files:**
- Modify: `agent/src/version.ts`
- Modify: `agent/build.mjs`

**Step 1: Replace runtime package.json read with compile-time constant**

The current `version.ts` uses `createRequire` to read `package.json` at runtime. This won't work in a compiled binary. Replace with a build-time injected constant.

Update `agent/src/version.ts`:

```typescript
// Version is injected at build time by esbuild's `define` option.
// Falls back to reading package.json for development (tsc --watch).
declare const __AGENT_VERSION__: string | undefined;

let version: string;
try {
  version = __AGENT_VERSION__!;
} catch {
  // Dev mode fallback — read from package.json
  const { createRequire } = await import("module");
  const require = createRequire(import.meta.url);
  const pkg = require("../package.json") as { version: string };
  version = pkg.version;
}

export const AGENT_VERSION: string = version;
```

**Step 2: Add define to esbuild shared config in build.mjs**

Read the version from package.json at build time and inject it:

```javascript
import { readFileSync } from "fs";
// ... (existing imports)

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));

const shared = {
  // ... existing options
  define: {
    __AGENT_VERSION__: JSON.stringify(pkg.version),
  },
};
```

**Step 3: Verify**

```bash
cd agent && npm run build
node dist/cli.js --version
```

Expected: prints the version from package.json.

**Step 4: Commit**

```bash
git add agent/src/version.ts agent/build.mjs
git commit -m "feat: inject version at build time instead of reading package.json"
```

---

### Task 5: Update spawner to use process.execPath

**Files:**
- Modify: `agent/src/spawner.ts`

**Step 1: Replace node worker.js with self-invocation**

In `spawnWorker()` (line ~350), change:

```typescript
// Before:
const proc = spawn("node", [workerPath], {
  env: childEnv,
  cwd: workDir,
  stdio: ["ignore", "pipe", "pipe"],
  detached: false,
});

// After:
const proc = spawn(process.execPath, [], {
  env: { ...childEnv, __WORKERMILL_MODE: "worker" },
  cwd: workDir,
  stdio: ["ignore", "pipe", "pipe"],
  detached: false,
});
```

In `spawnManagerWorker()` (line ~607), change:

```typescript
// Before:
const proc = spawn("node", [managerPath], {
  env: childEnv,
  cwd: workDir,
  stdio: ["ignore", "pipe", "pipe"],
  detached: false,
});

// After:
const proc = spawn(process.execPath, [], {
  env: { ...childEnv, __WORKERMILL_MODE: "manager" },
  cwd: workDir,
  stdio: ["ignore", "pipe", "pipe"],
  detached: false,
});
```

**Step 2: Remove resolveWorkerPath and resolveManagerWorkerPath functions**

Delete the `resolveWorkerPath()` and `resolveManagerWorkerPath()` functions and their usage (the `workerPath`/`managerPath` existence checks). The binary IS the worker — no path resolution needed.

**Step 3: Remove NODE_OPTIONS from env vars**

The `NODE_OPTIONS: "--max-old-space-size=4096"` line in `spawnWorker()` and `NODE_OPTIONS: "--max-old-space-size=3072"` in `spawnManagerWorker()` are Node.js-specific. Bun ignores them. Remove or replace with Bun equivalent if needed (Bun handles memory limits differently — it uses system defaults which are fine).

**Step 4: Verify build**

```bash
cd agent && npm run build
```

Expected: builds without errors.

**Step 5: Commit**

```bash
git add agent/src/spawner.ts
git commit -m "feat: spawn workers via process.execPath (self-invocation) instead of node"
```

---

### Task 6: Update self-updater for binary distribution

**Files:**
- Modify: `agent/src/updater.ts`

**Step 1: Replace npm-based update with GitHub Releases download**

Rewrite `updater.ts`:

```typescript
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

export async function selfUpdate(): Promise<boolean> {
  try {
    // Check if running from npm (shebang-based JS) vs compiled binary
    if (process.execPath.includes("node") || process.execPath.includes("bun")) {
      // npm-installed: fall back to npm update
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
    } catch { /* Windows */ }

    // Atomic-ish replace: rename old, rename new, delete old
    const backupPath = selfPath + ".bak";
    try { unlinkSync(backupPath); } catch { /* may not exist */ }
    try {
      renameSync(selfPath, backupPath);
      renameSync(tmpFile, selfPath);
      try { unlinkSync(backupPath); } catch { /* cleanup best-effort */ }
    } catch {
      // Fallback: on Windows, can't rename running exe. Copy instead.
      execSync(`copy /Y "${tmpFile}" "${selfPath}"`, { stdio: "ignore" });
    }

    console.log(chalk.green(`  Updated to ${latestVersion}`));
    return true;
  } catch (err) {
    console.error(chalk.red(`  Update failed: ${err instanceof Error ? err.message : err}`));
    return false;
  }
}

export function restartAgent(): never {
  console.log(chalk.cyan("  Restarting agent..."));
  const { spawn } = require("child_process");
  const child = spawn(process.execPath, process.argv.slice(1), {
    stdio: "inherit",
    detached: true,
  });
  child.unref();
  process.exit(0);
}
```

**Step 2: Update the update command's error message**

In `agent/src/commands/update.ts`, change the fallback message:

```typescript
// Before:
console.error(chalk.red("  Update failed. Try running manually: npm install -g @workermill/agent@latest"));

// After:
console.error(chalk.red("  Update failed. Try downloading the latest release from https://github.com/workermill/workermill/releases"));
```

**Step 3: Commit**

```bash
git add agent/src/updater.ts agent/src/commands/update.ts
git commit -m "feat: self-updater downloads from GitHub Releases instead of npm"
```

---

### Task 7: Remove Node.js prerequisite check

**Files:**
- Modify: `agent/src/config.ts`
- Modify: `agent/src/commands/setup.ts`

**Step 1: Remove Node.js check from checkPrerequisites**

In `config.ts` `checkPrerequisites()` (around line 237-245), remove the Node.js version check block:

```typescript
// DELETE this block:
  // Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split(".")[0], 10);
  if (major >= 20) {
    results.push({ name: "Node.js", ok: true, detail: nodeVersion });
  } else {
    results.push({ name: "Node.js", ok: false, detail: `${nodeVersion} (need >= 20)` });
  }
```

**Step 2: Remove Node.js display from setup.ts**

In `setup.ts`, remove line 265:
```typescript
// DELETE:
  console.log(chalk.green("  ✓") + ` Node.js ${chalk.dim(`(${process.version})`)}`);
```

**Step 3: Commit**

```bash
git add agent/src/config.ts agent/src/commands/setup.ts
git commit -m "feat: remove Node.js prerequisite check (binary is self-contained)"
```

---

### Task 8: Update detach mode to use process.execPath

**Files:**
- Modify: `agent/src/commands/start.ts`

**Step 1: Fix detach spawn to use binary path instead of npm command**

In `start.ts` line 68, the detach mode spawns `"workermill-agent"` which assumes npm's .cmd wrapper exists. Change to use `process.execPath`:

```typescript
// Before:
const child = spawn("workermill-agent", ["start"], {
  detached: true,
  stdio: ["ignore", logFd, logFd],
  shell: true,
});

// After:
const child = spawn(process.execPath, ["start"], {
  detached: true,
  stdio: ["ignore", logFd, logFd],
});
```

Note: remove `shell: true` — no longer need shell to resolve .cmd wrappers.

**Step 2: Commit**

```bash
git add agent/src/commands/start.ts
git commit -m "fix: detach mode uses process.execPath for binary compatibility"
```

---

### Task 9: Build and test the standalone binary locally

**Step 1: Build the npm bundle first**

```bash
cd agent && npm run build
ls -lh dist/entry.js
```

Expected: `dist/entry.js` exists, ~400-500KB.

**Step 2: Compile with Bun for current platform**

```bash
cd agent && bun build --compile dist/entry.js --outfile dist/bin/workermill-agent
```

Expected: binary at `dist/bin/workermill-agent`, ~80-100MB.

**Step 3: Test CLI mode**

```bash
./dist/bin/workermill-agent --version
./dist/bin/workermill-agent --help
```

Expected: prints version and help text.

**Step 4: Test setup wizard**

```bash
./dist/bin/workermill-agent setup
```

Expected: launches interactive setup, checks prerequisites (Git, Claude CLI — NOT Node.js).

**Step 5: Test start (if config exists)**

```bash
./dist/bin/workermill-agent status
```

Expected: shows agent status or "not configured" message.

**Step 6: Cross-compile for all targets**

```bash
cd agent
mkdir -p dist/bin
bun build --compile --target=bun-linux-x64 dist/entry.js --outfile dist/bin/workermill-agent-linux-x64
bun build --compile --target=bun-darwin-x64 dist/entry.js --outfile dist/bin/workermill-agent-darwin-x64
bun build --compile --target=bun-darwin-arm64 dist/entry.js --outfile dist/bin/workermill-agent-darwin-arm64
bun build --compile --target=bun-windows-x64 dist/entry.js --outfile dist/bin/workermill-agent-win-x64.exe
ls -lh dist/bin/
```

Expected: 4 binaries, each ~80-100MB.

**Step 7: Commit**

```bash
echo "dist/bin/" >> agent/.gitignore
git add agent/.gitignore
git commit -m "chore: add dist/bin to gitignore (compiled binaries)"
```

---

### Task 10: Create install scripts

**Files:**
- Create: `agent/install.sh`
- Create: `agent/install.ps1`

**Step 1: Create install.sh for Mac/Linux**

```bash
#!/bin/sh
# WorkerMill Agent Installer
# Usage: curl -fsSL https://workermill.com/install.sh | bash
set -e

REPO="workermill/workermill"
INSTALL_DIR="$HOME/.workermill/bin"

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  linux)  PLATFORM="linux" ;;
  darwin) PLATFORM="darwin" ;;
  *)      echo "Unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64)  ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *)             echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

BINARY_NAME="workermill-agent-${PLATFORM}-${ARCH}"

echo "Installing WorkerMill Agent (${PLATFORM}-${ARCH})..."

# Get latest release URL
RELEASE_URL=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
  | grep "browser_download_url.*${BINARY_NAME}" \
  | head -1 \
  | cut -d '"' -f 4)

if [ -z "$RELEASE_URL" ]; then
  echo "Error: Could not find binary for ${BINARY_NAME}"
  echo "Check https://github.com/${REPO}/releases for available binaries."
  exit 1
fi

# Download
mkdir -p "$INSTALL_DIR"
curl -fsSL "$RELEASE_URL" -o "$INSTALL_DIR/workermill-agent"
chmod +x "$INSTALL_DIR/workermill-agent"

# Add to PATH
SHELL_NAME=$(basename "$SHELL")
PROFILE=""
case "$SHELL_NAME" in
  zsh)  PROFILE="$HOME/.zshrc" ;;
  bash) PROFILE="$HOME/.bashrc" ;;
  fish) PROFILE="$HOME/.config/fish/config.fish" ;;
esac

if [ -n "$PROFILE" ] && ! grep -q ".workermill/bin" "$PROFILE" 2>/dev/null; then
  if [ "$SHELL_NAME" = "fish" ]; then
    echo "set -gx PATH \$HOME/.workermill/bin \$PATH" >> "$PROFILE"
  else
    echo 'export PATH="$HOME/.workermill/bin:$PATH"' >> "$PROFILE"
  fi
  echo "Added ~/.workermill/bin to PATH in $PROFILE"
fi

echo ""
echo "WorkerMill Agent installed to $INSTALL_DIR/workermill-agent"
echo ""
echo "Run 'workermill-agent' to get started (you may need to restart your shell)."
```

**Step 2: Create install.ps1 for Windows**

```powershell
# WorkerMill Agent Installer for Windows
# Usage: irm https://workermill.com/install.ps1 | iex
$ErrorActionPreference = "Stop"

$repo = "workermill/workermill"
$binaryName = "workermill-agent-win-x64.exe"
$installDir = "$env:LOCALAPPDATA\workermill\bin"

Write-Host "Installing WorkerMill Agent (windows-x64)..." -ForegroundColor Cyan

# Get latest release
$release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest"
$asset = $release.assets | Where-Object { $_.name -eq $binaryName } | Select-Object -First 1

if (-not $asset) {
    Write-Host "Error: Could not find $binaryName in latest release." -ForegroundColor Red
    exit 1
}

# Download
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
$outPath = Join-Path $installDir "workermill-agent.exe"
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $outPath

# Add to PATH
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$installDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$installDir;$userPath", "User")
    Write-Host "Added $installDir to user PATH"
}

Write-Host ""
Write-Host "WorkerMill Agent installed to $outPath" -ForegroundColor Green
Write-Host ""
Write-Host "Run 'workermill-agent' to get started (you may need to restart your terminal)."
```

**Step 3: Commit**

```bash
git add agent/install.sh agent/install.ps1
git commit -m "feat: add install scripts for Mac/Linux (curl) and Windows (PowerShell)"
```

---

### Task 11: Create GitHub Actions release workflow

**Files:**
- Create: `.github/workflows/agent-release.yml`

**Step 1: Create the release workflow**

```yaml
name: Agent Binary Release

on:
  push:
    tags:
      - 'agent-v*'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - uses: oven-sh/setup-bun@v2

      - name: Install dependencies
        run: cd agent && npm ci

      - name: Build
        run: cd agent && npm run build

      - name: Compile binaries
        run: |
          cd agent
          mkdir -p dist/bin
          bun build --compile --target=bun-linux-x64 dist/entry.js --outfile dist/bin/workermill-agent-linux-x64
          bun build --compile --target=bun-darwin-x64 dist/entry.js --outfile dist/bin/workermill-agent-darwin-x64
          bun build --compile --target=bun-darwin-arm64 dist/entry.js --outfile dist/bin/workermill-agent-darwin-arm64
          bun build --compile --target=bun-windows-x64 dist/entry.js --outfile dist/bin/workermill-agent-win-x64.exe

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: |
            agent/dist/bin/workermill-agent-linux-x64
            agent/dist/bin/workermill-agent-darwin-x64
            agent/dist/bin/workermill-agent-darwin-arm64
            agent/dist/bin/workermill-agent-win-x64.exe
            agent/install.sh
            agent/install.ps1
          generate_release_notes: true
```

**Step 2: Commit**

```bash
git add .github/workflows/agent-release.yml
git commit -m "ci: add GitHub Actions workflow for agent binary releases"
```

---

### Task 12: Test end-to-end locally

This is a manual verification task — no code changes.

**Step 1: Full build**

```bash
cd agent && npm run build
```

**Step 2: Compile for local platform**

```bash
bun build --compile dist/entry.js --outfile /tmp/workermill-agent-test
```

**Step 3: Test CLI**

```bash
/tmp/workermill-agent-test --version
/tmp/workermill-agent-test --help
/tmp/workermill-agent-test status
```

**Step 4: Test worker self-invocation**

```bash
# Verify the binary can invoke itself in worker mode (will fail with missing env vars, but shouldn't crash with "cannot find module")
__WORKERMILL_MODE=worker /tmp/workermill-agent-test 2>&1 | head -5
```

Expected: error about missing TASK_ID or similar env var — NOT a module resolution error.

**Step 5: Clean up**

```bash
rm /tmp/workermill-agent-test
```

---

### Task 13: Tag and release

**Step 1: Bump version in package.json**

Update version in `agent/package.json` (e.g., `0.11.0` for the binary release milestone).

**Step 2: Commit and tag**

```bash
cd agent
git add package.json
git commit -m "chore: bump agent to v0.11.0 (standalone binary release)"
git tag agent-v0.11.0
git push && git push --tags
```

**Step 3: Verify GitHub Actions**

Watch the `Agent Binary Release` workflow at `https://github.com/workermill/workermill/actions`. It should:
- Build all 4 binaries
- Create a GitHub Release with the binaries attached
- Include install.sh and install.ps1

**Step 4: Test install script**

```bash
curl -fsSL https://raw.githubusercontent.com/workermill/workermill/main/agent/install.sh | bash
workermill-agent --version
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Install Bun, add build:binary script | `package.json` |
| 2 | Unified entry point + shims | `entry.ts`, `worker-shim.ts`, `manager-shim.ts` |
| 3 | Bundle unified entry in build.mjs | `build.mjs` |
| 4 | Compile-time version injection | `version.ts`, `build.mjs` |
| 5 | Spawner uses process.execPath | `spawner.ts` |
| 6 | Self-updater via GitHub Releases | `updater.ts`, `update.ts` |
| 7 | Remove Node.js prerequisite | `config.ts`, `setup.ts` |
| 8 | Fix detach mode for binary | `start.ts` |
| 9 | Build and test binary locally | (verification) |
| 10 | Install scripts (curl + PowerShell) | `install.sh`, `install.ps1` |
| 11 | GitHub Actions release workflow | `agent-release.yml` |
| 12 | End-to-end local test | (verification) |
| 13 | Tag and release | (release) |
