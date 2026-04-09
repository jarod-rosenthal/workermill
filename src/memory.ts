import fs from "fs";
import path from "path";
import crypto from "crypto";
import * as logger from "./logger.js";
import { getProjectRootDir } from "./project-data.js";
import { getStateRoot } from "./state-root.js";

export interface Memory {
  id: string;
  type: "learning" | "preference" | "context" | "correction";
  content: string;
  createdAt: string;
  source?: "agent" | "auto-extracted" | "manual";
  confidence?: "high" | "medium" | "low";
  runId?: string;
  storyId?: string;
  persona?: string;
}

export interface MemoryMetadata {
  source?: Memory["source"];
  confidence?: Memory["confidence"];
  runId?: string;
  storyId?: string;
  persona?: string;
}

const MEMORY_FILES: Record<Memory["type"], { file: string; heading: string }> = {
  learning: { file: "patterns.md", heading: "Codebase Learnings" },
  preference: { file: "preferences.md", heading: "User Preferences" },
  context: { file: "project-context.md", heading: "Project Context" },
  correction: { file: "corrections.md", heading: "Corrections" },
};

export const PRIMARY_MEMORY_FILES = Object.values(MEMORY_FILES).map((entry) => entry.file);

function legacyProjectHash(cwd?: string): string {
  return crypto.createHash("md5").update(cwd || process.cwd()).digest("hex").slice(0, 8);
}

function legacyMemoryDir(cwd?: string): string {
  return path.join(getStateRoot(), "memory", legacyProjectHash(cwd));
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

function readInlineMetadata(line: string): { text: string; metadata?: MemoryMetadata } {
  const metadataMatch = line.match(/\s+<!--\s*wm:(\{.*\})\s*-->$/);
  if (!metadataMatch || metadataMatch.index === undefined) {
    return { text: line };
  }

  try {
    const metadata = JSON.parse(metadataMatch[1]) as MemoryMetadata;
    return {
      text: line.slice(0, metadataMatch.index).trimEnd(),
      metadata,
    };
  } catch {
    return { text: line };
  }
}

function serializeInlineMetadata(memory: Memory): string {
  const metadata: MemoryMetadata = {
    source: memory.source,
    confidence: memory.confidence,
    runId: memory.runId,
    storyId: memory.storyId,
    persona: memory.persona,
  };

  const hasMetadata = Object.values(metadata).some((value) => typeof value === "string" && value.length > 0);
  if (!hasMetadata) return "";
  return ` <!-- wm:${JSON.stringify(metadata)} -->`;
}

function defaultMemoryMetadata(overrides?: MemoryMetadata): MemoryMetadata {
  const metadata: MemoryMetadata = {
    source: overrides?.source,
    confidence: overrides?.confidence,
    runId: overrides?.runId ?? process.env.WM_RUN_ID,
    storyId: overrides?.storyId ?? process.env.WM_STORY_ID,
    persona: overrides?.persona ?? process.env.WM_PERSONA,
  };

  if (!metadata.source) metadata.source = metadata.runId || metadata.storyId ? "agent" : undefined;
  if (!metadata.confidence) metadata.confidence = metadata.source === "auto-extracted" ? "medium" : (metadata.source ? "high" : undefined);

  return metadata;
}

function parseMemoryLine(line: string, type: Memory["type"]): Memory | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("- ")) return null;
  const { text, metadata } = readInlineMetadata(trimmed);

  const tagged = text.match(/^- \[([^\]]+)\]\s+(.*?)(?:\s+\(([^)]+)\))?$/);
  if (tagged) {
    return {
      id: tagged[1],
      type,
      content: tagged[2].trim(),
      createdAt: tagged[3] || "",
      source: metadata?.source,
      confidence: metadata?.confidence,
      runId: metadata?.runId,
      storyId: metadata?.storyId,
      persona: metadata?.persona,
    };
  }

  const plain = text.match(/^- (.+)$/);
  if (!plain) return null;
  return {
    id: crypto.createHash("md5").update(`${type}:${plain[1]}`).digest("hex").slice(0, 8),
    type,
    content: plain[1].trim(),
    createdAt: "",
    source: metadata?.source,
    confidence: metadata?.confidence,
    runId: metadata?.runId,
    storyId: metadata?.storyId,
    persona: metadata?.persona,
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
    ...memories.map((m) => `- [${m.id}] ${m.content}${m.createdAt ? ` (${m.createdAt})` : ""}${serializeInlineMetadata(m)}`),
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
    const oldPath = path.join(getStateRoot(), "learnings", `${legacyProjectHash(cwd)}.json`);
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
  metadata?: MemoryMetadata,
): Memory {
  const trimmed = content.trim();
  const existing = loadMemories(cwd).find((m) => m.content === trimmed);
  if (existing) return existing;
  const normalizedMetadata = defaultMemoryMetadata(metadata);

  const memory: Memory = {
    id: existingId || crypto.randomUUID().slice(0, 8),
    type,
    content: trimmed,
    createdAt: existingCreatedAt || new Date().toISOString(),
    source: normalizedMetadata.source,
    confidence: normalizedMetadata.confidence,
    runId: normalizedMetadata.runId,
    storyId: normalizedMetadata.storyId,
    persona: normalizedMetadata.persona,
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
