/**
 * Centralized safety constants for the WorkerMill CLI.
 *
 * These MUST be the single source of truth — do not define DANGEROUS_PATTERNS,
 * READ_TOOLS, or AUTO_EDIT_TOOLS anywhere else in the codebase.
 */

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

/** Tools that are read-only and always allowed without prompting. */
export const READ_TOOLS = new Set<string>([
  "read_file",
  "glob",
  "grep",
  "ls",
  "sub_agent",
  "lsp",
]);

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

/**
 * Generate a permission rule pattern from a bash command.
 * Keeps the command name and first few args, adds * for flexibility.
 * e.g. "npm run test --verbose" → "bash(npm run test *)"
 * e.g. "git status" → "bash(git status)"
 */
export function commandToRule(command: string): string {
  const trimmed = command.trim();
  // Take up to first 3 tokens for the pattern, append * if there are more
  const tokens = trimmed.split(/\s+/);
  if (tokens.length <= 3) {
    return `bash(${trimmed})`;
  }
  return `bash(${tokens.slice(0, 3).join(" ")} *)`;
}

/** Match a rule like "bash(npm run *)" against a tool name and value. */
function matchesRule(rule: string, toolName: string, value: string): boolean {
  const parenIdx = rule.indexOf("(");
  if (parenIdx === -1) {
    // Simple tool name match: "bash", "write_file"
    return rule === toolName;
  }

  // Pattern match: "bash(npm run *)"
  const ruleTool = rule.slice(0, parenIdx);
  if (ruleTool !== toolName) return false;

  const pattern = rule.slice(parenIdx + 1, rule.endsWith(")") ? -1 : undefined);
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
export const ACCEPT_EDITS_TOOLS = new Set<string>([
  "read_file", "write_file", "edit_file", "patch",
  "glob", "grep", "ls", "fetch", "git", "web_search", "todo", "sub_agent",
]);

/** @deprecated Use ACCEPT_EDITS_TOOLS */
export const AUTO_EDIT_TOOLS = ACCEPT_EDITS_TOOLS;
