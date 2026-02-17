# Standalone Binary Distribution for @workermill/agent

**Date:** 2026-02-16
**Status:** Design

## Problem

The agent requires `npm install -g @workermill/agent` which means users need Node.js installed. Claude Code itself now ships as a native binary (`curl | bash`), so Node.js is no longer a prerequisite for the core workflow. The agent is the only thing keeping the Node.js dependency.

## Solution

Compile the agent into a single native binary per platform using `bun build --compile`. Ship via GitHub Releases with `curl | bash` and PowerShell one-liner installers.

**Install experience:**

```bash
# Mac/Linux
curl -fsSL https://workermill.com/install.sh | bash

# Windows (PowerShell)
irm https://workermill.com/install.ps1 | iex
```

## Architecture: Polyglot Binary

The agent, worker, and manager are currently 4 separate JS bundles. We merge them into a single entry point that routes based on an env var:

```
┌──────────────────────────────────┐
│     workermill-agent binary      │
│  (Bun runtime + bundled code)    │
├──────────────────────────────────┤
│  __WORKERMILL_MODE unset → CLI   │
│  __WORKERMILL_MODE=worker → epic │
│  __WORKERMILL_MODE=manager → mgr │
└──────────────────────────────────┘
```

**Spawner change** (spawner.ts):

```typescript
// Before:
spawn("node", [workerPath], { env, cwd })

// After:
spawn(process.execPath, [], { env: { ...env, __WORKERMILL_MODE: "worker" }, cwd })
```

`process.execPath` returns the path to the running binary itself, so the agent re-invokes itself in worker mode. No external runtime needed.

## Build Pipeline

```
tsc (TypeScript → JS)
  → esbuild (bundle all 4 entry points into 1 unified entry)
    → bun build --compile (produce native binaries for 4 targets)
```

**Targets:**

| Target | Binary Name | Size (est.) |
|--------|-------------|-------------|
| `bun-linux-x64` | `workermill-agent-linux-x64` | ~90MB |
| `bun-darwin-x64` | `workermill-agent-darwin-x64` | ~90MB |
| `bun-darwin-arm64` | `workermill-agent-darwin-arm64` | ~90MB |
| `bun-windows-x64` | `workermill-agent-win-x64.exe` | ~90MB |

All 4 cross-compile from WSL2 Linux. No CI runners per platform needed.

## Changes Required

### 1. New unified entry point (`agent/src/entry.ts`)

Routes to CLI, worker, or manager based on `__WORKERMILL_MODE` env var.

### 2. Update `build.mjs`

- Add step: bundle all 4 outputs into a single `dist/entry.js`
- Add step: `bun build --compile` for each target
- Output binaries to `dist/bin/`

### 3. Update `spawner.ts`

- Replace `spawn("node", [workerPath])` with `spawn(process.execPath, [])`
- Set `__WORKERMILL_MODE` in child env
- Remove `resolveWorkerPath()` / `resolveManagerWorkerPath()` (no longer needed)

### 4. Update `updater.ts`

- Replace `npm install -g @workermill/agent@latest` with: download latest binary from GitHub Releases, replace self
- Use GitHub API: `GET /repos/workermill/workermill/releases/latest`

### 5. Update `version.ts`

- Embed version at compile time instead of reading package.json at runtime
- esbuild `define` option: `{ "__VERSION__": JSON.stringify(version) }`

### 6. Remove Node.js prerequisite check

- `checkPrerequisites()` in config.ts currently checks Node.js version — remove that check
- Keep Git and Claude CLI checks

### 7. Install scripts

**`install.sh`** (hosted at workermill.com/install.sh):
- Detect OS (`uname -s`) and arch (`uname -m`)
- Download matching binary from GitHub Releases
- Place in `~/.workermill/bin/`
- Add to PATH via shell profile (.bashrc, .zshrc)
- Print success message

**`install.ps1`** (hosted at workermill.com/install.ps1):
- Download Windows binary from GitHub Releases
- Place in `$env:LOCALAPPDATA\workermill\bin\`
- Add to User PATH
- Print success message

### 8. GitHub Actions workflow

On git tag `agent-v*`:
- Checkout, install Bun, run `npm run build:binary`
- Create GitHub Release with 4 binary assets
- Update install script URLs if needed

## Migration

- Keep npm package published for backward compat (existing users)
- New docs point to `curl | bash` as primary install
- `workermill-agent update` detects whether it's npm-installed or binary and uses the right update mechanism

## What Doesn't Change

- Config format (`~/.workermill/config.json`)
- CLI commands (`setup`, `start`, `stop`, `status`, `logs`)
- API communication
- Worker/manager behavior
- Claude CLI spawning
