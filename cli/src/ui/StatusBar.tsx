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

/** Format a dollar cost as a short string. */
function formatCost(c: number): string {
  if (c < 0.01) return "$0.00";
  return `$${c.toFixed(2)}`;
}

/**
 * Pinned status bar rendered at the bottom of the terminal.
 * Layout: [model] [context bar] [pct] [roles] --- [cwd] [branch] | [cost] [mode (shift+tab)]
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
    case "auto-edit":
      modeColor = theme.warning;
      break;
    default:
      modeColor = theme.success;
      break;
  }

  const bgColor = theme.subtleDark;

  // Build left segments
  const rm = props.roleModels;
  const workerStr = rm?.worker || `${props.provider}/${props.model}`;
  const modelStr = ` ${workerStr} `;
  const pct = props.maxContext > 0 ? Math.round(usage * 100) : 0;
  const tokenStr = ` ${pct}% `;

  const extraRoles: string[] = [];
  if (rm && rm.planner !== rm.worker) extraRoles.push(`plan:${rm.planner}`);
  if (rm && rm.reviewer !== rm.worker) extraRoles.push(`review:${rm.reviewer}`);
  const rolesStr = extraRoles.length > 0 ? `  ${extraRoles.join("  ")} ` : "";

  // Build right segments
  const cwdName = props.cwd || "";
  const costStr = formatCost(props.cost);
  const modeStr = ` ${props.mode} `;
  const hintStr = " shift+tab ";

  // Calculate padding
  const leftLen = modelStr.length + barLen + tokenStr.length + rolesStr.length;
  const branchLen = props.gitBranch ? ` git:(${props.gitBranch})`.length : 0;
  const rightLen = cwdName.length + 1 + branchLen + 3 + costStr.length + modeStr.length + hintStr.length + 1;
  const padding = Math.max(0, width - leftLen - rightLen);

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
      {/* Token percentage */}
      <Text backgroundColor={bgColor} color={theme.text}>
        {tokenStr}
      </Text>
      {/* Planner/reviewer roles */}
      {rolesStr ? (
        <Text backgroundColor={bgColor} color={theme.subtle}>
          {rolesStr}
        </Text>
      ) : null}
      {/* Flexible spacer */}
      <Text backgroundColor={bgColor}>
        {" ".repeat(padding)}
      </Text>
      {/* CWD */}
      <Text backgroundColor={bgColor} color={theme.text}>
        {" "}{cwdName}
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
      {/* Mode badge */}
      <Text backgroundColor={bgColor} color={modeColor} bold>
        {modeStr}
      </Text>
      {/* Shift+Tab hint */}
      <Text backgroundColor={bgColor} color={theme.subtle} dimColor>
        {"shift+tab"}
      </Text>
      <Text backgroundColor={bgColor}>
        {" "}
      </Text>
    </Box>
  );
}
