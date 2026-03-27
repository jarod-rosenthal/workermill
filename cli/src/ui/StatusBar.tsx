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

/** Format a dollar cost as a short string. Prefixed with ~ to indicate estimate. */
function formatCost(c: number): string {
  if (c < 0.01) return "~$0.00";
  return `~$${c.toFixed(2)}`;
}

/** Format elapsed time — minutes only to avoid per-second re-renders. */
function formatElapsed(startMs: number): string {
  const mins = Math.floor((Date.now() - startMs) / 60_000);
  if (mins < 1) return "<1m";
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
      modeIcon = "\u25B8"; // ▸
      break;
    case "trust all":
      modeColor = theme.error;
      modeIcon = "\u25C8"; // ◈
      break;
    case "auto-edit":
      modeColor = theme.warning;
      modeIcon = "\u25C6"; // ◆
      break;
    default:
      modeColor = theme.success;
      modeIcon = "\u25B8"; // ▸
      break;
  }

  // Model display
  const rm = props.roleModels;
  const workerStr = rm?.worker || `${props.provider}/${props.model}`;

  // Tool counts for row 2
  const counts = props.toolCounts || {};
  const toolEntries = Object.entries(counts)
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1]);

  // Row 1 right side
  const costStr = formatCost(props.cost);
  const timeStr = props.sessionStart ? formatElapsed(props.sessionStart) : "";
  const instructionsStr = props.hasInstructions ? " WORKERMILL.md" : "";
  const mcpStr = props.mcpCount && props.mcpCount > 0 ? ` ${props.mcpCount} MCP` : "";

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.subtle}
      paddingLeft={1}
      paddingRight={1}
      width={width}
    >
      {/* Row 1: Model + context + project info — left-aligned with │ separators */}
      <Box>
        <Text color={theme.text}>{"["}</Text>
        <Text color={theme.brand} bold>{workerStr}</Text>
        <Text color={theme.text}>{"] "}</Text>
        <Text color={barColor}>
          {"█".repeat(filled)}{"░".repeat(empty)}
        </Text>
        <Text color={theme.text}>{` ${pct}%`}</Text>
        <Text color={theme.subtle}>{" │ "}</Text>
        <Text color={theme.text}>{props.cwd}</Text>
        {props.gitBranch ? (
          <Text>
            <Text color={theme.text}>{" git:("}</Text>
            <Text color={theme.success}>{props.gitBranch}</Text>
            <Text color={theme.text}>{")"}</Text>
          </Text>
        ) : null}
        {instructionsStr ? (
          <Text color={theme.subtle}>{" │"}{instructionsStr}</Text>
        ) : null}
        {mcpStr ? (
          <Text color={theme.subtle}>{" │"}{mcpStr}</Text>
        ) : null}
        <Text color={theme.subtle}>{" │ "}</Text>
        <Text color={theme.text}>{costStr}</Text>
        {timeStr ? (
          <>
            <Text color={theme.subtle}>{" │ "}</Text>
            <Text color={theme.subtle}>{timeStr}</Text>
          </>
        ) : null}
      </Box>

      {/* Row 2: Tool usage stats — wraps to next line if too wide */}
      <Box flexWrap="wrap">
        {toolEntries.length > 0 ? (
          toolEntries.map(([name, count], i) => (
            <Text key={name} dimColor>
              <Text color={theme.success}>{"✓ "}</Text>
              <Text color={theme.subtle}>{name.replace(/_/g, " ")}</Text>
              <Text color={theme.inactive}>{` ×${count}`}</Text>
              {i < toolEntries.length - 1 ? <Text color={theme.inactive}>{" │ "}</Text> : null}
            </Text>
          ))
        ) : (
          <Text color={theme.subtle}>{"no tool calls"}</Text>
        )}
      </Box>

      {/* Row 3: Permission mode + planner/reviewer */}
      <Box>
        <Text color={modeColor} bold>{`${modeIcon} ${props.mode}`}</Text>
        <Text color={theme.subtle} dimColor>{" (shift+tab)"}</Text>
        {rm && (rm.planner !== rm.worker || rm.reviewer !== rm.worker) ? (
          <>
            <Box flexGrow={1} />
            {rm.planner !== rm.worker ? (
              <Text>
                <Text color={theme.iceBlue} bold>{"plan"}</Text>
                <Text color={theme.subtle}>:</Text>
                <Text color={theme.iceBlue}>{rm.planner}</Text>
              </Text>
            ) : null}
            {rm.planner !== rm.worker && rm.reviewer !== rm.worker ? (
              <Text color={theme.subtle}>{" │ "}</Text>
            ) : null}
            {rm.reviewer !== rm.worker ? (
              <Text>
                <Text color={theme.bashBorder} bold>{"review"}</Text>
                <Text color={theme.subtle}>:</Text>
                <Text color={theme.bashBorder}>{rm.reviewer}</Text>
              </Text>
            ) : null}
          </>
        ) : null}
      </Box>
    </Box>
  );
}
