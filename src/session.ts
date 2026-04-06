import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import * as logger from "./logger.js";

// Sessions stored in ~/.workermill/sessions/ (global, not per-project)
const SESSIONS_DIR = path.join(os.homedir(), ".workermill", "sessions");

export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface Session {
  id: string;
  name?: string;
  messages: SessionMessage[];
  provider: string;
  model: string;
  startedAt: string;
  totalTokens: number;
}

export interface SessionSummary {
  id: string;
  name?: string;
  startedAt: string;
  messageCount: number;
  totalTokens: number;
  preview: string;
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
  } catch (err) {
    logger.error("Failed to load latest session", { error: err instanceof Error ? err.message : String(err) });
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

export function listSessions(max = 20): SessionSummary[] {
  ensureSessionsDir();
  try {
    const files = fs.readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith(".json"))
      .map(f => ({
        name: f,
        mtime: fs.statSync(path.join(SESSIONS_DIR, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, max);

    return files.map(f => {
      const content = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f.name), "utf-8")) as Session;
      const firstUserMsg = content.messages.find(m => m.role === "user");
      return {
        id: content.id,
        name: content.name,
        startedAt: content.startedAt,
        messageCount: content.messages.length,
        totalTokens: content.totalTokens,
        preview: firstUserMsg ? firstUserMsg.content.slice(0, 50) : "(empty)",
      };
    });
  } catch (err) {
    logger.error("Failed to list sessions", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

export function loadSessionById(id: string): Session | null {
  ensureSessionsDir();
  try {
    const filePath = path.join(SESSIONS_DIR, `${id}.json`);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Session;
    }
    // Try partial ID match
    const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.startsWith(id));
    if (files.length === 1) {
      return JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, files[0]), "utf-8")) as Session;
    }
  } catch (err) {
    logger.debug("Failed to load session by id", { id, error: err instanceof Error ? err.message : String(err) });
  }
  return null;
}

export function forkSession(session: Session): Session {
  return {
    ...session,
    id: crypto.randomUUID(),
    name: session.name ? `${session.name} (fork)` : "fork",
    messages: session.messages.map(m => ({ ...m })),
    startedAt: new Date().toISOString(),
  };
}

export function deleteSession(id: string): boolean {
  ensureSessionsDir();
  try {
    const filePath = path.join(SESSIONS_DIR, `${id}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch (err) {
    logger.debug("Failed to delete session", { id, error: err instanceof Error ? err.message : String(err) });
  }
  return false;
}
