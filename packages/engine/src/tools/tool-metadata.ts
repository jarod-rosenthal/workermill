/**
 * Tool metadata — declares safety characteristics so permission logic
 * can derive READ_TOOLS and ACCEPT_EDITS_TOOLS from metadata
 * instead of maintaining separate hardcoded sets.
 */

export interface ToolMeta {
  /** Tool is read-only and always safe without prompting */
  isReadOnly: boolean;
  /** Tool can cause destructive/irreversible changes */
  isDestructive: boolean;
  /** Safe to auto-approve in "acceptEdits" permission mode */
  acceptEditsApproved: boolean;
  /** Safe to run concurrently with other tool calls */
  concurrencySafe: boolean;
}

/** Registry of tool metadata keyed by tool name */
export const TOOL_METADATA: Record<string, ToolMeta> = {
  // Read-only tools — always allowed
  read_file:   { isReadOnly: true,  isDestructive: false, acceptEditsApproved: true,  concurrencySafe: true },
  glob:        { isReadOnly: true,  isDestructive: false, acceptEditsApproved: true,  concurrencySafe: true },
  grep:        { isReadOnly: true,  isDestructive: false, acceptEditsApproved: true,  concurrencySafe: true },
  ls:          { isReadOnly: true,  isDestructive: false, acceptEditsApproved: true,  concurrencySafe: true },
  lsp:         { isReadOnly: true,  isDestructive: false, acceptEditsApproved: true,  concurrencySafe: true },
  sub_agent:   { isReadOnly: true,  isDestructive: false, acceptEditsApproved: true,  concurrencySafe: false },

  // Write tools — need permission but safe in acceptEdits
  write_file:  { isReadOnly: false, isDestructive: false, acceptEditsApproved: true,  concurrencySafe: false },
  edit_file:   { isReadOnly: false, isDestructive: false, acceptEditsApproved: true,  concurrencySafe: false },
  patch:       { isReadOnly: false, isDestructive: false, acceptEditsApproved: true,  concurrencySafe: false },
  todo:        { isReadOnly: false, isDestructive: false, acceptEditsApproved: true,  concurrencySafe: true },
  fetch:       { isReadOnly: false, isDestructive: false, acceptEditsApproved: true,  concurrencySafe: true },
  web_search:  { isReadOnly: false, isDestructive: false, acceptEditsApproved: true,  concurrencySafe: true },

  // Execution tools — need explicit permission
  bash:        { isReadOnly: false, isDestructive: false, acceptEditsApproved: false, concurrencySafe: false },
  verify:      { isReadOnly: false, isDestructive: false, acceptEditsApproved: false, concurrencySafe: false },
};

/** Get metadata for a tool, with safe defaults for unknown tools (e.g., MCP tools) */
export function getToolMeta(toolName: string): ToolMeta {
  return TOOL_METADATA[toolName] ?? {
    isReadOnly: false,
    isDestructive: false,
    acceptEditsApproved: false,
    concurrencySafe: false,
  };
}

/** Derive the set of read-only tool names from metadata */
export function getReadOnlyTools(): Set<string> {
  return new Set(
    Object.entries(TOOL_METADATA)
      .filter(([, meta]) => meta.isReadOnly)
      .map(([name]) => name),
  );
}

/** Derive the set of tools approved for acceptEdits mode from metadata */
export function getAcceptEditsTools(): Set<string> {
  return new Set(
    Object.entries(TOOL_METADATA)
      .filter(([, meta]) => meta.acceptEditsApproved)
      .map(([name]) => name),
  );
}
