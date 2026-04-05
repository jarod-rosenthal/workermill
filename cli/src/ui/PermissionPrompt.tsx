import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "./theme.js";
import type { PermissionRequest } from "./types.js";
import { getCommandPrefix } from "../safety.js";

interface Option {
  key: string;
  label: string;
}

/** Extract a short description of what the tool wants to do. */
function describeAction(request: PermissionRequest): string {
  const input = request.toolInput;
  if (input._display) return String(input._display);
  if (input.file_path) return String(input.file_path);
  if (input.path) return String(input.path);
  if (input.command) {
    const cmd = String(input.command);
    return cmd.length > 80 ? cmd.slice(0, 77) + "..." : cmd;
  }
  return "";
}

interface PermissionPromptProps {
  request: PermissionRequest;
}

/**
 * Interactive inline permission prompt with blue-purple border (matching
 * Claude Code's permission/suggestion color). Renders a bordered box with
 * the tool name, action detail, and a selectable list of options with
 * radio-button style selection.
 *
 * For bash commands, the "don't ask again" option shows a prefix pattern
 * (e.g. "npm run:*") so the user knows exactly what they're allowing.
 * This matches Claude Code's editable prefix pattern.
 */
export function PermissionPrompt({ request }: PermissionPromptProps): React.ReactElement {
  // For bash, compute a prefix pattern for the "don't ask again" label
  const bashPrefix = request.toolName === "bash" && request.toolInput.command
    ? getCommandPrefix(String(request.toolInput.command))
    : null;
  const prefixLabel = bashPrefix ? `${bashPrefix}:*` : null;

  const options: Option[] = request.isDangerous
    ? [
        { key: "y", label: "Yes, allow" },
        { key: "n", label: "No, deny" },
        { key: "t", label: "Trust all (bypass permissions for this session)" },
      ]
    : [
        { key: "y", label: "Yes" },
        { key: "a", label: prefixLabel
            ? `Yes, don\u2019t ask again for ${prefixLabel}`
            : "Yes, don\u2019t ask again" },
        { key: "t", label: "Trust all (bypass permissions for this session)" },
        { key: "n", label: "Deny" },
      ];

  const [selected, setSelected] = useState(0);
  const [resolved, setResolved] = useState(false);

  useInput(
    (input, key) => {
      if (resolved) return;
      const isEscape = key.escape || input === "\u001b";

      // ESC denies the permission request
      if (isEscape) {
        setResolved(true);
        request.resolve(false);
        return;
      }

      // Tab / Shift+Tab to cycle (Claude Code style) + arrow keys
      if (key.tab) {
        if (key.shift) {
          setSelected((s) => (s - 1 + options.length) % options.length);
        } else {
          setSelected((s) => (s + 1) % options.length);
        }
        return;
      }
      if (key.upArrow) {
        setSelected((s) => Math.max(0, s - 1));
        return;
      }
      if (key.downArrow) {
        setSelected((s) => Math.min(options.length - 1, s + 1));
        return;
      }

      if (key.return) {
        setResolved(true);
        const opt = options[selected];
        if (opt.key === "n") request.resolve(false);
        else if (opt.key === "t") request.resolve(true, "trust");
        else if (opt.key === "a") request.resolve(true, "always");
        else request.resolve(true);
        return;
      }

      // Direct key shortcuts
      if (input === "y" || input === "Y") {
        setResolved(true);
        request.resolve(true);
      } else if (input === "n" || input === "N") {
        setResolved(true);
        request.resolve(false);
      } else if (!request.isDangerous && (input === "a" || input === "A")) {
        setResolved(true);
        request.resolve(true, "always");
      } else if (input === "t" || input === "T") {
        setResolved(true);
        request.resolve(true, "trust");
      }
    },
    { isActive: !resolved },
  );

  const detail = describeAction(request);
  const borderColor = request.isDangerous ? theme.error : theme.permission;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
      marginY={1}
      marginLeft={2}
    >
      {/* Header */}
      {request.isDangerous ? (
        <Text color={theme.error} bold>
          {"\u26A0 "}Dangerous: {request.dangerLabel || request.toolName}
        </Text>
      ) : (
        <Text color={theme.permission} bold>
          {"? "}Allow <Text color={theme.text} bold>{request.toolName}</Text>
        </Text>
      )}

      {/* Detail */}
      {detail ? (
        <Text color={theme.subtle}>{"  "}{detail}</Text>
      ) : null}

      {/* Spacer */}
      <Text>{" "}</Text>

      {/* Options with radio-button style */}
      {options.map((opt, i) => {
        const isSelected = i === selected;
        const radio = isSelected ? "\u25C9" : "\u25CB";
        return (
          <Box key={opt.key} marginLeft={1}>
            <Text
              color={isSelected ? theme.permission : theme.subtle}
              bold={isSelected}
            >
              {radio} ({opt.key}) {opt.label}
            </Text>
          </Box>
        );
      })}

      {/* Hint */}
      <Text color={theme.subtle} dimColor>
        {"  "}Tab to cycle, Enter to confirm, Esc to deny
      </Text>
    </Box>
  );
}
