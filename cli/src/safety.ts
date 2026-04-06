/**
 * Centralized safety constants for the WorkerMill CLI.
 *
 * These MUST be the single source of truth — do not define DANGEROUS_PATTERNS,
 * READ_TOOLS, or AUTO_EDIT_TOOLS anywhere else in the codebase.
 */

import { getReadOnlyTools, getAcceptEditsTools } from "./engine/tools/tool-metadata.js";
export { getToolMeta } from "./engine/tools/tool-metadata.js";

/** Command patterns that require explicit confirmation even under trust-all mode. */
export const DANGEROUS_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  // Destructive file operations
  { pattern: /rm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+\/(?!\w)/i, label: "rm -rf with root path" },
  { pattern: /rm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+~\//i, label: "rm -rf in home directory" },
  // rm -rf on relative paths within the project (e.g. rm -rf node_modules/) is safe —
  // the bash tool's bounds checking already prevents access outside the working directory.
  // Only flag rm -rf targeting absolute paths outside root/home (caught above).
  // Git destructive operations
  { pattern: /git\s+reset\s+--hard/i, label: "hard reset" },
  { pattern: /git\s+push\s+.*--force/i, label: "force push" },
  { pattern: /git\s+clean\s+-[a-z]*f/i, label: "git clean" },
  // Database destructive operations
  { pattern: /drop\s+table/i, label: "drop table" },
  { pattern: /truncate\s+/i, label: "truncate" },
  { pattern: /DELETE\s+FROM\s+\w+\s*;/i, label: "DELETE without WHERE" },
  // System-level dangers
  { pattern: /chmod\s+777/i, label: "chmod 777" },
  { pattern: />(\/dev\/sda|\/dev\/disk)/i, label: "write to disk device" },
  { pattern: /\bsudo\b/i, label: "sudo" },
];

/** Check if a bash command matches any dangerous pattern. Returns the label if dangerous, null otherwise. */
export function isDangerous(command: string): string | null {
  for (const { pattern, label } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) return label;
  }
  return null;
}

/** File paths that should always prompt for confirmation before writing. */
export const DANGEROUS_FILE_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  // Environment/secrets
  { pattern: /\.env($|\.)/, label: ".env file (may contain secrets)" },
  { pattern: /\.secret/, label: "secrets file" },
  { pattern: /credentials/i, label: "credentials file" },
  // Shell config
  { pattern: /\.(bashrc|bash_profile|zshrc|zprofile|profile)$/, label: "shell config" },
  // SSH
  { pattern: /\.ssh\//, label: "SSH directory" },
  // Git internals
  { pattern: /\.git\/config$/, label: "git config" },
  { pattern: /\.git\/hooks\//, label: "git hooks" },
  { pattern: /\.gitignore$/, label: ".gitignore" },
  // Package manager configs that run scripts
  { pattern: /\.npmrc$/, label: "npm config" },
  // Lock files
  { pattern: /package-lock\.json$/, label: "package lock file" },
  { pattern: /yarn\.lock$/, label: "yarn lock file" },
  { pattern: /pnpm-lock\.yaml$/, label: "pnpm lock file" },
];

/** Check if a file path matches any dangerous pattern. Returns the label if dangerous, null otherwise. */
export function isDangerousFile(filePath: string): string | null {
  // Normalize: resolve . and .., use forward slashes
  const normalized = filePath.replace(/\\/g, "/");
  for (const { pattern, label } of DANGEROUS_FILE_PATTERNS) {
    if (pattern.test(normalized)) return label;
  }
  return null;
}

/** Tools that are read-only and always allowed without prompting. */
export const READ_TOOLS = getReadOnlyTools();

/**
 * Check a tool call against granular permission rules.
 * Pattern format: "toolname" or "toolname(glob)" — e.g. "bash(npm run *)", "write_file(.env)".
 * Returns "allow", "ask", "deny", or "none" (no matching rule — fall through to normal permission logic).
 * Evaluation order: deny > ask > allow. Deny always wins.
 */
export function checkPermissionRules(
  toolName: string,
  toolInput: Record<string, unknown>,
  rules?: { allow?: string[]; ask?: string[]; deny?: string[] },
): "allow" | "ask" | "deny" | "none" {
  if (!rules) return "none";

  // Extract the value to match against the glob portion
  const matchValue = toolName === "bash"
    ? String(toolInput.command || "")
    : String(toolInput.file_path || toolInput.path || toolInput.file || toolInput.url || "");

  // Deny wins — check first
  if (rules.deny) {
    for (const rule of rules.deny) {
      if (matchesRule(rule, toolName, matchValue)) return "deny";
    }
  }

  // Ask forces a prompt even in acceptEdits mode
  if (rules.ask) {
    for (const rule of rules.ask) {
      if (matchesRule(rule, toolName, matchValue)) return "ask";
    }
  }

  if (rules.allow) {
    for (const rule of rules.allow) {
      if (matchesRule(rule, toolName, matchValue)) return "allow";
    }
  }

  return "none";
}

/**
 * Split a compound bash command (&&, ||, ;) into individual subcommands.
 * Used when saving "don't ask again" rules — each subcommand gets its own rule.
 */
export function splitCompoundCommand(command: string): string[] {
  // Split on &&, ||, ; but not inside quotes
  const parts: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (ch === "'" && !inDouble) { inSingle = !inSingle; current += ch; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; current += ch; continue; }
    if (inSingle || inDouble) { current += ch; continue; }

    if (ch === ";" || (ch === "&" && command[i + 1] === "&") || (ch === "|" && command[i + 1] === "|")) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      if (ch !== ";") i++; // skip second & or |
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Bare shell/wrapper commands that must not get prefix rules (too dangerous). */
const BARE_SHELL_PREFIXES = new Set([
  "sh", "bash", "zsh", "fish", "csh", "tcsh", "ksh", "dash",
  "cmd", "powershell", "pwsh",
  "env", "xargs", "nice", "stdbuf", "nohup", "timeout", "time",
  "sudo", "doas", "pkexec",
]);

/**
 * Extract a command prefix for "don't ask again" rules.
 * Returns the first two tokens if the second looks like a subcommand,
 * otherwise the first token alone.
 * e.g. "npm run test --verbose" → "npm run"
 * e.g. "git status" → "git status"
 * e.g. "cat /tmp/foo" → "cat"
 * e.g. "python3 script.py" → null (second token is a file)
 * Returns null if the command is too dangerous for a prefix rule.
 */
export function getCommandPrefix(command: string): string | null {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  // Skip env var assignments (VAR=value) at the start
  let i = 0;
  while (i < tokens.length && /^[A-Z_][A-Z0-9_]*=/.test(tokens[i]!)) {
    i++;
  }

  const remaining = tokens.slice(i);
  if (remaining.length === 0) return null;

  const cmd = remaining[0]!;
  // Must look like a command name (lowercase alpha, optional hyphens)
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(cmd)) return null;
  if (BARE_SHELL_PREFIXES.has(cmd)) return null;

  // Two-word prefix if second token looks like a subcommand
  if (remaining.length >= 2) {
    const subcmd = remaining[1]!;
    if (/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(subcmd)) {
      return remaining.slice(0, 2).join(" ");
    }
  }

  return cmd;
}

/**
 * Generate a permission rule pattern from a bash command.
 * Uses prefix:* format matching Claude Code's pattern.
 * e.g. "npm run test --verbose" → "bash(npm run:*)"
 * e.g. "git status" → "bash(git status:*)"
 * e.g. "cat /tmp/foo" → "bash(cat:*)"
 * Falls back to exact command if no prefix can be extracted.
 */
export function commandToRule(command: string): string {
  const prefix = getCommandPrefix(command);
  if (prefix) return `bash(${prefix}:*)`;
  return `bash(${command.trim()})`;
}

/** Match a rule like "bash(npm run:*)" against a tool name and value. */
function matchesRule(rule: string, toolName: string, value: string): boolean {
  const parenIdx = rule.indexOf("(");
  if (parenIdx === -1) {
    // Simple tool name match: "bash", "write_file"
    return rule === toolName;
  }

  // Pattern match: "bash(npm run:*)"
  const ruleTool = rule.slice(0, parenIdx);
  if (ruleTool !== toolName) return false;

  const pattern = rule.slice(parenIdx + 1, rule.endsWith(")") ? -1 : undefined);

  // Prefix rule: "npm run:*" matches any command starting with "npm run"
  // The :* suffix is Claude Code's format for prefix matching.
  const prefixMatch = pattern.match(/^(.+):\*$/);
  if (prefixMatch) {
    const prefix = prefixMatch[1]!;
    return value === prefix || value.startsWith(prefix + " ");
  }

  return globMatch(pattern, value);
}

/** Simple glob matching — supports * (any chars) and ? (single char). */
function globMatch(pattern: string, text: string): boolean {
  // Convert glob to regex: escape special chars, replace * and ?
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i").test(text);
}

/** Tools auto-approved in "acceptEdits" mode (everything except bash). Matches Claude Code's acceptEdits. */
export const ACCEPT_EDITS_TOOLS = getAcceptEditsTools();

/** @deprecated Use ACCEPT_EDITS_TOOLS */
export const AUTO_EDIT_TOOLS = ACCEPT_EDITS_TOOLS;
