import { listSessions, loadSessionById, type Session, type SessionSummary } from "./session.js";

export function resumableSessions(): SessionSummary[] {
  return listSessions(0).filter((session) => /^[a-zA-Z0-9_-]+$/.test(session.id));
}

export function resolveResumeSession(id: string | undefined, last: boolean): Session {
  if (id && last) throw new Error("Choose a session ID or --last, not both.");
  const sessions = resumableSessions();
  if (!sessions.length) throw new Error("No saved conversations in this directory.");
  let selected: SessionSummary | undefined;
  if (last) selected = sessions[0];
  else {
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Provide a valid session ID or unique prefix.");
    selected = sessions.find((session) => session.id === id);
    if (!selected) {
      const matches = sessions.filter((session) => session.id.startsWith(id));
      if (matches.length > 1) throw new Error(`Ambiguous session prefix "${id}". Use a longer ID from wm session list.`);
      selected = matches[0];
    }
  }
  if (!selected) throw new Error(`Session "${id}" was not found in this directory.`);
  const session = loadSessionById(selected.id);
  if (!session || session.id !== selected.id || !Array.isArray(session.messages)
    || session.messages.some((message) => !message || !["user", "assistant"].includes(message.role) || typeof message.content !== "string")) {
    throw new Error(`Session "${selected.id}" is unreadable or invalid.`);
  }
  return session;
}
