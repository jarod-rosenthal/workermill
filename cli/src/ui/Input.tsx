import React, { useState, useMemo, useEffect, useRef } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import fs from "fs";
import { theme } from "./theme.js";
import { listProviders } from "../provider-registry.js";
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
  { name: "/model", desc: "Switch worker, planner, or reviewer model" },
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
  const { stdout } = useStdout();
  const [value, setValue] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(true);
  const valueRef = useRef(value);
  const cursorPosRef = useRef(cursorPos);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    cursorPosRef.current = cursorPos;
  }, [cursorPos]);

  // Blink cursor while input is active so the caret is visible before typing.
  useEffect(() => {
    if (!isActive) {
      setCursorVisible(true);
      return;
    }
    const id = setInterval(() => {
      setCursorVisible((v) => !v);
    }, 650);
    return () => clearInterval(id);
  }, [isActive]);

  // Fetch Ollama models once on mount (async)
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [lmStudioModels, setLmStudioModels] = useState<string[]>([]);
  useEffect(() => {
    const config = resolveConfig();
    // Ollama
    const ollamaHost = config?.providers?.ollama?.host || "http://localhost:11434";
    const ollamaCtrl = new AbortController();
    const ollamaTimeout = setTimeout(() => ollamaCtrl.abort(), 3000);
    globalThis.fetch(`${ollamaHost}/api/tags`, { signal: ollamaCtrl.signal })
      .then(res => res.ok ? res.json() : null)
      .then((data: any) => {
        clearTimeout(ollamaTimeout);
        if (data?.models) {
          setOllamaModels(data.models.map((m: any) => m.name));
        }
      })
      .catch(() => { clearTimeout(ollamaTimeout); });
    // LM Studio
    const lmHost = config?.providers?.lmstudio?.host?.replace(/\/v1\/?$/, "") || "http://localhost:1234";
    const lmCtrl = new AbortController();
    const lmTimeout = setTimeout(() => lmCtrl.abort(), 3000);
    globalThis.fetch(`${lmHost}/v1/models`, { signal: lmCtrl.signal })
      .then(res => res.ok ? res.json() : null)
      .then((data: any) => {
        clearTimeout(lmTimeout);
        if (data?.data) {
          setLmStudioModels(data.data.map((m: any) => m.id));
        }
      })
      .catch(() => { clearTimeout(lmTimeout); });
  }, []);

  // Build model list from provider registry + Ollama + LM Studio for /model completions
  const modelChoices = useMemo(() => {
    const choices: { name: string; desc: string }[] = [];
    // Ollama models from live API
    for (const m of ollamaModels) {
      choices.push({ name: `/model ollama/${m}`, desc: "local" });
    }
    // LM Studio models from live API
    for (const m of lmStudioModels) {
      choices.push({ name: `/model lmstudio/${m}`, desc: "local" });
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
  }, [ollamaModels, lmStudioModels]);

  // Filter matching commands when input starts with /
  // After "/ship " or "/build ", complete with .md files from cwd
  // After "/model ", complete with provider/model names
  const completions = useMemo(() => {
    const shipMatch = value.match(/^\/(ship|build|retry)\s+(.*)/);
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
    // Supports: /model <provider/model>, /model planner <provider/model>, /model reviewer <provider/model>
    const modelMatch = value.match(/^\/model\s+(.*)/);
    if (modelMatch) {
      const partial = modelMatch[1].toLowerCase();
      // Check for role prefix
      const roleMatch = partial.match(/^(planner|reviewer)\s+(.*)/);
      if (roleMatch) {
        const role = roleMatch[1];
        const modelPartial = roleMatch[2];
        if (!modelPartial) return modelChoices.map(c => ({ ...c, name: `/model ${role} ${c.name.slice("/model ".length)}` })).slice(0, 10);
        return modelChoices
          .filter(c => c.name.slice("/model ".length).toLowerCase().startsWith(modelPartial))
          .map(c => ({ ...c, name: `/model ${role} ${c.name.slice("/model ".length)}` }))
          .slice(0, 10);
      }
      if (!partial) {
        // Show role options + first few models
        return [
          { name: "/model planner", desc: "Switch planner model" },
          { name: "/model reviewer", desc: "Switch reviewer model" },
          ...modelChoices.slice(0, 8),
        ];
      }
      if ("planner".startsWith(partial)) {
        return [{ name: "/model planner", desc: "Switch planner model" }, ...modelChoices.filter(c => c.name.slice("/model ".length).toLowerCase().startsWith(partial)).slice(0, 8)];
      }
      if ("reviewer".startsWith(partial)) {
        return [{ name: "/model reviewer", desc: "Switch reviewer model" }, ...modelChoices.filter(c => c.name.slice("/model ".length).toLowerCase().startsWith(partial)).slice(0, 8)];
      }
      return modelChoices
        .filter(c => c.name.slice("/model ".length).toLowerCase().startsWith(partial))
        .slice(0, 10);
    }
    if (!value.startsWith("/") || value.includes(" ")) return [];
    const query = value.toLowerCase();
    return BUILTIN_COMMANDS.filter((c) => c.name.startsWith(query) && c.name !== query);
  }, [value, modelChoices]);

  const showCompletions = isActive && completions.length > 0;
  const insertNewlineAtCursor = () => {
    const currentValue = valueRef.current;
    const currentCursorPos = cursorPosRef.current;
    const nextValue = currentValue.slice(0, currentCursorPos) + "\n" + currentValue.slice(currentCursorPos);
    const nextCursorPos = currentCursorPos + 1;
    valueRef.current = nextValue;
    cursorPosRef.current = nextCursorPos;
    setValue(nextValue);
    setCursorPos(nextCursorPos);
    setCompletionIndex(0);
  };

  useInput(
    (input, key) => {
      if (!isActive) return;

      // Tab: accept completion
      if (key.tab && showCompletions) {
        const selected = completions[completionIndex % completions.length];
        if (selected) {
          const newVal = selected.name + " ";
          valueRef.current = newVal;
          cursorPosRef.current = newVal.length;
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
        const currentValue = valueRef.current;
        const currentCursorPos = cursorPosRef.current;
        if (key.ctrl || key.meta) {
          // Jump to previous word boundary
          const before = currentValue.slice(0, currentCursorPos);
          const match = before.match(/\S+\s*$/);
          const nextCursorPos = match ? currentCursorPos - match[0].length : 0;
          cursorPosRef.current = nextCursorPos;
          setCursorPos(nextCursorPos);
        } else {
          setCursorPos((p) => {
            const nextCursorPos = Math.max(0, p - 1);
            cursorPosRef.current = nextCursorPos;
            return nextCursorPos;
          });
        }
        return;
      }
      if (key.rightArrow) {
        const currentValue = valueRef.current;
        const currentCursorPos = cursorPosRef.current;
        if (key.ctrl || key.meta) {
          // Jump to next word boundary
          const after = currentValue.slice(currentCursorPos);
          const match = after.match(/^\s*\S+/);
          const nextCursorPos = match ? currentCursorPos + match[0].length : currentValue.length;
          cursorPosRef.current = nextCursorPos;
          setCursorPos(nextCursorPos);
        } else {
          setCursorPos((p) => {
            const nextCursorPos = Math.min(valueRef.current.length, p + 1);
            cursorPosRef.current = nextCursorPos;
            return nextCursorPos;
          });
        }
        return;
      }

      // Newline insert:
      // - Shift+Enter
      // Keep plain Enter as submit even if some terminals set key.meta=true.
      const isShiftEnter = key.return && key.shift;
      if (isShiftEnter) {
        insertNewlineAtCursor();
        return;
      }

      // Submit on Enter.
      if (key.return) {
        const trimmed = valueRef.current.trim();
        if (trimmed) {
          onSubmit(trimmed.replace(/\r\n?/g, "\n"));
          valueRef.current = "";
          cursorPosRef.current = 0;
          setValue("");
          setCursorPos(0);
          setHistoryIndex(-1);
          setCompletionIndex(0);
        }
        return;
      }

      // Home / Ctrl+A: beginning of line
      if ((key.ctrl && input === "a")) {
        cursorPosRef.current = 0;
        setCursorPos(0);
        return;
      }
      // End / Ctrl+E: end of line
      if ((key.ctrl && input === "e")) {
        const nextCursorPos = valueRef.current.length;
        cursorPosRef.current = nextCursorPos;
        setCursorPos(nextCursorPos);
        return;
      }

      // History: up — navigate from most recent to oldest.
      if (key.upArrow) {
        // Multiline: move cursor up one line if possible, otherwise navigate history
        const currentValue = valueRef.current;
        const currentCursorPos = cursorPosRef.current;
        const lineStart = currentValue.lastIndexOf("\n", currentCursorPos - 1) + 1;
        if (lineStart > 0) {
          // There's a previous line — move cursor up
          const col = currentCursorPos - lineStart;
          const prevLineStart = currentValue.lastIndexOf("\n", lineStart - 2) + 1;
          const prevLineLen = lineStart - 1 - prevLineStart;
          const nextCursorPos = prevLineStart + Math.min(col, prevLineLen);
          cursorPosRef.current = nextCursorPos;
          setCursorPos(nextCursorPos);
          return;
        }
        // At top line — navigate history
        const newIdx = Math.min(historyIndex + 1, history.length - 1);
        if (newIdx >= 0 && history.length > 0) {
          setHistoryIndex(newIdx);
          const hist = history[history.length - 1 - newIdx];
          valueRef.current = hist;
          cursorPosRef.current = hist.length;
          setValue(hist);
          setCursorPos(hist.length);
        }
        return;
      }

      // History: down — navigate back toward most recent
      if (key.downArrow) {
        // Multiline: move cursor down one line if possible, otherwise navigate history
        const currentValue = valueRef.current;
        const currentCursorPos = cursorPosRef.current;
        const nextNewline = currentValue.indexOf("\n", currentCursorPos);
        if (nextNewline !== -1) {
          // There's a next line — move cursor down
          const lineStart = currentValue.lastIndexOf("\n", currentCursorPos - 1) + 1;
          const col = currentCursorPos - lineStart;
          const nextLineStart = nextNewline + 1;
          const nextLineEnd = currentValue.indexOf("\n", nextLineStart);
          const nextLineLen = (nextLineEnd === -1 ? currentValue.length : nextLineEnd) - nextLineStart;
          const nextCursorPos = nextLineStart + Math.min(col, nextLineLen);
          cursorPosRef.current = nextCursorPos;
          setCursorPos(nextCursorPos);
          return;
        }
        // At bottom line — navigate history
        const newIdx = historyIndex - 1;
        if (newIdx >= 0 && history.length > 0) {
          setHistoryIndex(newIdx);
          const hist = history[history.length - 1 - newIdx];
          valueRef.current = hist;
          cursorPosRef.current = hist.length;
          setValue(hist);
          setCursorPos(hist.length);
        } else {
          setHistoryIndex(-1);
          valueRef.current = "";
          cursorPosRef.current = 0;
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
        const currentValue = valueRef.current;
        const currentCursorPos = cursorPosRef.current;
        if (currentCursorPos > 0) {
          const nextValue = currentValue.slice(0, currentCursorPos - 1) + currentValue.slice(currentCursorPos);
          const nextCursorPos = currentCursorPos - 1;
          valueRef.current = nextValue;
          cursorPosRef.current = nextCursorPos;
          setValue(nextValue);
          setCursorPos(nextCursorPos);
        }
        setCompletionIndex(0);
        return;
      }

      // Ctrl+U: clear line
      if (key.ctrl && input === "u") {
        valueRef.current = "";
        cursorPosRef.current = 0;
        setValue("");
        setCursorPos(0);
        setCompletionIndex(0);
        return;
      }

      // Ctrl+W: delete last word (from cursor position)
      if (key.ctrl && input === "w") {
        const currentValue = valueRef.current;
        const currentCursorPos = cursorPosRef.current;
        const before = currentValue.slice(0, currentCursorPos);
        const after = currentValue.slice(currentCursorPos);
        const trimmed = before.replace(/\S+\s*$/, "");
        const nextValue = trimmed + after;
        const nextCursorPos = trimmed.length;
        valueRef.current = nextValue;
        cursorPosRef.current = nextCursorPos;
        setValue(nextValue);
        setCursorPos(nextCursorPos);
        setCompletionIndex(0);
        return;
      }

      // Regular character input (ignore ctrl/meta sequences)
      if (input && !key.ctrl && !key.meta) {
        const currentValue = valueRef.current;
        const currentCursorPos = cursorPosRef.current;
        const normalizedInput = input.replace(/\r\n?/g, "\n");
        const nextValue = currentValue.slice(0, currentCursorPos) + normalizedInput + currentValue.slice(currentCursorPos);
        const nextCursorPos = currentCursorPos + normalizedInput.length;
        valueRef.current = nextValue;
        cursorPosRef.current = nextCursorPos;
        setValue(nextValue);
        setCursorPos(nextCursorPos);
        setCompletionIndex(0);
      }
    },
    { isActive },
  );

  // Inline hint: show the best match after the cursor, no height change
  const hint = showCompletions && completions.length > 0
    ? completions[completionIndex % completions.length]
    : null;

  // Render width for the input content area (excluding 2-char prompt prefix).
  const contentWidth = Math.max(10, (stdout?.columns ?? 80) - 2);
  const isMultiline = value.includes("\n");
  const isSoftWrappedSingleLine = !isMultiline && value.length > contentWidth;

  if (!isMultiline && !isSoftWrappedSingleLine) {
    return (
      <Box>
        <Text color={isActive ? theme.brand : theme.inactive} bold>
          {isActive ? "\u25C6 " : "\u25C7 "}
        </Text>
        <Text color={theme.text}>{value.slice(0, cursorPos)}</Text>
                {isActive ? (
                  cursorVisible ? (
                    <Text color={theme.inactive}>{cursorPos < value.length ? value[cursorPos] : "▏"}</Text>
                  ) : (
                    <Text color={theme.text}>{cursorPos < value.length ? value[cursorPos] : " "}</Text>
                  )
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

  // Wrapped multiline render (explicit newlines + soft wraps) with an accurate cursor.
  const lines: string[] = [""];
  let lineIndex = 0;
  let col = 0;
  let cursorLine = 0;
  let cursorCol = 0;
  for (let i = 0; i <= value.length; i++) {
    if (i === cursorPos) {
      cursorLine = lineIndex;
      cursorCol = col;
    }
    if (i === value.length) break;
    const ch = value[i];
    if (ch === "\n") {
      lines.push("");
      lineIndex++;
      col = 0;
      continue;
    }
    lines[lineIndex] += ch;
    col++;
    if (col >= contentWidth) {
      lines.push("");
      lineIndex++;
      col = 0;
    }
  }



  return (
    <Box flexDirection="column">
      {lines.map((line, idx) => {
        const isFirst = idx === 0;
        const isCursorLine = idx === cursorLine;
        return (
          <Box key={idx}>
            <Text color={isActive ? theme.brand : theme.inactive} bold>
              {isFirst ? (isActive ? "\u25C6 " : "\u25C7 ") : "  "}
            </Text>
            {isCursorLine ? (
              <>
                <Text color={theme.text}>{line.slice(0, cursorCol)}</Text>
                {isActive ? (
                  cursorVisible ? (
                    <Text color={theme.inactive}>{cursorCol < line.length ? line[cursorCol] : "▏"}</Text>
                  ) : (
                    <Text color={theme.text}>{cursorCol < line.length ? line[cursorCol] : " "}</Text>
                  )
                ) : null}
                <Text color={theme.text}>{line.slice(cursorCol + 1)}</Text>
              </>
            ) : (
              <Text color={theme.text}>{line || " "}</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
