import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getStateRoot } from "./state-root.js";
import * as logger from "./logger.js";
import { getProjectSessionsDir, ensureProjectDirs } from "./project-data.js";
import { classifyRole, type LedgerSnapshot } from "./cost-tracker.js";

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
  roles: string[];   // ["worker", "planner", "reviewer"]
}

export interface SessionCostByRole {
  worker: { inputTokens: number; outputTokens: number; costUsd: number };
  planner: { inputTokens: number; outputTokens: number; costUsd: number };
  reviewer: { inputTokens: number; outputTokens: number; costUsd: number };
}

export interface Session {
  id: string;
  name?: string;
  cwd?: string;                     // Current working directory or project identifier
  messages: SessionMessage[];
  provider: string;
  model: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;              // ISO timestamp when session ended cleanly
  totalTokens: number;
  totalCostUsd?: number;            // Sum of all cost entries
  costByModel?: SessionCostModel[]; // Per-model breakdown
  costByRole?: SessionCostByRole;   // Worker / planner / reviewer split
  /** Per-call observations accumulated across completed headless runs. */
  usageLedger?: LedgerSnapshot;
  /** Older totals predate call-level observations, so model/role splits are partial. */
  usageLedgerHistoryIncomplete?: boolean;
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

/** Append only newly observed calls. Replayed callbacks retain the first entry. */
export function appendUsageLedger(
  previous: LedgerSnapshot | undefined,
  next: LedgerSnapshot,
): LedgerSnapshot {
  const calls = [...(previous?.calls ?? [])];
  const callIds = new Set(calls.map((call) => call.callId));
  for (const call of next.calls) {
    if (!callIds.has(call.callId)) {
      calls.push(call);
      callIds.add(call.callId);
    }
  }
  const totals = {
    callCount: calls.length, reportedUsageCalls: 0, partialUsageCalls: 0, missingUsageCalls: 0,
    knownPricingCalls: 0, unknownPricingCalls: 0, localApiCalls: 0,
    inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedApiCost: 0,
  };
  for (const call of calls) {
    if (call.usageState === "reported") totals.reportedUsageCalls++;
    else if (call.usageState === "partial") totals.partialUsageCalls++;
    else totals.missingUsageCalls++;
    if (call.pricingState === "known") totals.knownPricingCalls++;
    else if (call.pricingState === "local") totals.localApiCalls++;
    else totals.unknownPricingCalls++;
    totals.inputTokens += call.usage?.inputTokens ?? 0;
    totals.outputTokens += call.usage?.outputTokens ?? 0;
    totals.cacheCreationTokens += call.usage?.cacheCreationTokens ?? 0;
    totals.cacheReadTokens += call.usage?.cacheReadTokens ?? 0;
    totals.estimatedApiCost += call.estimatedApiCost ?? 0;
  }
  return { calls, totals };
}

/**
 * Merge a cumulative callback into a session. Calls are immutable observations:
 * the first call ID wins, and saved estimates are never recalculated.
 */
export function applySessionUsageLedger(session: Session, ledger: LedgerSnapshot): boolean {
  const hadLedger = session.usageLedger;
  const hadHistoricalTotals = session.totalTokens > 0 || (session.totalCostUsd ?? 0) > 0;
  if ((!hadLedger && hadHistoricalTotals) || (hadLedger && (
    session.totalTokens > hadLedger.totals.inputTokens + hadLedger.totals.outputTokens
    || (session.totalCostUsd ?? 0) > hadLedger.totals.estimatedApiCost + 1e-12
  ))) session.usageLedgerHistoryIncomplete = true;
  const existing = new Set(hadLedger?.calls.map((call) => call.callId) ?? []);
  const newCalls = ledger.calls.filter((call) => {
    if (existing.has(call.callId)) return false;
    existing.add(call.callId);
    return true;
  });
  if (!newCalls.length) return false;

  session.usageLedger = appendUsageLedger(hadLedger, ledger);
  const models = session.costByModel ? [...session.costByModel] : [];
  const roles = session.costByRole ?? {
    worker: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    planner: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    reviewer: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  };
  for (const call of newCalls) {
    const inputTokens = call.usage?.inputTokens ?? 0;
    const outputTokens = call.usage?.outputTokens ?? 0;
    const costUsd = call.estimatedApiCost ?? 0;
    session.totalTokens += inputTokens + outputTokens;
    session.totalCostUsd = (session.totalCostUsd ?? 0) + costUsd;
    const role = classifyRole(call.persona);
    roles[role].inputTokens += inputTokens;
    roles[role].outputTokens += outputTokens;
    roles[role].costUsd += costUsd;
    const key = `${call.provider}/${call.model}`;
    const model = models.find((entry) => entry.key === key);
    if (model) {
      model.inputTokens += inputTokens;
      model.outputTokens += outputTokens;
      model.costUsd += costUsd;
      if (!model.roles.includes(role)) model.roles.push(role);
    } else {
      models.push({ key, provider: call.provider, model: call.model, inputTokens, outputTokens, costUsd, roles: [role] });
    }
  }
  session.costByModel = models;
  session.costByRole = roles;
  return true;
}

function migrateGlobalSessions(): void {
  const oldSessionsDir = path.join(getStateRoot(), "sessions");
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
    cwd,
    provider,
    model,
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
