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
  { pattern: /rm\s+(-[a-z]*f|-[a-z]*r|--force|--recursive)/i, label: "recursive/forced delete" },
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
]);

/** Tools auto-approved in "auto-edit" mode (everything except bash and destructive ops). */
export const AUTO_EDIT_TOOLS = new Set<string>([
  "read_file", "write_file", "edit_file", "patch",
  "glob", "grep", "ls", "fetch", "git", "web_search", "todo", "sub_agent",
]);
