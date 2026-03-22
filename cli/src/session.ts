import fs from "fs";
import path from "path";
import crypto from "crypto";

const SESSIONS_DIR = path.join(process.cwd(), ".workermill", "sessions");

export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface Session {
  id: string;
  messages: SessionMessage[];
  provider: string;
  model: string;
  startedAt: string;
  totalTokens: number;
}

function ensureSessionsDir(): void {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

export function createSession(provider: string, model: string): Session {
  return {
    id: crypto.randomUUID(),
    messages: [],
    provider,
    model,
    startedAt: new Date().toISOString(),
    totalTokens: 0,
  };
}

export function saveSession(session: Session): void {
  ensureSessionsDir();
  const filePath = path.join(SESSIONS_DIR, `${session.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2), "utf-8");
}

export function loadLatestSession(): Session | null {
  ensureSessionsDir();
  try {
    const files = fs.readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith(".json"))
      .map(f => ({
        name: f,
        mtime: fs.statSync(path.join(SESSIONS_DIR, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) return null;

    const content = fs.readFileSync(path.join(SESSIONS_DIR, files[0].name), "utf-8");
    return JSON.parse(content) as Session;
  } catch {
    return null;
  }
}

export function addMessage(session: Session, role: "user" | "assistant", content: string): void {
  session.messages.push({
    role,
    content,
    timestamp: new Date().toISOString(),
  });
}
