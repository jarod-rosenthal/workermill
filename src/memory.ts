import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import * as logger from "./logger.js";
import { getProjectRootDir } from "./project-data.js";

export interface Memory {
  id: string;
  type: "learning" | "preference" | "context" | "correction";
  content: string;
  createdAt: string;
}

const MEMORY_FILES: Record<Memory["type"], { file: string; heading: string }> = {
  learning: { file: "patterns.md", heading: "Codebase Learnings" },
  preference: { file: "preferences.md", heading: "User Preferences" },
  context: { file: "project-context.md", heading: "Project Context" },
  correction: { file: "corrections.md", heading: "Corrections" },
};

function legacyProjectHash(cwd?: string): string {
  return crypto.createHash("md5").update(cwd || process.cwd()).digest("hex").slice(0, 8);
}

function legacyMemoryDir(cwd?: string): string {
  return path.join(os.homedir(), ".workermill", "memory", legacyProjectHash(cwd));
}

function legacyMemoryFile(cwd?: string): string {
  return path.join(legacyMemoryDir(cwd), "memories.json");
}

function getMemoriesDir(cwd?: string): string {
  return path.join(getProjectRootDir(cwd), "memories");
}

function ensureMemoriesDir(cwd?: string): void {
  const dir = getMemoriesDir(cwd);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function filePathForType(type: Memory["type"], cwd?: string): string {
  return path.join(getMemoriesDir(cwd), MEMORY_FILES[type].file);
}

function parseMemoryLine(line: string, type: Memory["type"]): Memory | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("- ")) return null;

  const tagged = trimmed.match(/^- \[([^\]]+)\]\s+(.*?)(?:\s+\(([^)]+)\))?$/);
  if (tagged) {
    return {
      id: tagged[1],
      type,
      content: tagged[2].trim(),
      createdAt: tagged[3] || "",
    };
  }

  const plain = trimmed.match(/^- (.+)$/);
  if (!plain) return null;
  return {
    id: crypto.createHash("md5").update(`${type}:${plain[1]}`).digest("hex").slice(0, 8),
    type,
    content: plain[1].trim(),
    createdAt: "",
  };
}

function readTypeFile(type: Memory["type"], cwd?: string): Memory[] {
  try {
    const fp = filePathForType(type, cwd);
    if (!fs.existsSync(fp)) return [];
    const raw = fs.readFileSync(fp, "utf-8");
    return raw
      .split("\n")
      .map((line) => parseMemoryLine(line, type))
      .filter((m): m is Memory => Boolean(m));
  } catch (err) {
    logger.error("Failed to read memory file", {
      type,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

function writeTypeFile(type: Memory["type"], memories: Memory[], cwd?: string): void {
  ensureMemoriesDir(cwd);
  const fp = filePathForType(type, cwd);
  if (memories.length === 0) {
    try {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch (err) {
      logger.error("Failed to delete empty memory file", {
        type,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  const lines = [
    `# ${MEMORY_FILES[type].heading}`,
    "",
    ...memories.map((m) => `- [${m.id}] ${m.content}${m.createdAt ? ` (${m.createdAt})` : ""}`),
    "",
  ];
  fs.writeFileSync(fp, lines.join("\n"), "utf-8");
}

function migrateLegacyMemoryJson(cwd?: string): void {
  const legacyFile = legacyMemoryFile(cwd);
  if (!fs.existsSync(legacyFile)) return;

  try {
    const raw = fs.readFileSync(legacyFile, "utf-8");
    const legacy = JSON.parse(raw) as Memory[];
    if (Array.isArray(legacy)) {
      for (const entry of legacy) {
        if (entry?.type && entry?.content) {
          addMemory(entry.type, entry.content, cwd, entry.id, entry.createdAt);
        }
      }
    }
    fs.unlinkSync(legacyFile);
  } catch (err) {
    logger.error("Failed to migrate legacy memory JSON", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function migrateLegacyLearnings(cwd?: string): void {
  try {
    const oldPath = path.join(os.homedir(), ".workermill", "learnings", `${legacyProjectHash(cwd)}.json`);
    if (!fs.existsSync(oldPath)) return;

    const oldLearnings = JSON.parse(fs.readFileSync(oldPath, "utf-8")) as string[];
    if (Array.isArray(oldLearnings)) {
      for (const learning of oldLearnings) {
        if (typeof learning === "string" && learning.trim()) {
          addMemory("learning", learning.trim(), cwd);
        }
      }
    }
    fs.unlinkSync(oldPath);
  } catch (err) {
    logger.error("Failed to migrate legacy learnings", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function migrateOldLearnings(cwd?: string): void {
  migrateLegacyMemoryJson(cwd);
  migrateLegacyLearnings(cwd);
}

export function loadMemories(cwd?: string): Memory[] {
  migrateOldLearnings(cwd);
  return (Object.keys(MEMORY_FILES) as Memory["type"][])
    .flatMap((type) => readTypeFile(type, cwd));
}

export function saveMemories(memories: Memory[], cwd?: string): void {
  const byType = new Map<Memory["type"], Memory[]>();
  for (const type of Object.keys(MEMORY_FILES) as Memory["type"][]) {
    byType.set(type, []);
  }
  for (const memory of memories) {
    byType.get(memory.type)?.push(memory);
  }
  for (const [type, items] of byType.entries()) {
    writeTypeFile(type, items, cwd);
  }
}

export function addMemory(
  type: Memory["type"],
  content: string,
  cwd?: string,
  existingId?: string,
  existingCreatedAt?: string,
): Memory {
  const trimmed = content.trim();
  const existing = loadMemories(cwd).find((m) => m.content === trimmed);
  if (existing) return existing;

  const memory: Memory = {
    id: existingId || crypto.randomUUID().slice(0, 8),
    type,
    content: trimmed,
    createdAt: existingCreatedAt || new Date().toISOString(),
  };

  const items = readTypeFile(type, cwd);
  items.push(memory);
  writeTypeFile(type, items, cwd);
  logger.info("Memory saved", { type, preview: trimmed.slice(0, 100) });
  return memory;
}

export function removeMemory(idOrContent: string, cwd?: string): boolean {
  let removed = false;

  for (const type of Object.keys(MEMORY_FILES) as Memory["type"][]) {
    const items = readTypeFile(type, cwd);
    const next = items.filter((m) => {
      const match = m.id === idOrContent || m.content.toLowerCase().includes(idOrContent.toLowerCase());
      if (match) removed = true;
      return !match;
    });
    if (next.length !== items.length) {
      writeTypeFile(type, next, cwd);
    }
  }

  return removed;
}

/** Format memories for inclusion in system prompt. */
export function formatMemoriesForPrompt(memories: Memory[]): string {
  if (memories.length === 0) return "";

  const sections: Record<Memory["type"], string[]> = {
    learning: [],
    preference: [],
    context: [],
    correction: [],
  };

  for (const m of memories) {
    sections[m.type].push(`- ${m.content}`);
  }

  const parts: string[] = [];
  if (sections.learning.length > 0) parts.push(`### Codebase Learnings\n${sections.learning.join("\n")}`);
  if (sections.preference.length > 0) parts.push(`### User Preferences\n${sections.preference.join("\n")}`);
  if (sections.context.length > 0) parts.push(`### Project Context\n${sections.context.join("\n")}`);
  if (sections.correction.length > 0) parts.push(`### Corrections (follow these)\n${sections.correction.join("\n")}`);

  return `\n\n## Project Memory\n\n${parts.join("\n\n")}`;
}

/**
 * Extract ::learning:: and ::remember:: markers from model output.
 * Returns new memories to save.
 */
export function extractMemoryMarkers(text: string): Array<{ type: Memory["type"]; content: string }> {
  const results: Array<{ type: Memory["type"]; content: string }> = [];

  const learningMatches = text.match(/::learning::(.*?)(?=::\w+::|$)/gs);
  if (learningMatches) {
    for (const m of learningMatches) {
      const content = m.replace("::learning::", "").trim();
      if (content) results.push({ type: "learning", content });
    }
  }

  const rememberMatches = text.match(/::remember::(.*?)(?=::\w+::|$)/gs);
  if (rememberMatches) {
    for (const m of rememberMatches) {
      const content = m.replace("::remember::", "").trim();
      if (content) results.push({ type: "context", content });
    }
  }

  return results;
}
