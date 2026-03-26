import React from "react";
import { Box, Text, useStdout } from "ink";
import { theme } from "./theme.js";

interface StatusBarProps {
  model: string;
  provider: string;
  tokens: number;
  maxContext: number;
  cost: number;
  mode: string;
  gitBranch: string;
  cwd: string;
  roleModels?: { worker: string; planner: string; reviewer: string };
  /** Tool usage counts: { bash: 5, read_file: 3, ... } */
  toolCounts?: Record<string, number>;
  /** Number of connected MCP servers */
  mcpCount?: number;
  /** Session start time (ms since epoch) */
  sessionStart?: number;
  /** Whether WORKERMILL.md or similar instructions file is loaded */
  hasInstructions?: boolean;
}

/** Format a dollar cost as a short string. */
function formatCost(c: number): string {
  if (c < 0.01) return "$0.00";
  return `$${c.toFixed(2)}`;
}

/** Format elapsed time as Xh Ym */
function formatElapsed(startMs: number): string {
  const elapsed = Math.floor((Date.now() - startMs) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  const mins = Math.floor(elapsed / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

/**
 * Three-row status bar:
 * Row 1: [model] [context bar] [pct] | [cwd] git:(branch) | [instructions] | [cost] [time]
 * Row 2: [tool usage stats]
 * Row 3: [permission mode] (shift+tab to cycle)
 */
export function StatusBar(props: StatusBarProps): React.ReactElement {
  const { stdout } = useStdout();
  const width = stdout?.columns || 80;
  const bgColor = theme.subtleDark;

  // Context usage bar
  const barLen = 10;
  const usage = Math.min(1, props.maxContext > 0 ? props.tokens / props.maxContext : 0);
  const filled = Math.round(usage * barLen);
  const empty = barLen - filled;
  const barColor = usage < 0.5 ? theme.success : usage < 0.8 ? theme.warning : theme.error;
  const pct = props.maxContext > 0 ? Math.round(usage * 100) : 0;

  // Mode
  let modeColor: string;
  let modeIcon: string;
  switch (props.mode) {
    case "PLAN":
      modeColor = theme.bashBorder;
      modeIcon = "\u25B6"; // ▶
      break;
    case "trust all":
      modeColor = theme.error;
      modeIcon = "\u23E9"; // ⏩
      break;
    case "auto-edit":
      modeColor = theme.warning;
      modeIcon = "\u23E9"; // ⏩
      break;
    default:
      modeColor = theme.success;
      modeIcon = "\u25B6"; // ▶
      break;
  }

  // Model display
  const rm = props.roleModels;
  const workerStr = rm?.worker || `${props.provider}/${props.model}`;

  // Tool counts for row 2
  const counts = props.toolCounts || {};
  const toolEntries = Object.entries(counts)
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  // Row 1 right side
  const costStr = formatCost(props.cost);
  const timeStr = props.sessionStart ? formatElapsed(props.sessionStart) : "";
  const instructionsStr = props.hasInstructions ? " WORKERMILL.md" : "";
  const mcpStr = props.mcpCount && props.mcpCount > 0 ? ` ${props.mcpCount} MCP` : "";

  // Row 1 padding
  const row1Left = ` [${workerStr}] `.length + barLen + ` ${pct}% `.length;
  const row1Right = ` ${props.cwd}`.length
    + (props.gitBranch ? ` git:(${props.gitBranch})`.length : 0)
    + (instructionsStr ? ` |${instructionsStr}`.length : 0)
    + (mcpStr ? ` |${mcpStr}`.length : 0)
    + ` | ${costStr}`.length
    + (timeStr ? ` | ${timeStr}`.length : 0)
    + 1;
  const row1Pad = Math.max(0, width - row1Left - row1Right);

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Row 1: Model + context + project info */}
      <Box>
        <Text backgroundColor={bgColor} color={theme.text}>
          {" ["}
        </Text>
        <Text backgroundColor={bgColor} color={theme.brand} bold>
          {workerStr}
        </Text>
        <Text backgroundColor={bgColor} color={theme.text}>
          {"] "}
        </Text>
        <Text backgroundColor={bgColor} color={barColor}>
          {"█".repeat(filled)}{"░".repeat(empty)}
        </Text>
        <Text backgroundColor={bgColor} color={theme.text}>
          {` ${pct}% `}
        </Text>
        <Text backgroundColor={bgColor}>
          {" ".repeat(row1Pad)}
        </Text>
        <Text backgroundColor={bgColor} color={theme.text}>
          {" "}{props.cwd}
        </Text>
        {props.gitBranch ? (
          <Text backgroundColor={bgColor}>
            <Text color={theme.text}>{" git:("}</Text>
            <Text color={theme.success}>{props.gitBranch}</Text>
            <Text color={theme.text}>{")"}</Text>
          </Text>
        ) : null}
        {instructionsStr ? (
          <Text backgroundColor={bgColor} color={theme.subtle}>
            {" |"}{instructionsStr}
          </Text>
        ) : null}
        {mcpStr ? (
          <Text backgroundColor={bgColor} color={theme.subtle}>
            {" |"}{mcpStr}
          </Text>
        ) : null}
        <Text backgroundColor={bgColor} color={theme.subtle}>
          {" | "}
        </Text>
        <Text backgroundColor={bgColor} color={theme.text}>
          {costStr}
        </Text>
        {timeStr ? (
          <>
            <Text backgroundColor={bgColor} color={theme.subtle}>{" | "}</Text>
            <Text backgroundColor={bgColor} color={theme.subtle}>{timeStr}</Text>
          </>
        ) : null}
        <Text backgroundColor={bgColor}>{" "}</Text>
      </Box>

      {/* Row 2: Tool usage stats */}
      <Box>
        <Text color={theme.subtle}>
          {" "}
        </Text>
        {toolEntries.length > 0 ? (
          toolEntries.map(([name, count], i) => (
            <Text key={name}>
              <Text color={theme.success}>{"✓ "}</Text>
              <Text color={theme.text}>{name.replace(/_/g, " ")}</Text>
              <Text color={theme.subtle}>{` ×${count}`}</Text>
              {i < toolEntries.length - 1 ? <Text color={theme.subtle}>{" | "}</Text> : null}
            </Text>
          ))
        ) : (
          <Text color={theme.subtle}>
            {"no tool calls yet"}
          </Text>
        )}
        {/* Planner/reviewer roles */}
        {rm && (rm.planner !== rm.worker || rm.reviewer !== rm.worker) ? (
          <Text color={theme.subtle}>
            {"  "}
            {rm.planner !== rm.worker ? `plan:${rm.planner} ` : ""}
            {rm.reviewer !== rm.worker ? `review:${rm.reviewer}` : ""}
          </Text>
        ) : null}
      </Box>

      {/* Row 3: Permission mode */}
      <Box>
        <Text color={modeColor} bold>
          {` ${modeIcon}${modeIcon} ${props.mode} `}
        </Text>
        <Text color={theme.subtle} dimColor>
          {"(shift+tab to cycle)"}
        </Text>
      </Box>
    </Box>
  );
}
