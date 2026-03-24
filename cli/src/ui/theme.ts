/**
 * Centralized color theme for the WorkerMill CLI.
 * Extracted from Claude Code's visual design language.
 */
export const theme = {
  /** Brand/diamond color — warm orange. */
  brand: "#D77757",
  /** Primary text on dark background. */
  text: "#FFFFFF",
  /** Subtle/dim text — light gray. */
  subtle: "#AFAFAF",
  /** Subtle/dim text — dark gray. */
  subtleDark: "#505050",
  /** Pure black background. */
  background: "#000000",
  /** User message background tint. */
  userBg: "#373737",
  /** Success indicators. */
  success: "#4EBA65",
  /** Warning indicators. */
  warning: "#FFCC00",
  /** Error indicators. */
  error: "#FF6B80",
  /** Permission/suggestion accent — blue-purple. */
  permission: "#5769F7",
  /** Ice blue for highlights. */
  iceBlue: "#ADD8E6",
  /** Professional blue for Read/file tools. */
  blue: "#6A9BCC",
  /** Bash border — pink/magenta. */
  bashBorder: "#FD5DB1",
  /** Inactive/disabled elements. */
  inactive: "#666666",
  /** Default border color. */
  border: "gray",
} as const;

/** Tool name to color mapping for ToolCall display. */
export const toolColors: Record<string, string> = {
  Read: theme.blue,
  Write: theme.warning,
  Edit: theme.warning,
  Bash: theme.bashBorder,
  Glob: theme.iceBlue,
  Grep: theme.iceBlue,
  List: theme.subtle,
  Fetch: theme.blue,
  Patch: theme.warning,
  Agent: theme.permission,
  Git: theme.success,
  Search: theme.blue,
  Todo: theme.subtle,
};

/**
 * Syntax highlighting colors for code blocks.
 */
export const syntax = {
  keyword: "#C586C0",
  string: "#4EBA65",
  comment: "#666666",
  type: "#FFCC00",
  number: "#B5CEA8",
  punctuation: "#AFAFAF",
  default: "#FFFFFF",
} as const;
