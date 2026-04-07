// ---------------------------------------------------------------------------
// Tool status labels
// ---------------------------------------------------------------------------

const TOOL_NAME_ALIASES: Record<string, string> = {
  // File operations
  read: "read_file",
  rd: "read_file",
  "read-file": "read_file",
  readfile: "read_file",
  readf: "read_file",
  rf: "read_file",
  write: "write_file",
  wr: "write_file",
  "write-file": "write_file",
  writefile: "write_file",
  writef: "write_file",
  wf: "write_file",
  edit: "edit_file",
  ed: "edit_file",
  "edit-file": "edit_file",
  editfile: "edit_file",
  editf: "edit_file",
  ef: "edit_file",
  multiedit: "multi_edit_file",
  "multi-edit": "multi_edit_file",
  "multi-edit-file": "multi_edit_file",
  multieditfile: "multi_edit_file",
  mef: "multi_edit_file",
  // Listing/search
  list: "ls",
  list_dir: "ls",
  "list-dir": "ls",
  listdir: "ls",
  list_files: "ls",
  listfiles: "ls",
  list_directory: "ls",
  listdirectory: "ls",
  search: "grep",
  search_code: "grep",
  searchcode: "grep",
  find: "grep",
  exec: "bash",
  execute: "bash",
  command: "bash",
  cmd: "bash",
  shell: "bash",
  terminal: "bash",
  // Common dashed/camel variants
  subagent: "sub_agent",
  "sub-agent": "sub_agent",
  spawn_agent: "sub_agent",
  spawnagent: "sub_agent",
  websearch: "web_search",
  "web-search": "web_search",
};

export function normalizeToolName(toolName: string): string {
  const normalized = toolName.trim().toLowerCase();
  return TOOL_NAME_ALIASES[normalized] || normalized;
}

export function toolStatusLabel(toolName: string, input: Record<string, unknown>): string {
  switch (normalizeToolName(toolName)) {
    case "read_file":
      return `Reading ${input.file_path || "file"}...`;
    case "write_file":
      return `Writing ${input.file_path || "file"}...`;
    case "edit_file":
      return `Editing ${input.file_path || "file"}...`;
    case "multi_edit_file":
      return `Editing ${input.file_path || "file"} (${Array.isArray(input.edits) ? input.edits.length : "?"} edits)...`;
    case "glob":
      return `Searching files${input.pattern ? ` (${input.pattern})` : ""}...`;
    case "grep":
      return `Searching code${input.pattern ? ` for "${String(input.pattern).slice(0, 30)}"` : ""}...`;
    case "ls":
      return `Listing ${input.path || "directory"}...`;
    case "bash": {
      const cmd = String(input.command || "").slice(0, 40);
      return `Running ${cmd}${String(input.command || "").length > 40 ? "..." : ""}`;
    }
    case "sub_agent":
      return "Running sub-agent...";
    case "lsp":
      return `LSP ${input.action || "query"}...`;
    case "browser_open":
      return "Opening browser...";
    case "browser_navigate":
      return `Navigating to ${input.url || "page"}...`;
    case "browser_screenshot":
      return "Taking screenshot...";
    case "browser_click":
      return `Clicking ${input.selector || "element"}...`;
    case "browser_fill":
      return `Filling ${input.selector || "field"}...`;
    case "browser_evaluate":
      return "Running JavaScript...";
    case "browser_console":
      return "Reading console...";
    case "browser_close":
      return "Closing browser...";
    default:
      return `Running ${toolName}...`;
  }
}
