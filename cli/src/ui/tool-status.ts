// ---------------------------------------------------------------------------
// Tool status labels
// ---------------------------------------------------------------------------

export function toolStatusLabel(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "read_file":
      return `Reading ${input.file_path || "file"}...`;
    case "write_file":
      return `Writing ${input.file_path || "file"}...`;
    case "edit_file":
      return `Editing ${input.file_path || "file"}...`;
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
    case "git":
      return `Git ${input.action || ""}...`;
    case "sub_agent":
      return "Running sub-agent...";
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
