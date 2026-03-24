import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "./theme.js";

interface InputProps {
  /** Called when the user presses Enter with a non-empty value. */
  onSubmit: (value: string) => void;
  /** When false, the input ignores all keystrokes (agent is running). */
  isActive: boolean;
  /** Past inputs for up/down arrow history navigation, newest first. */
  history: string[];
}

/**
 * User text input component with history support.
 * Uses the brand diamond when active, dim hollow diamond when inactive.
 */
export function Input({ onSubmit, isActive, history }: InputProps): React.ReactElement {
  const [value, setValue] = useState("");
  const [historyIndex, setHistoryIndex] = useState(-1);

  useInput(
    (input, key) => {
      if (!isActive) return;

      // Submit
      if (key.return) {
        const trimmed = value.trim();
        if (trimmed) {
          onSubmit(trimmed);
          setValue("");
          setHistoryIndex(-1);
        }
        return;
      }

      // History: up
      if (key.upArrow) {
        const newIdx = Math.min(historyIndex + 1, history.length - 1);
        if (newIdx >= 0 && history[newIdx]) {
          setHistoryIndex(newIdx);
          setValue(history[newIdx]);
        }
        return;
      }

      // History: down
      if (key.downArrow) {
        const newIdx = historyIndex - 1;
        setHistoryIndex(newIdx);
        if (newIdx >= 0 && history[newIdx]) {
          setValue(history[newIdx]);
        } else {
          setValue("");
        }
        return;
      }

      // Backspace / delete
      if (key.backspace || key.delete) {
        setValue((v) => v.slice(0, -1));
        return;
      }

      // Ctrl+U: clear line
      if (key.ctrl && input === "u") {
        setValue("");
        return;
      }

      // Ctrl+W: delete last word
      if (key.ctrl && input === "w") {
        setValue((v) => v.replace(/\S+\s*$/, ""));
        return;
      }

      // Regular character input (ignore ctrl/meta sequences)
      if (input && !key.ctrl && !key.meta) {
        setValue((v) => v + input);
      }
    },
    { isActive },
  );

  return (
    <Box>
      <Text color={isActive ? theme.brand : theme.inactive} bold>
        {isActive ? "\u25C6 " : "\u25C7 "}
      </Text>
      <Text color={theme.text}>{value}</Text>
      {isActive && <Text inverse>{" "}</Text>}
    </Box>
  );
}
