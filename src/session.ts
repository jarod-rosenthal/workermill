import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import * as logger from "./logger.js";
import { getProjectSessionsDir, ensureProjectDirs } from "./project-data.js";

// Sessions stored in project-specific directory
const SESSIONS_DIR = getProjectSessionsDir();

export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface SessionCostModel {
  key: string;       // "provider/model"
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  roles: string[];   // ["worker", "planner", etc.]
}

export interface SessionRoleCost {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface Session {
  id: string;
  name?: string;
  cwd?: string;                     // current working directory or future project identifier
  messages: SessionMessage[];
  provider: string;
  model: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;              // ISO timestamp when session ended cleanly
  totalTokens: number;
  totalCostUsd?: number;            // sum of all cost entries
  costByModel?: SessionCostModel[]; // per-model breakdown from CostTracker
  costByRole?: {                    // worker / planner / reviewer split
    worker: SessionRoleCost;
    planner: SessionRoleCost;
    reviewer: SessionRoleCost;
  };
}

export interface SessionSummary {
  id: string;
  name?: string;
  startedAt: string;
  updatedAt: string;
  messageCount: number;
  totalTokens: number;
  preview: string;
}

function migrateGlobalSessions(): void {
  const oldSessionsDir = path.join(os.homedir(), ".workermill", "sessions");
  if (!fs.existsSync(oldSessionsDir)) return;

  ensureProjectDirs();

  try {
    const files = fs.readdirSync(oldSessionsDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
      try {
        fs.rmdirSync(oldSessionsDir);
      } catch {}
      return;
    }

    let migrated = true;
    for (const file of files) {
      const oldPath = path.join(oldSessionsDir, file);
      const newPath = path.join(SESSIONS_DIR, file);
      if (!fs.existsSync(newPath)) {
        fs.copyFileSync(oldPath, newPath);
        if (fs.readFileSync(oldPath, 'utf-8') !== fs.readFileSync(newPath, 'utf-8')) {
          migrated = false;
          try { fs.unlinkSync(newPath); } catch {}
        }
      }
    }

    if (migrated) {
      for (const file of files) {
        try { fs.unlinkSync(path.join(oldSessionsDir, file)); } catch {}
      }
      try { fs.rmdirSync(oldSessionsDir); } catch {}
    }
  } catch (err) {
    logger.error("Failed to migrate global sessions", { error: err instanceof Error ? err.message : String(err) });
  }
}

function ensureSessionsDir(): void {
  migrateGlobalSessions();
  ensureProjectDirs();
}

export function createSession(provider: string, model: string, cwd?: string): Session {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    messages: [],
    provider,
    model,
    cwd,
    startedAt: now,
    updatedAt: now,
    totalTokens: 0,
  };
}

export function saveSession(session: Session): void {
  ensureSessionsDir();
  session.updatedAt = new Date().toISOString();
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

    const content = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, files[0].name), "utf-8")) as Partial<Session>;
    // Add updatedAt if missing for backwards compatibility
    if (!content.updatedAt) {
      content.updatedAt = content.startedAt || new Date().toISOString();
    }
    return content as Session;
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

export function listSessions(max: number = 20): SessionSummary[] {
  ensureSessionsDir();
  try {
    let files = fs.readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith(".json"))
      .map(f => ({
        name: f,
        mtime: fs.statSync(path.join(SESSIONS_DIR, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    // Only limit if max is a positive number
    if (max > 0) {
      files = files.slice(0, max);
    }

    return files.map(f => {
      const content = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f.name), "utf-8")) as Partial<Session>;
      const firstUserMsg = content.messages?.find(m => m.role === "user");
      // Use updatedAt if present, otherwise fall back to startedAt for backwards compatibility
      const startedAt = content.startedAt || new Date().toISOString();
      const updatedAt = content.updatedAt || startedAt;
      return {
        id: content.id || "",
        name: content.name,
        startedAt: startedAt,
        updatedAt: updatedAt,
        messageCount: content.messages?.length || 0,
        totalTokens: content.totalTokens || 0,
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
      const content = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<Session>;
      // Add updatedAt if missing for backwards compatibility
      if (!content.updatedAt) {
        content.updatedAt = content.startedAt || new Date().toISOString();
      }
      return content as Session;
    }
    // Try partial ID match
    const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.startsWith(id));
    if (files.length === 1) {
      const content = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, files[0]), "utf-8")) as Partial<Session>;
      // Add updatedAt if missing for backwards compatibility
      if (!content.updatedAt) {
        content.updatedAt = content.startedAt || new Date().toISOString();
      }
      return content as Session;
    }
  } catch (err) {
    logger.debug("Failed to load session by id", { id, error: err instanceof Error ? err.message : String(err) });
  }
  return null;
}

export function forkSession(session: Session): Session {
  const now = new Date().toISOString();
  return {
    ...session,
    id: crypto.randomUUID(),
    name: session.name ? `${session.name} (fork)` : "fork",
    messages: session.messages.map(m => ({ ...m })),
    startedAt: now,
    updatedAt: now,
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
