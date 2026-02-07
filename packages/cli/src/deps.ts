import { execFileSync, execSync } from "node:child_process";

export interface DependencyStatus {
  git: { found: boolean; version?: string };
  claude: { found: boolean; version?: string };
}

function getVersion(command: string, args: string[]): string | undefined {
  try {
    const output = execFileSync(command, args, {
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return output;
  } catch {
    return undefined;
  }
}

function checkGit(): { found: boolean; version?: string } {
  const output = getVersion("git", ["--version"]);
  if (!output) return { found: false };
  const match = output.match(/git version (\S+)/);
  return { found: true, version: match?.[1] ?? output };
}

function checkClaude(): { found: boolean; version?: string } {
  const output = getVersion("claude", ["--version"]);
  if (!output) return { found: false };
  return { found: true, version: output.split("\n")[0] };
}

async function installClaude(): Promise<boolean> {
  console.log("    Installing @anthropic-ai/claude-code...");
  try {
    execSync("npm install -g @anthropic-ai/claude-code", {
      encoding: "utf-8",
      timeout: 120_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

export async function checkDependencies(): Promise<DependencyStatus> {
  console.log("  Checking dependencies...");

  const git = checkGit();
  if (git.found) {
    console.log(`    \u2713 git (${git.version})`);
  } else {
    console.error("    \u2717 git not found");
    console.error("      Install git: https://git-scm.com/downloads");
    process.exit(1);
  }

  let claude = checkClaude();
  if (claude.found) {
    console.log(`    \u2713 Claude CLI (${claude.version})`);
  } else {
    console.log("    \u2717 Claude CLI not found");
    const installed = await installClaude();
    if (installed) {
      claude = checkClaude();
      if (claude.found) {
        console.log(`    \u2713 Claude CLI installed (${claude.version})`);
      } else {
        console.error("      Claude CLI installed but not found in PATH.");
        console.error("      Try: npm install -g @anthropic-ai/claude-code");
        process.exit(1);
      }
    } else {
      console.error("      Failed to install Claude CLI.");
      console.error("      Try manually: npm install -g @anthropic-ai/claude-code");
      process.exit(1);
    }
  }

  return { git, claude };
}
