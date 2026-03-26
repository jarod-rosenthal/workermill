import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "./theme.js";

const BUILTIN_COMMANDS = [
  { name: "/as", desc: "Run task as persona" },
  { name: "/build", desc: "Multi-expert orchestration" },
  { name: "/retry", desc: "Re-run last build" },
  { name: "/init", desc: "Generate WORKERMILL.md" },
  { name: "/setup", desc: "Re-run provider setup wizard" },
  { name: "/settings", desc: "View/change settings" },
  { name: "/permissions", desc: "Tool permissions" },
  { name: "/undo", desc: "Revert changes" },
  { name: "/diff", desc: "Preview changes" },
  { name: "/model", desc: "Show/switch model" },
  { name: "/plan", desc: "Toggle read-only mode" },
  { name: "/trust", desc: "Auto-approve tools" },
  { name: "/hooks", desc: "View tool hooks" },
  { name: "/skills", desc: "Custom commands" },
  { name: "/personas", desc: "List/create personas" },
  { name: "/mcp", desc: "MCP server status" },
  { name: "/chrome", desc: "Open/close browser" },
  { name: "/voice", desc: "Voice input" },
  { name: "/schedule", desc: "Scheduled tasks" },
  { name: "/update", desc: "Update to latest" },
  { name: "/release-notes", desc: "Changelog" },
  { name: "/cost", desc: "Token costs" },
  { name: "/status", desc: "Session info" },
  { name: "/log", desc: "CLI log entries" },
  { name: "/git", desc: "Git status" },
  { name: "/sessions", desc: "Manage sessions" },
  { name: "/editor", desc: "Open $EDITOR" },
  { name: "/clear", desc: "Reset conversation" },
  { name: "/help", desc: "All commands" },
  { name: "/quit", desc: "Exit" },
];

interface InputProps {
  /** Called when the user presses Enter with a non-empty value. */
  onSubmit: (value: string) => void;
  /** When false, the input ignores all keystrokes (agent is running). */
  isActive: boolean;
  /** Past inputs for up/down arrow history navigation, newest first. */
  history: string[];
}

/**
 * User text input component with history and slash command autocomplete.
 */
export function Input({ onSubmit, isActive, history }: InputProps): React.ReactElement {
  const [value, setValue] = useState("");
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [completionIndex, setCompletionIndex] = useState(0);

  // Filter matching commands when input starts with /
  const completions = useMemo(() => {
    if (!value.startsWith("/") || value.includes(" ")) return [];
    const query = value.toLowerCase();
    return BUILTIN_COMMANDS.filter((c) => c.name.startsWith(query) && c.name !== query);
  }, [value]);

  const showCompletions = isActive && completions.length > 0;

  useInput(
    (input, key) => {
      if (!isActive) return;

      // Tab: accept completion
      if (key.tab && showCompletions) {
        const selected = completions[completionIndex % completions.length];
        if (selected) {
          setValue(selected.name + " ");
          setCompletionIndex(0);
        }
        return;
      }

      // Up/Down when completions are showing: navigate completions
      if (showCompletions && key.upArrow) {
        setCompletionIndex((i) => (i - 1 + completions.length) % completions.length);
        return;
      }
      if (showCompletions && key.downArrow) {
        setCompletionIndex((i) => (i + 1) % completions.length);
        return;
      }

      // Submit
      if (key.return) {
        const trimmed = value.trim();
        if (trimmed) {
          onSubmit(trimmed);
          setValue("");
          setHistoryIndex(-1);
          setCompletionIndex(0);
        }
        return;
      }

      // History: up — navigate from most recent to oldest.
      // historyIndex: -1 = not navigating, 0 = most recent, 1 = second most recent, etc.
      if (key.upArrow) {
        const newIdx = Math.min(historyIndex + 1, history.length - 1);
        if (newIdx >= 0 && history.length > 0) {
          setHistoryIndex(newIdx);
          setValue(history[history.length - 1 - newIdx]);
        }
        return;
      }

      // History: down — navigate back toward most recent
      if (key.downArrow) {
        const newIdx = historyIndex - 1;
        if (newIdx >= 0 && history.length > 0) {
          setHistoryIndex(newIdx);
          setValue(history[history.length - 1 - newIdx]);
        } else {
          setHistoryIndex(-1);
          setValue("");
        }
        return;
      }

      // Escape: clear completions / clear input
      if (key.escape) {
        if (showCompletions) {
          setCompletionIndex(0);
          // Don't clear value — just dismiss completions by adding a space
          // Actually, just let parent ESC handler deal with it
        }
        return;
      }

      // Backspace / delete
      if (key.backspace || key.delete) {
        setValue((v) => v.slice(0, -1));
        setCompletionIndex(0);
        return;
      }

      // Ctrl+U: clear line
      if (key.ctrl && input === "u") {
        setValue("");
        setCompletionIndex(0);
        return;
      }

      // Ctrl+W: delete last word
      if (key.ctrl && input === "w") {
        setValue((v) => v.replace(/\S+\s*$/, ""));
        setCompletionIndex(0);
        return;
      }

      // Regular character input (ignore ctrl/meta sequences)
      if (input && !key.ctrl && !key.meta) {
        setValue((v) => v + input);
        setCompletionIndex(0);
      }
    },
    { isActive },
  );

  // Inline hint: show the best match after the cursor, no height change
  const hint = showCompletions && completions.length > 0
    ? completions[completionIndex % completions.length]
    : null;

  return (
    <Box>
      <Text color={isActive ? theme.brand : theme.inactive} bold>
        {isActive ? "\u25C6 " : "\u25C7 "}
      </Text>
      <Text color={theme.text}>{value}</Text>
      {isActive && !hint && <Text inverse>{" "}</Text>}
      {hint ? (
        <Text color={theme.subtle} dimColor>
          {hint.name.slice(value.length)}{" "}
          <Text color={theme.inactive}>{hint.desc}</Text>
          {completions.length > 1 ? <Text color={theme.inactive}>{` (↑↓ ${completions.length} matches, tab)`}</Text> : <Text color={theme.inactive}>{" (tab)"}</Text>}
        </Text>
      ) : null}
    </Box>
  );
}
