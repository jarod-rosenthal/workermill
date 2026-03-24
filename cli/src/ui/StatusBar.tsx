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
}

/** Format a token count as a compact string: 1.2k, 45k, 1.2M. */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Format a dollar cost as a short string. */
function formatCost(c: number): string {
  if (c < 0.01) return "$0.00";
  return `$${c.toFixed(2)}`;
}

/**
 * Pinned status bar rendered at the bottom of the terminal.
 * Full-width colored background with model, context bar, tokens,
 * cwd, git branch, cost, and mode.
 */
export function StatusBar(props: StatusBarProps): React.ReactElement {
  const { stdout } = useStdout();
  const width = stdout?.columns || 80;

  // Context usage bar
  const barLen = 8;
  const usage = Math.min(1, props.maxContext > 0 ? props.tokens / props.maxContext : 0);
  const filled = Math.round(usage * barLen);
  const empty = barLen - filled;
  const barColor = usage < 0.5 ? theme.success : usage < 0.8 ? theme.warning : theme.error;

  // Mode color
  let modeColor: string;
  switch (props.mode) {
    case "PLAN":
      modeColor = theme.bashBorder;
      break;
    case "trust all":
      modeColor = theme.error;
      break;
    default:
      modeColor = theme.success;
      break;
  }

  const bgColor = theme.subtleDark;

  // Build segments
  const rm = props.roleModels;
  const workerStr = rm?.worker || `${props.provider}/${props.model}`;
  // Show planner/reviewer only when they differ from worker
  const extraRoles: string[] = [];
  if (rm && rm.planner !== rm.worker) extraRoles.push(`plan:${rm.planner}`);
  if (rm && rm.reviewer !== rm.worker) extraRoles.push(`review:${rm.reviewer}`);
  const rolesStr = extraRoles.length > 0 ? ` (${extraRoles.join(", ")})` : "";
  const modelStr = ` ${workerStr}${rolesStr} `;
  const pct = props.maxContext > 0 ? Math.round(usage * 100) : 0;
  const tokenStr = ` ${pct}% `;
  const costStr = formatCost(props.cost);
  const branchStr = props.gitBranch ? ` git:(${props.gitBranch})` : "";
  const cwdStr = props.cwd ? ` ${props.cwd}` : "";
  const rightStr = `${cwdStr}${branchStr} | ${costStr} `;

  // Calculate padding needed to fill the terminal width
  const fixedLen = modelStr.length + barLen + tokenStr.length + rightStr.length + props.mode.length + 2;
  const padding = Math.max(0, width - fixedLen);

  return (
    <Box marginTop={1}>
      {/* Model name */}
      <Text backgroundColor={bgColor} color={theme.text}>
        {modelStr}
      </Text>
      {/* Context usage bar */}
      <Text backgroundColor={bgColor} color={barColor}>
        {"█".repeat(filled)}
        {"░".repeat(empty)}
      </Text>
      {/* Token count */}
      <Text backgroundColor={bgColor} color={theme.text}>
        {tokenStr}
      </Text>
      {/* Flexible spacer */}
      <Text backgroundColor={bgColor}>
        {" ".repeat(padding)}
      </Text>
      {/* CWD */}
      <Text backgroundColor={bgColor} color={theme.text}>
        {cwdStr}
      </Text>
      {/* Git branch */}
      {props.gitBranch ? (
        <Text backgroundColor={bgColor}>
          <Text color={theme.text}>{" git:("}</Text>
          <Text color={theme.success}>{props.gitBranch}</Text>
          <Text color={theme.text}>{")"}</Text>
        </Text>
      ) : null}
      {/* Separator and cost */}
      <Text backgroundColor={bgColor} color={theme.subtle}>
        {" | "}
      </Text>
      <Text backgroundColor={bgColor} color={theme.text}>
        {costStr}
      </Text>
      <Text backgroundColor={bgColor} color={theme.text}>
        {" "}
      </Text>
      {/* Mode badge */}
      <Text backgroundColor={bgColor} color={modeColor} bold>
        {props.mode}
      </Text>
      <Text backgroundColor={bgColor}>
        {" "}
      </Text>
    </Box>
  );
}
