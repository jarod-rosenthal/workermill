import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import * as logger from "./logger.js";

export interface Memory {
  id: string;
  type: "learning" | "preference" | "context" | "correction";
  content: string;
  createdAt: string;
}

function memoryDir(): string {
  const projectHash = crypto.createHash("md5").update(process.cwd()).digest("hex").slice(0, 8);
  return path.join(os.homedir(), ".workermill", "memory", projectHash);
}

function memoryFile(): string {
  return path.join(memoryDir(), "memories.json");
}

export function loadMemories(): Memory[] {
  try {
    const fp = memoryFile();
    if (fs.existsSync(fp)) {
      return JSON.parse(fs.readFileSync(fp, "utf-8")) as Memory[];
    }
  } catch (err) {
    logger.error("Failed to load memories", { error: err instanceof Error ? err.message : String(err) });
  }
  return [];
}

export function saveMemories(memories: Memory[]): void {
  try {
    const dir = memoryDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(memoryFile(), JSON.stringify(memories, null, 2) + "\n", "utf-8");
  } catch (err) {
    logger.error("Failed to save memories", { error: err instanceof Error ? err.message : String(err) });
  }
}

export function addMemory(type: Memory["type"], content: string): Memory {
  const memories = loadMemories();
  // Deduplicate — don't save if content already exists
  const existing = memories.find(m => m.content === content);
  if (existing) return existing;

  const memory: Memory = {
    id: crypto.randomUUID().slice(0, 8),
    type,
    content,
    createdAt: new Date().toISOString(),
  };
  memories.push(memory);
  saveMemories(memories);
  logger.info("Memory saved", { type, preview: content.slice(0, 100) });
  return memory;
}

export function removeMemory(idOrContent: string): boolean {
  const memories = loadMemories();
  const idx = memories.findIndex(m => m.id === idOrContent || m.content.toLowerCase().includes(idOrContent.toLowerCase()));
  if (idx === -1) return false;
  memories.splice(idx, 1);
  saveMemories(memories);
  return true;
}

/** Format memories for inclusion in system prompt. */
export function formatMemoriesForPrompt(memories: Memory[]): string {
  if (memories.length === 0) return "";

  const sections: Record<string, string[]> = {
    learning: [],
    preference: [],
    context: [],
    correction: [],
  };

  for (const m of memories) {
    sections[m.type]?.push(`- ${m.content}`);
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

/**
 * Migrate old learnings.json to new memory format.
 */
export function migrateOldLearnings(): void {
  try {
    const projectHash = crypto.createHash("md5").update(process.cwd()).digest("hex").slice(0, 8);
    const oldPath = path.join(os.homedir(), ".workermill", "learnings", `${projectHash}.json`);
    if (!fs.existsSync(oldPath)) return;

    const oldLearnings = JSON.parse(fs.readFileSync(oldPath, "utf-8")) as string[];
    if (!Array.isArray(oldLearnings) || oldLearnings.length === 0) return;

    const memories = loadMemories();
    const existingContent = new Set(memories.map(m => m.content));
    let migrated = 0;

    for (const learning of oldLearnings) {
      if (existingContent.has(learning)) continue;
      memories.push({
        id: crypto.randomUUID().slice(0, 8),
        type: "learning",
        content: learning,
        createdAt: new Date().toISOString(),
      });
      migrated++;
    }

    if (migrated > 0) {
      saveMemories(memories);
      // Remove old file after migration
      fs.unlinkSync(oldPath);
      logger.info("Migrated old learnings to memory", { count: migrated });
    }
  } catch {
    // Non-fatal — old learnings just won't be migrated
  }
}
