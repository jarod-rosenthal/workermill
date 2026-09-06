/**
 * Deterministic evidence for the repository state a gate or review examined.
 *
 * This intentionally reads the index and working tree without asking Git to
 * materialize file contents: filters, external diff drivers, hooks, and the
 * filesystem monitor are not part of evidence collection.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface VerifiedRepositoryFingerprint {
  verified: true;
  algorithm: "sha256";
  head: string;
  digest: string;
}

export interface UnverifiedRepositoryFingerprint {
  verified: false;
  reason: string;
}

export type RepositoryFingerprintResult = VerifiedRepositoryFingerprint | UnverifiedRepositoryFingerprint;

interface GitIndexEntry {
  mode: string;
  objectId: string;
  stage: string;
  path: string;
}

interface GitTreeEntry {
  mode: string;
  objectId: string;
  type: string;
  path: string;
}

interface GitMetadata {
  head: string;
  index: GitIndexEntry[];
  headTree: GitTreeEntry[];
  untracked: string[];
  rawIndex: Buffer;
  rawHeadTree: Buffer;
  rawUntracked: Buffer;
}

interface WorkingEntry {
  path: string;
  kind: "file" | "symlink" | "deleted";
  mode: number;
  contentBytes: number;
  contentDigest: string;
}

const GIT_PREFIX = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "diff.external=false"];
const MAX_GIT_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_WORKING_TREE_BYTES = 64 * 1024 * 1024;

function git(workingDir: string, args: string[]): Buffer {
  return execFileSync("git", [...GIT_PREFIX, ...args], {
    cwd: workingDir,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_OPTIONAL_LOCKS: "0" },
    timeout: 10_000,
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  });
}

function unverified(reason: string): UnverifiedRepositoryFingerprint {
  return { verified: false, reason };
}

function isUnverified(value: GitMetadata | WorkingEntry[] | UnverifiedRepositoryFingerprint): value is UnverifiedRepositoryFingerprint {
  return "verified" in value && value.verified === false;
}

function parseUtf8Path(raw: Buffer): string | null {
  const value = raw.toString("utf8");
  // Node's string path APIs cannot safely round-trip non-UTF-8 Git paths.
  // Refuse those rather than hashing a lossy path representation.
  if (!Buffer.from(value, "utf8").equals(raw) || value.length === 0 || path.isAbsolute(value)) return null;
  return value;
}

function parseIndex(raw: Buffer): GitIndexEntry[] | null {
  const entries: GitIndexEntry[] = [];
  for (const item of raw.toString("binary").split("\0")) {
    if (!item) continue;
    const tab = item.indexOf("\t");
    if (tab < 0) return null;
    const fields = item.slice(0, tab).split(" ");
    if (fields.length !== 3 || !/^[0-7]{6}$/.test(fields[0]) || !/^[0-9a-f]{40,64}$/i.test(fields[1]) || !/^[0-3]$/.test(fields[2])) return null;
    const rawPath = Buffer.from(item.slice(tab + 1), "binary");
    const entryPath = parseUtf8Path(rawPath);
    if (!entryPath) return null;
    entries.push({ mode: fields[0], objectId: fields[1], stage: fields[2], path: entryPath });
  }
  return entries;
}

function parseTree(raw: Buffer): GitTreeEntry[] | null {
  const entries: GitTreeEntry[] = [];
  for (const item of raw.toString("binary").split("\0")) {
    if (!item) continue;
    const tab = item.indexOf("\t");
    if (tab < 0) return null;
    const fields = item.slice(0, tab).split(" ");
    if (fields.length !== 3 || !/^[0-7]{6}$/.test(fields[0]) || !/^[0-9a-f]{40,64}$/i.test(fields[2])) return null;
    const entryPath = parseUtf8Path(Buffer.from(item.slice(tab + 1), "binary"));
    if (!entryPath) return null;
    entries.push({ mode: fields[0], type: fields[1], objectId: fields[2], path: entryPath });
  }
  return entries;
}

function parsePathList(raw: Buffer): string[] | null {
  const entries: string[] = [];
  for (const item of raw.toString("binary").split("\0")) {
    if (!item) continue;
    const entryPath = parseUtf8Path(Buffer.from(item, "binary"));
    if (!entryPath) return null;
    entries.push(entryPath);
  }
  return entries;
}

function readMetadata(workingDir: string): GitMetadata | UnverifiedRepositoryFingerprint {
  try {
    const head = git(workingDir, ["rev-parse", "--verify", "HEAD"]).toString("utf8").trim();
    if (!/^[0-9a-f]{40,64}$/i.test(head)) return unverified("repository HEAD is unavailable");
    const rawIndex = git(workingDir, ["ls-files", "-s", "-z"]);
    const rawHeadTree = git(workingDir, ["ls-tree", "-r", "-z", "HEAD"]);
    const rawUntracked = git(workingDir, ["ls-files", "--others", "--exclude-standard", "-z"]);
    const index = parseIndex(rawIndex);
    const headTree = parseTree(rawHeadTree);
    const untracked = parsePathList(rawUntracked);
    if (!index || !headTree || !untracked) return unverified("repository paths could not be represented safely");
    if (index.some((entry) => entry.stage !== "0")) return unverified("repository index has unmerged entries");
    if (index.some((entry) => entry.mode === "160000") || headTree.some((entry) => entry.mode === "160000")) {
      return unverified("repository contains submodule entries, which are not safely fingerprinted");
    }
    return { head, index, headTree, untracked, rawIndex, rawHeadTree, rawUntracked };
  } catch {
    return unverified("repository metadata could not be collected");
  }
}

function repositoryRoot(workingDir: string): string | UnverifiedRepositoryFingerprint {
  try {
    const root = git(workingDir, ["rev-parse", "--show-toplevel"]).toString("utf8").trim();
    return fs.realpathSync(root);
  } catch {
    return unverified("repository root could not be resolved");
  }
}

function sameMetadata(left: GitMetadata, right: GitMetadata): boolean {
  return left.head === right.head
    && left.rawIndex.equals(right.rawIndex)
    && left.rawHeadTree.equals(right.rawHeadTree)
    && left.rawUntracked.equals(right.rawUntracked);
}

function validateAncestors(root: string, relativePath: string): boolean {
  // Git path records are slash-separated on every platform.
  const segments = relativePath.split("/");
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
  }
  return true;
}

function contentDigest(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function collectWorkingEntries(root: string, metadata: GitMetadata): WorkingEntry[] | UnverifiedRepositoryFingerprint {
  const paths = new Set([...metadata.index.map((entry) => entry.path), ...metadata.headTree.map((entry) => entry.path), ...metadata.untracked]);
  const entries: WorkingEntry[] = [];
  let totalBytes = 0;
  for (const relativePath of [...paths].sort()) {
    const absolutePath = path.resolve(root, relativePath);
    if (absolutePath !== root && !absolutePath.startsWith(root + path.sep)) return unverified("repository path escaped its working directory");
    try {
      if (!validateAncestors(root, relativePath)) return unverified(`repository path has a non-directory or symlink ancestor: ${relativePath}`);
    } catch {
      return unverified(`could not validate ancestors for ${relativePath}`);
    }
    let before: fs.Stats;
    try {
      before = fs.lstatSync(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        entries.push({ path: relativePath, kind: "deleted", mode: 0, contentBytes: 0, contentDigest: contentDigest(Buffer.alloc(0)) });
        continue;
      }
      return unverified(`could not inspect ${relativePath}`);
    }
    let kind: WorkingEntry["kind"];
    let content: Buffer;
    try {
      if (before.isSymbolicLink()) {
        kind = "symlink";
        content = fs.readlinkSync(absolutePath, "buffer") as Buffer;
      } else if (before.isFile()) {
        kind = "file";
        if (before.size > MAX_FILE_BYTES) return unverified(`working-tree file exceeds ${MAX_FILE_BYTES} byte fingerprint limit: ${relativePath}`);
        const descriptor = fs.openSync(absolutePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try {
          const opened = fs.fstatSync(descriptor);
          if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size || opened.mode !== before.mode) {
            return unverified(`repository changed while opening ${relativePath}`);
          }
          content = fs.readFileSync(descriptor);
        } finally {
          fs.closeSync(descriptor);
        }
      } else {
        return unverified(`unsupported working-tree entry type at ${relativePath}`);
      }
      if (content.length > MAX_FILE_BYTES) return unverified(`working-tree entry exceeds ${MAX_FILE_BYTES} byte fingerprint limit: ${relativePath}`);
      totalBytes += content.length;
      if (totalBytes > MAX_WORKING_TREE_BYTES) return unverified(`working tree exceeds ${MAX_WORKING_TREE_BYTES} byte fingerprint limit`);
      const after = fs.lstatSync(absolutePath);
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.mode !== after.mode) {
        return unverified(`repository changed while reading ${relativePath}`);
      }
    } catch {
      return unverified(`could not read ${relativePath} without following links`);
    }
    entries.push({ path: relativePath, kind, mode: before.mode & 0o7777, contentBytes: content.length, contentDigest: contentDigest(content) });
  }
  return entries;
}

function sameWorkingEntries(left: WorkingEntry[], right: WorkingEntry[]): boolean {
  return left.length === right.length && left.every((entry, index) => {
    const candidate = right[index];
    return entry.path === candidate.path
      && entry.kind === candidate.kind
      && entry.mode === candidate.mode
      && entry.contentBytes === candidate.contentBytes
      && entry.contentDigest === candidate.contentDigest;
  });
}

function frame(hash: ReturnType<typeof createHash>, tag: string, value: string | Buffer | number): void {
  const bytes = typeof value === "number" ? Buffer.from(String(value), "utf8") : typeof value === "string" ? Buffer.from(value, "utf8") : value;
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(Buffer.from(tag, "utf8"));
  hash.update(length);
  hash.update(bytes);
}

/**
 * Captures a bounded, content-addressed repository snapshot. A failed or
 * unstable collection is deliberately unverified; callers must not treat it
 * as evidence matching a previous snapshot.
 */
export function captureRepositoryFingerprint(workingDir: string): RepositoryFingerprintResult {
  const root = repositoryRoot(workingDir);
  if (typeof root !== "string") return root;
  const initial = readMetadata(root);
  if (isUnverified(initial)) return initial;
  const firstWorkingEntries = collectWorkingEntries(root, initial);
  if (isUnverified(firstWorkingEntries)) return firstWorkingEntries;
  const secondWorkingEntries = collectWorkingEntries(root, initial);
  if (isUnverified(secondWorkingEntries)) return secondWorkingEntries;
  const finalMetadata = readMetadata(root);
  if (isUnverified(finalMetadata)) return finalMetadata;
  if (!sameMetadata(initial, finalMetadata) || !sameWorkingEntries(firstWorkingEntries, secondWorkingEntries)) {
    return unverified("repository changed during fingerprint collection");
  }

  const hash = createHash("sha256");
  frame(hash, "format", "workermill-repository-fingerprint-v1");
  frame(hash, "head", initial.head);
  for (const entry of initial.index) {
    frame(hash, "index-path", entry.path);
    frame(hash, "index-mode", entry.mode);
    frame(hash, "index-object", entry.objectId);
    frame(hash, "index-stage", entry.stage);
  }
  for (const entry of firstWorkingEntries) {
    frame(hash, "working-path", entry.path);
    frame(hash, "working-kind", entry.kind);
    frame(hash, "working-mode", entry.mode);
    frame(hash, "working-content-bytes", entry.contentBytes);
    frame(hash, "working-content-sha256", entry.contentDigest);
  }
  return { verified: true, algorithm: "sha256", head: initial.head, digest: hash.digest("hex") };
}
