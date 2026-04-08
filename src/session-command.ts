import fs from "fs";
import path from "path";
import chalk from "chalk";
import { listSessions, loadSessionById, deleteSession, saveSession, type Session, type SessionSummary } from "./session.js";
import { getProjectSessionsDir } from "./project-data.js";

/**
 * Session CLI command handlers
 * 
 * Provides machine-readable JSON output alongside human-friendly output.
 * Handles ID resolution with full ID or unique prefix support.
 */

// ── Internal helpers ──

/** Session directory for file-based operations */
function getSessionsDir(): string {
  return getProjectSessionsDir();
}

/**
 * Resolve a session ID by full ID or unique prefix.
 * 
 * @param idOrPrefix - Full session ID or unique prefix
 * @returns Session ID if found uniquely, null if not found, throws if ambiguous
 */
function resolveSessionId(idOrPrefix: string): string | null {
  const sessionsDir = getSessionsDir();
  if (!fs.existsSync(sessionsDir)) {
    return null;
  }

  const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith(".json"));
  
  // Try exact match first
  const exactMatch = files.find(f => f === `${idOrPrefix}.json`);
  if (exactMatch) {
    return idOrPrefix;
  }

  // Try prefix match
  const prefixMatches = files.filter(f => f.startsWith(idOrPrefix));
  
  if (prefixMatches.length === 0) {
    return null;
  }
  
  if (prefixMatches.length > 1) {
    // Ambiguous - list conflicting sessions
    const ids = prefixMatches.map(f => f.replace(/\.json$/, ""));
    throw new AmbiguousSessionError(idOrPrefix, ids);
  }
  
  return prefixMatches[0].replace(/\.json$/, "");
}

/**
 * Error class for ambiguous session ID resolution
 */
export class AmbiguousSessionError extends Error {
  constructor(
    public readonly prefix: string,
    public readonly matchingIds: string[]
  ) {
    super(`Session ID prefix "${prefix}" matches ${matchingIds.length} sessions: ${matchingIds.map(id => chalk.cyan(id)).join(", ")}`);
    this.name = "AmbiguousSessionError";
  }
}

/**
 * Format a SessionSummary for JSON output
 */
function formatSessionSummary(summary: SessionSummary): object {
  return {
    id: summary.id,
    name: summary.name,
    messageCount: summary.messageCount,
    totalTokens: summary.totalTokens,
    startedAt: summary.startedAt,
    updatedAt: summary.updatedAt,
    preview: summary.preview,
  };
}

/**
 * Format a Session for JSON output (full details)
 */
function formatSession(session: Session): object {
  return {
    id: session.id,
    name: session.name,
    messages: session.messages.map(m => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
    })),
    provider: session.provider,
    model: session.model,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    totalTokens: session.totalTokens,
    messageCount: session.messages.length,
  };
}

// ── Subcommand handlers ──

/**
 * List all sessions
 */
export function handleSessionList(options: { json?: boolean }): void {
  const sessions = listSessions(-1); // List all sessions (-1 means no limit)

  if (options.json) {
    console.log(JSON.stringify(sessions.map(formatSessionSummary), null, 2));
    process.exit(0);
  }

  if (sessions.length === 0) {
    console.log("No sessions found");
    process.exit(0);
  }

  // Human-readable table output
  const idWidth = Math.max(10, ...sessions.map(s => s.id.length));
  const dateWidth = Math.max(16, ...sessions.map(s => s.startedAt.slice(0, 16).replace("T", " ").length));
  
  console.log();
  console.log(chalk.bold(`  ID (${chalk.dim("prefix is OK")})  ${chalk.bold("Started".padStart(dateWidth))}  ${chalk.bold("Msgs")}  ${chalk.bold("Name")}`));
  console.log("  " + "-".repeat(idWidth) + "  " + "-".repeat(dateWidth) + "  ----  " + "-".repeat(40));
  
  for (const session of sessions) {
    const id = session.id.slice(0, 8);
    const date = session.startedAt.slice(0, 16).replace("T", " ");
    const name = session.name || session.preview;
    console.log(
      `  ${chalk.cyan(id).padEnd(idWidth + 2)}  ${date.padStart(dateWidth)}  ${chalk.dim(String(session.messageCount).padStart(4))}  ${chalk.reset(name.slice(0, 40))}`
    );
  }
  console.log();
  console.log(chalk.dim(`  ${sessions.length} session(s) found`));
  console.log();
}

/**
 * Show a session by ID or prefix
 */
export function handleSessionShow(idOrPrefix: string, options: { json?: boolean }): void {
  let sessionId: string | null;
  
  try {
    sessionId = resolveSessionId(idOrPrefix);
  } catch (error) {
    if (error instanceof AmbiguousSessionError) {
      console.error(error.message);
      process.exit(2);
    }
    throw error;
  }
  
  if (!sessionId) {
    console.error(`Error: Session "${idOrPrefix}" not found`);
    process.exit(1);
  }

  const session = loadSessionById(sessionId);
  if (!session) {
    console.error(`Error: Could not load session "${sessionId}"`);
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(formatSession(session), null, 2));
    process.exit(0);
  }

  // Human-readable output
  console.log();
  console.log(chalk.bold(`  Session: ${chalk.cyan(session.id.slice(0, 8))}`));
  if (session.name) {
    console.log(chalk.bold(`  Name: ${session.name}`));
  }
  console.log(`  Provider: ${session.provider}`);
  console.log(`  Model: ${session.model}`);
  console.log(`  Started: ${session.startedAt.slice(0, 16).replace("T", " ")}`);
  console.log(`  Messages: ${session.messages.length}`);
  console.log(`  Tokens: ${session.totalTokens}`);
  console.log();
  console.log(chalk.bold("  Messages:"));
  console.log("  " + "─".repeat(60));
  
  for (const msg of session.messages.slice(0, 5)) {
    const role = msg.role === "user" ? chalk.blue("USER") : chalk.green("ASSISTANT");
    const preview = msg.content.slice(0, 100);
    console.log(`  ${role}: ${preview}${msg.content.length > 100 ? "..." : ""}`);
  }
  
  if (session.messages.length > 5) {
    console.log(chalk.dim(`  ... and ${session.messages.length - 5} more messages`));
  }
  
  console.log();
}

/**
 * Show the most recent session
 */
export function handleSessionLast(options: { json?: boolean }): void {
  const sessions = listSessions(1);
  
  if (sessions.length === 0) {
    if (options.json) {
      console.log(JSON.stringify(null));
      process.exit(0);
    }
    console.log("No sessions found");
    process.exit(1);
  }

  const session = loadSessionById(sessions[0].id);
  if (!session) {
    console.error("Error: Could not load last session");
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(formatSession(session), null, 2));
    process.exit(0);
  }

  // Human-readable output
  console.log();
  console.log(chalk.bold(`  Last Session: ${chalk.cyan(session.id.slice(0, 8))}`));
  if (session.name) {
    console.log(chalk.bold(`  Name: ${session.name}`));
  }
  console.log(`  Provider: ${session.provider}`);
  console.log(`  Model: ${session.model}`);
  console.log(`  Started: ${session.startedAt.slice(0, 16).replace("T", " ")}`);
  console.log(`  Messages: ${session.messages.length}`);
  console.log(`  Tokens: ${session.totalTokens}`);
  console.log();
  console.log(chalk.bold("  First Message:"));
  console.log("  " + "─".repeat(60));
  
  if (session.messages.length > 0) {
    const firstMsg = session.messages[0];
    const preview = firstMsg.content.slice(0, 150);
    console.log(`  ${preview}${firstMsg.content.length > 150 ? "..." : ""}`);
  }
  console.log();
}

/**
 * Rename a session
 */
export function handleSessionRename(idOrPrefix: string, newName: string, options: { json?: boolean }): void {
  let sessionId: string | null;
  
  try {
    sessionId = resolveSessionId(idOrPrefix);
  } catch (error) {
    if (error instanceof AmbiguousSessionError) {
      console.error(error.message);
      process.exit(2);
    }
    throw error;
  }
  
  if (!sessionId) {
    console.error(`Error: Session "${idOrPrefix}" not found`);
    process.exit(1);
  }

  const session = loadSessionById(sessionId);
  if (!session) {
    console.error(`Error: Could not load session "${sessionId}"`);
    process.exit(1);
  }

  const oldName = session.name || "(unnamed)";
  session.name = newName;
  saveSession(session);

  if (options.json) {
    console.log(JSON.stringify({
      success: true,
      sessionId: session.id,
      oldName: oldName,
      newName: session.name,
    }, null, 2));
    process.exit(0);
  }

  console.log();
  console.log(chalk.green(`  ✓ Renamed session ${chalk.cyan(session.id.slice(0, 8))}`));
  console.log(`    ${chalk.dim(oldName)} → ${chalk.bold(newName)}`);
  console.log();
}

/**
 * Delete a session
 */
export function handleSessionDelete(idOrPrefix: string, options: { json?: boolean }): void {
  let sessionId: string | null;
  
  try {
    sessionId = resolveSessionId(idOrPrefix);
  } catch (error) {
    if (error instanceof AmbiguousSessionError) {
      console.error(error.message);
      process.exit(2);
    }
    throw error;
  }
  
  if (!sessionId) {
    console.error(`Error: Session "${idOrPrefix}" not found`);
    process.exit(1);
  }

  const session = loadSessionById(sessionId);
  if (!session) {
    console.error(`Error: Could not load session "${sessionId}"`);
    process.exit(1);
  }

  const success = deleteSession(sessionId);
  if (!success) {
    console.error(`Error: Failed to delete session "${sessionId}"`);
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify({
      success: true,
      sessionId: sessionId,
      name: session.name,
    }, null, 2));
    process.exit(0);
  }

  console.log();
  console.log(chalk.green(`  ✓ Deleted session ${chalk.cyan(session.id.slice(0, 8))}`));
  if (session.name) {
    console.log(`    "${session.name}"`);
  }
  console.log();
}
