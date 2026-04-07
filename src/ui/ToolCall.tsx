import React from "react";
import { Box, Text } from "ink";
import { theme, toolColors } from "./theme.js";
import type { ToolCallInfo } from "./types.js";

/** Human-friendly labels for known tool names. */
const LABELS: Record<string, string> = {
  bash: "Bash",
  read_file: "Read",
  write_file: "Write",
  edit_file: "Edit",
  glob: "Glob",
  grep: "Grep",
  ls: "List",
  fetch: "Fetch",
  patch: "Patch",
  sub_agent: "Agent",
  git: "Git",
  web_search: "Search",
  todo: "Todo",
};

/** Spinner frames for running tools. */
const SPINNER_FRAMES = ["\u28CB", "\u28D9", "\u28F9", "\u28F8", "\u28FC", "\u28F4", "\u28E6", "\u28E7", "\u28C7", "\u28CF"];

/** Extract the most relevant detail string from a tool's input. */
function extractDetail(input: Record<string, unknown>): string {
  if (input.file_path) return String(input.file_path);
  if (input.path) return String(input.path);
  if (input.command) {
    const cmd = String(input.command);
    return cmd.length > 80 ? cmd.slice(0, 77) + "..." : cmd;
  }
  if (input.pattern) return `pattern: ${String(input.pattern)}`;
  if (input.query) return String(input.query).slice(0, 80);

  const keys = Object.keys(input).slice(0, 2);
  if (keys.length === 0) return "";
  return keys
    .map((k) => {
      const v = String(input[k]);
      return `${k}: ${v.length > 40 ? v.slice(0, 37) + "..." : v}`;
    })
    .join(", ");
}

interface ToolCallDisplayProps {
  tool: ToolCallInfo;
  tick?: number;
  animate?: boolean;
}

/**
 * Displays a single tool call in Claude Code style.
 * Format:  arrow Label detail
 *
 * - Pending: dim down-arrow
 * - Running: yellow spinner
 * - Done: green checkmark
 * - Denied: red cross
 */
export function ToolCallDisplay({ tool, tick = 0, animate = true }: ToolCallDisplayProps): React.ReactElement {
  const label = LABELS[tool.name] || tool.name;
  const detail = extractDetail(tool.input);
  const labelColor = toolColors[label] || theme.blue;

  let statusIcon: React.ReactElement;
  switch (tool.status) {
    case "done":
      statusIcon = <Text color={theme.success}>{"\u2713"}</Text>;
      break;
    case "denied":
      statusIcon = <Text color={theme.error}>{"\u2717"}</Text>;
      break;
    case "running": {
      const frame = animate ? SPINNER_FRAMES[tick % SPINNER_FRAMES.length] : "●";
      statusIcon = <Text color={theme.warning}>{frame}</Text>;
      break;
    }
    default:
      statusIcon = <Text color={theme.subtle}>{"\u2193"}</Text>;
      break;
  }

  return (
    <Box>
      <Text>{"  "}</Text>
      {statusIcon}
      <Text> </Text>
      <Text bold color={labelColor}>
        {label}
      </Text>
      {detail ? (
        <Text color={theme.subtle}>{" "}{detail}</Text>
      ) : null}
    </Box>
  );
}
