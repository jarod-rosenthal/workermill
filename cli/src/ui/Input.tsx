import React, { useState, useMemo, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import fs from "fs";
import { theme } from "./theme.js";
import { listProviders } from "../../../api/src/providers/index.js";
import { resolveConfig } from "../config.js";

const BUILTIN_COMMANDS = [
  { name: "/as", desc: "Run task as persona" },
  { name: "/ship", desc: "Multi-expert orchestration" },
  { name: "/build", desc: "Alias for /ship" },
  { name: "/retry", desc: "Re-run last build" },
  { name: "/init", desc: "Generate WORKERMILL.md" },
  { name: "/setup", desc: "Re-run provider setup wizard" },
  { name: "/settings", desc: "View/change settings" },
  { name: "/permissions", desc: "Tool permissions" },
  { name: "/undo", desc: "Revert changes" },
  { name: "/diff", desc: "Preview changes" },
  { name: "/model", desc: "Show/switch model" },
  { name: "/review", desc: "Code review with tech lead" },
  { name: "/trust", desc: "Auto-approve tools" },
  { name: "/hooks", desc: "View tool hooks" },
  { name: "/skills", desc: "Custom commands" },
  { name: "/memories", desc: "View project memories" },
  { name: "/remember", desc: "Save a memory" },
  { name: "/forget", desc: "Remove a memory" },
  { name: "/personas", desc: "List/create personas" },
  { name: "/mcp", desc: "MCP server status" },
  { name: "/chrome", desc: "Browser (experimental)" },
  { name: "/voice", desc: "Voice (experimental)" },
  { name: "/schedule", desc: "Scheduled tasks (experimental)" },
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
  const [cursorPos, setCursorPos] = useState(0);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [completionIndex, setCompletionIndex] = useState(0);

  // Fetch Ollama models once on mount (async)
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  useEffect(() => {
    const config = resolveConfig();
    const ollamaHost = config?.providers?.ollama?.host || "http://localhost:11434";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    globalThis.fetch(`${ollamaHost}/api/tags`, { signal: controller.signal })
      .then(res => res.ok ? res.json() : null)
      .then((data: any) => {
        clearTimeout(timeout);
        if (data?.models) {
          setOllamaModels(data.models.map((m: any) => m.name));
        }
      })
      .catch(() => { clearTimeout(timeout); });
  }, []);

  // Build model list from provider registry + Ollama for /model completions
  const modelChoices = useMemo(() => {
    const choices: { name: string; desc: string }[] = [];
    // Ollama models from live API
    for (const m of ollamaModels) {
      choices.push({ name: `/model ollama/${m}`, desc: "local" });
    }
    // Cloud models from pricing registry
    for (const provider of listProviders()) {
      if (provider.id === "ollama") continue;
      for (const model of provider.pricingEngine.getModels()) {
        choices.push({
          name: `/model ${provider.id}/${model.id}`,
          desc: model.displayName,
        });
      }
    }
    return choices;
  }, [ollamaModels]);

  // Filter matching commands when input starts with /
  // After "/ship " or "/build ", complete with .md files from cwd
  // After "/model ", complete with provider/model names
  const completions = useMemo(() => {
    const shipMatch = value.match(/^\/(ship|build)\s+(.*)/);
    if (shipMatch) {
      const cmd = shipMatch[1];
      const partial = shipMatch[2].toLowerCase();
      try {
        const files = fs.readdirSync(process.cwd())
          .filter(f => f.endsWith(".md") && !f.startsWith("."))
          .sort();
        return files
          .filter(f => f.toLowerCase().startsWith(partial) && f.toLowerCase() !== partial)
          .map(f => ({ name: `/${cmd} ${f}`, desc: "" }));
      } catch { return []; }
    }
    // /model completions — match against provider/model names
    const modelMatch = value.match(/^\/model\s+(.*)/);
    if (modelMatch) {
      const partial = modelMatch[1].toLowerCase();
      if (!partial) return modelChoices.slice(0, 10); // show first 10 if no input yet
      return modelChoices
        .filter(c => c.name.slice("/model ".length).toLowerCase().startsWith(partial))
        .slice(0, 10);
    }
    if (!value.startsWith("/") || value.includes(" ")) return [];
    const query = value.toLowerCase();
    return BUILTIN_COMMANDS.filter((c) => c.name.startsWith(query) && c.name !== query);
  }, [value, modelChoices]);

  const showCompletions = isActive && completions.length > 0;

  useInput(
    (input, key) => {
      if (!isActive) return;

      // Tab: accept completion
      if (key.tab && showCompletions) {
        const selected = completions[completionIndex % completions.length];
        if (selected) {
          const newVal = selected.name + " ";
          setValue(newVal);
          setCursorPos(newVal.length);
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

      // Left/Right arrow: move cursor
      if (key.leftArrow) {
        if (key.ctrl || key.meta) {
          // Jump to previous word boundary
          const before = value.slice(0, cursorPos);
          const match = before.match(/\S+\s*$/);
          setCursorPos(match ? cursorPos - match[0].length : 0);
        } else {
          setCursorPos((p) => Math.max(0, p - 1));
        }
        return;
      }
      if (key.rightArrow) {
        if (key.ctrl || key.meta) {
          // Jump to next word boundary
          const after = value.slice(cursorPos);
          const match = after.match(/^\s*\S+/);
          setCursorPos(match ? cursorPos + match[0].length : value.length);
        } else {
          setCursorPos((p) => Math.min(value.length, p + 1));
        }
        return;
      }

      // Submit
      if (key.return) {
        const trimmed = value.trim();
        if (trimmed) {
          onSubmit(trimmed);
          setValue("");
          setCursorPos(0);
          setHistoryIndex(-1);
          setCompletionIndex(0);
        }
        return;
      }

      // Home / Ctrl+A: beginning of line
      if ((key.ctrl && input === "a")) {
        setCursorPos(0);
        return;
      }
      // End / Ctrl+E: end of line
      if ((key.ctrl && input === "e")) {
        setCursorPos(value.length);
        return;
      }

      // History: up — navigate from most recent to oldest.
      if (key.upArrow) {
        const newIdx = Math.min(historyIndex + 1, history.length - 1);
        if (newIdx >= 0 && history.length > 0) {
          setHistoryIndex(newIdx);
          const hist = history[history.length - 1 - newIdx];
          setValue(hist);
          setCursorPos(hist.length);
        }
        return;
      }

      // History: down — navigate back toward most recent
      if (key.downArrow) {
        const newIdx = historyIndex - 1;
        if (newIdx >= 0 && history.length > 0) {
          setHistoryIndex(newIdx);
          const hist = history[history.length - 1 - newIdx];
          setValue(hist);
          setCursorPos(hist.length);
        } else {
          setHistoryIndex(-1);
          setValue("");
          setCursorPos(0);
        }
        return;
      }

      // Escape: clear completions / clear input
      if (key.escape) {
        if (showCompletions) {
          setCompletionIndex(0);
        }
        return;
      }

      // Backspace: delete character before cursor
      if (key.backspace || key.delete) {
        if (cursorPos > 0) {
          setValue((v) => v.slice(0, cursorPos - 1) + v.slice(cursorPos));
          setCursorPos((p) => p - 1);
        }
        setCompletionIndex(0);
        return;
      }

      // Ctrl+U: clear line
      if (key.ctrl && input === "u") {
        setValue("");
        setCursorPos(0);
        setCompletionIndex(0);
        return;
      }

      // Ctrl+W: delete last word (from cursor position)
      if (key.ctrl && input === "w") {
        const before = value.slice(0, cursorPos);
        const after = value.slice(cursorPos);
        const trimmed = before.replace(/\S+\s*$/, "");
        setValue(trimmed + after);
        setCursorPos(trimmed.length);
        setCompletionIndex(0);
        return;
      }

      // Regular character input (ignore ctrl/meta sequences)
      if (input && !key.ctrl && !key.meta) {
        setValue((v) => v.slice(0, cursorPos) + input + v.slice(cursorPos));
        setCursorPos((p) => p + input.length);
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
      <Text color={theme.text}>{value.slice(0, cursorPos)}</Text>
      {isActive ? (
        <Text inverse>{cursorPos < value.length ? value[cursorPos] : " "}</Text>
      ) : null}
      <Text color={theme.text}>{value.slice(cursorPos + 1)}</Text>
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
