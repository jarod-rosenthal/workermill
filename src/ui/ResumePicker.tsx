import React, { useState } from "react";
import { Box, Text, render, useInput } from "ink";
import type { SessionSummary } from "../session.js";

const oneLine = (text: string) => text.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").slice(0, 90);

export function ResumePicker({ sessions, onSelect }: { sessions: SessionSummary[]; onSelect: (id?: string) => void }): React.ReactElement {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const matches = sessions.filter((session) => `${session.name ?? ""} ${session.preview} ${session.id}`.toLowerCase().includes(query.toLowerCase()));
  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === "c")) return onSelect();
    if (key.return) { if (matches[index]) onSelect(matches[index].id); return; }
    if (key.upArrow) { setIndex(Math.max(0, index - 1)); return; }
    if (key.downArrow) { setIndex(Math.min(Math.max(0, matches.length - 1), index + 1)); return; }
    if (key.backspace || key.delete) { setQuery(query.slice(0, -1)); setIndex(0); return; }
    if (!key.ctrl && !key.meta && input) { setQuery(query + input); setIndex(0); }
  });
  const offset = Math.max(0, index - 7);
  return <Box flexDirection="column">
    <Text bold>Resume a conversation</Text>
    <Text dimColor>Current directory · Type to search · ↑/↓ select · Enter resume · Esc cancel</Text>
    <Text>Search: {oneLine(query)}</Text>
    {matches.slice(offset, offset + 8).map((session, row) => <Text key={session.id} color={offset + row === index ? "cyan" : undefined}>
      {offset + row === index ? "❯ " : "  "}{oneLine(session.name || session.preview)} · {session.id.slice(0, 8)} · {session.messageCount} messages · {oneLine(session.updatedAt)}
    </Text>)}
    {!matches.length && <Text>No matching conversations.</Text>}
  </Box>;
}

export async function pickResumeSession(sessions: SessionSummary[]): Promise<string | undefined> {
  let selected: string | undefined;
  const app = render(<ResumePicker sessions={sessions} onSelect={(id) => { selected = id; app.unmount(); }} />, { exitOnCtrlC: false });
  await app.waitUntilExit();
  return selected;
}
