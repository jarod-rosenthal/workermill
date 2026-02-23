/**
 * Local Indexer — clone, chunk, embed, and push code to the cloud API.
 *
 * Orchestrates the full local indexing pipeline:
 *   1. Shallow-clone the target repo
 *   2. Walk the file tree (with filters)
 *   3. Chunk files via CodeChunker
 *   4. Embed chunks via local Ollama
 *   5. Push embedded chunks to POST /api/codebase/ingest
 *   6. Clean up the clone directory
 */

import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { tmpdir } from "os";

import { type AgentConfig, findGitPath } from "./config.js";
import { CodeChunker, type CodeChunk } from "./code-chunker.js";
import { generateEmbeddings } from "./ollama-manager.js";
import { api } from "./api.js";

// ── Types ────────────────────────────────────────────

export interface LocalIndexingOptions {
  repository: string;
  branch?: string;
  scmProvider: string;
  scmToken: string;
  ollamaPort?: number;
  maxFiles?: number;
  excludePatterns?: string[];
  includeLanguages?: string[];
  maxFileSizeKb?: number;
  onProgress?: (msg: string, indexed: number, total: number) => void;
}

export interface LocalIndexingResult {
  success: boolean;
  repository: string;
  branch: string;
  totalFiles: number;
  indexedFiles: number;
  totalChunks: number;
  skippedFiles: number;
  durationMs: number;
  error?: string;
}

// ── Default exclude patterns ─────────────────────────

const DEFAULT_EXCLUDE_PATTERNS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  "coverage",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  "venv",
  ".venv",
  "vendor",
  ".terraform",
  "target", // Rust/Java
  "bin", // Go
  ".idea",
  ".vscode",
  ".DS_Store",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "Cargo.lock",
  "go.sum",
];

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".bmp",
  ".svg",
  ".webp",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".o",
  ".obj",
  ".a",
  ".lib",
  ".pyc",
  ".pyo",
  ".class",
  ".wasm",
  ".map",
  ".min.js",
  ".min.css",
]);

function isBinaryExtension(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  for (const ext of BINARY_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

// ── Clone helpers ────────────────────────────────────

function buildCloneUrl(repo: string, token: string, scmProvider: string): string {
  // Full URL form
  if (repo.startsWith("https://") || repo.startsWith("http://")) {
    const url = new URL(repo);
    switch (scmProvider) {
      case "bitbucket":
        url.username = "x-token-auth";
        break;
      case "gitlab":
        url.username = "oauth2";
        break;
      case "github":
      default:
        url.username = "x-access-token";
        break;
    }
    url.password = token;
    if (!url.pathname.endsWith(".git")) {
      url.pathname += ".git";
    }
    return url.toString();
  }

  // Short form: owner/repo
  switch (scmProvider) {
    case "bitbucket":
      return `https://x-token-auth:${token}@bitbucket.org/${repo}.git`;
    case "gitlab":
      return `https://oauth2:${token}@gitlab.com/${repo}.git`;
    case "github":
    default:
      return `https://x-access-token:${token}@github.com/${repo}.git`;
  }
}

function cloneRepo(repo: string, token: string, scmProvider: string, branch?: string): string {
  const gitBin = findGitPath();
  if (!gitBin) throw new Error("Git not found — cannot clone repository");

  const slug = repo.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 40);
  const cloneDir = join(tmpdir(), `wm-idx-${slug}-${Date.now()}`);

  const cloneUrl = buildCloneUrl(repo, token, scmProvider);
  const args = ["clone", "--depth", "1", "--single-branch"];
  if (branch) args.push("--branch", branch);
  args.push(cloneUrl, cloneDir);

  execFileSync(gitBin, args, {
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 120_000,
    windowsHide: true,
  });

  return cloneDir;
}

// ── File tree walker ─────────────────────────────────

function shouldExclude(name: string, excludePatterns: string[]): boolean {
  return excludePatterns.some((pattern) => name === pattern || name.includes(pattern));
}

function walkFiles(
  dir: string,
  rootDir: string,
  excludePatterns: string[],
  maxFiles: number,
  result: string[],
): void {
  if (result.length >= maxFiles) return;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (result.length >= maxFiles) return;
    if (shouldExclude(entry, excludePatterns)) continue;

    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      walkFiles(fullPath, rootDir, excludePatterns, maxFiles, result);
    } else if (stat.isFile()) {
      // Relative path from repo root
      const relPath = fullPath.slice(rootDir.length + 1).replace(/\\/g, "/");
      if (!isBinaryExtension(relPath)) {
        result.push(relPath);
      }
    }
  }
}

// ── Ingest batch payload ─────────────────────────────

interface IngestChunk {
  filePath: string;
  fileHash: string;
  language: string | null;
  chunkIndex: number;
  chunkType: string;
  startLine: number;
  endLine: number;
  content: string;
  symbolName?: string;
  symbolType?: string;
  embedding: number[];
}

async function pushBatch(
  chunks: IngestChunk[],
  repository: string,
  branch: string,
): Promise<void> {
  const RETRIES = 3;
  const BACKOFF = [1_000, 2_000, 4_000];

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      await api.post("/api/codebase/ingest", { repository, branch, chunks });
      return;
    } catch (err) {
      if (attempt < RETRIES) {
        await new Promise((r) => setTimeout(r, BACKOFF[attempt]));
      } else {
        console.warn(
          `[local-indexer] Failed to push batch after ${RETRIES + 1} attempts: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }
}

// ── Main pipeline ────────────────────────────────────

/**
 * Index a repository locally: clone → chunk → embed → push.
 */
export async function indexRepositoryLocally(
  config: AgentConfig,
  options: LocalIndexingOptions,
): Promise<LocalIndexingResult> {
  const startTime = Date.now();
  const ollamaPort = options.ollamaPort ?? 11434;
  const maxFiles = options.maxFiles ?? 500;
  const maxFileSizeKb = options.maxFileSizeKb ?? 100;
  const excludePatterns = [...DEFAULT_EXCLUDE_PATTERNS, ...(options.excludePatterns ?? [])];

  let cloneDir: string | null = null;

  try {
    // 1. Clone repo
    cloneDir = cloneRepo(options.repository, options.scmToken, options.scmProvider, options.branch);

    // Detect branch from HEAD if not provided
    const branch = options.branch ?? detectBranch(cloneDir);

    // 2. Walk file tree
    const allFiles: string[] = [];
    walkFiles(cloneDir, cloneDir, excludePatterns, maxFiles, allFiles);

    const totalFiles = allFiles.length;
    let indexedFiles = 0;
    let skippedFiles = 0;
    let totalChunks = 0;

    // 3. Chunk files
    const chunker = new CodeChunker({ maxFileSizeKb });
    const pendingChunks: Array<{ chunk: CodeChunk; filePath: string; fileHash: string; language: string | null }> = [];

    for (let i = 0; i < allFiles.length; i++) {
      const relPath = allFiles[i];
      const fullPath = join(cloneDir, relPath);

      let content: string;
      try {
        content = readFileSync(fullPath, "utf-8");
      } catch {
        skippedFiles++;
        continue;
      }

      const result = chunker.chunkFile(relPath, content, options.includeLanguages);

      if (result.skipped) {
        skippedFiles++;
        continue;
      }

      for (const chunk of result.chunks) {
        pendingChunks.push({
          chunk,
          filePath: result.filePath,
          fileHash: result.fileHash,
          language: result.language,
        });
      }

      indexedFiles++;
      totalChunks += result.chunks.length;

      // Progress callback every 10 files
      if (options.onProgress && (indexedFiles % 10 === 0 || i === allFiles.length - 1)) {
        options.onProgress(`Chunking files`, indexedFiles, totalFiles);
      }
    }

    // 4. Embed in batches of 10
    const EMBED_BATCH_SIZE = 10;
    const embeddedChunks: IngestChunk[] = [];

    for (let i = 0; i < pendingChunks.length; i += EMBED_BATCH_SIZE) {
      const batch = pendingChunks.slice(i, i + EMBED_BATCH_SIZE);
      const texts = batch.map(
        (b) => `${b.filePath} - ${b.chunk.symbolName ?? "chunk"}\n\n${b.chunk.content}`,
      );

      let embeddings: number[][];
      try {
        embeddings = await generateEmbeddings(texts, "nomic-embed-text", ollamaPort);
      } catch (err) {
        console.warn(
          `[local-indexer] Embedding batch failed (chunks ${i}-${i + batch.length - 1}), skipping: ${err instanceof Error ? err.message : err}`,
        );
        continue;
      }

      for (let j = 0; j < batch.length; j++) {
        const b = batch[j];
        embeddedChunks.push({
          filePath: b.filePath,
          fileHash: b.fileHash,
          language: b.language,
          chunkIndex: b.chunk.chunkIndex,
          chunkType: b.chunk.chunkType,
          startLine: b.chunk.startLine,
          endLine: b.chunk.endLine,
          content: b.chunk.content,
          symbolName: b.chunk.symbolName,
          symbolType: b.chunk.symbolType,
          embedding: embeddings[j],
        });
      }
    }

    // 5. Push to cloud in batches of 50
    const PUSH_BATCH_SIZE = 50;
    for (let i = 0; i < embeddedChunks.length; i += PUSH_BATCH_SIZE) {
      const batch = embeddedChunks.slice(i, i + PUSH_BATCH_SIZE);
      await pushBatch(batch, options.repository, branch);
    }

    return {
      success: true,
      repository: options.repository,
      branch,
      totalFiles,
      indexedFiles,
      totalChunks,
      skippedFiles,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      repository: options.repository,
      branch: options.branch ?? "unknown",
      totalFiles: 0,
      indexedFiles: 0,
      totalChunks: 0,
      skippedFiles: 0,
      durationMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    // 6. Cleanup
    if (cloneDir && existsSync(cloneDir)) {
      try {
        rmSync(cloneDir, { recursive: true, force: true });
      } catch {
        /* ignore cleanup failures */
      }
    }
  }
}

// ── Helpers ──────────────────────────────────────────

function detectBranch(cloneDir: string): string {
  const gitBin = findGitPath();
  if (!gitBin) return "main";

  try {
    return execFileSync(gitBin, ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: cloneDir,
      encoding: "utf-8",
      timeout: 5_000,
      windowsHide: true,
    }).trim();
  } catch {
    return "main";
  }
}
