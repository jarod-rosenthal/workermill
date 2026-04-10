import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getStateRoot } from "./state-root.js";

// Project-scoped data stored in <state-root>/projects/<project-hash>/
const PROJECTS_DIR = path.join(getStateRoot(), "projects");

/**
 * Get the canonical project ID by resolving the realpath of the current working directory.
 * Uses the directory basename as a human-readable slug, with a short hash suffix
 * to handle collisions (e.g., two repos named "app" in different parent dirs).
 *
 * Examples:
 *   /home/user/github/shipapi-demo  →  shipapi-demo-31d95f21
 *   /home/user/github/workermill    →  workermill-c324288a
 */
function getProjectId(cwd?: string): string {
  const dir = cwd || process.cwd();
  let canonicalPath: string;
  try {
    canonicalPath = fs.realpathSync(dir);
  } catch {
    canonicalPath = dir;
  }
  const hash = crypto.createHash("md5").update(canonicalPath).digest("hex").slice(0, 8);
  const slug = path.basename(canonicalPath)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug ? `${slug}-${hash}` : hash;
}

/**
 * Get the root directory for project-scoped data.
 */
export function getProjectRootDir(cwd?: string): string {
  const projectId = getProjectId(cwd);
  return path.join(PROJECTS_DIR, projectId);
}

/**
 * Get the path to the project's history file.
 */
export function getProjectHistoryPath(cwd?: string): string {
  return path.join(getProjectRootDir(cwd), "history");
}

/**
 * Get the path to the project's sessions directory.
 */
export function getProjectSessionsDir(cwd?: string): string {
  return path.join(getProjectRootDir(cwd), "sessions");
}

/**
 * Get the path to the project's learnings file.
 */
export function getProjectLearningsPath(cwd?: string): string {
  return path.join(getProjectRootDir(cwd), "learnings.json");
}

/**
 * Get the path to today's log file.
 * Logs live alongside other project data: ~/.workermill/projects/<slug-hash>/logs/YYYY-MM-DD.log
 */
export function getProjectLogPath(cwd?: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return path.join(getProjectRootDir(cwd), "logs", `${today}.log`);
}

/**
 * Get the path to the project's logs directory.
 */
export function getProjectLogsDir(cwd?: string): string {
  return path.join(getProjectRootDir(cwd), "logs");
}

/**
 * Get the path to the project's meta file.
 */
export function getProjectMetaPath(cwd?: string): string {
  return path.join(getProjectRootDir(cwd), "meta.json");
}

/**
 * Project metadata interface.
 */
export interface ProjectMeta {
  canonicalPath: string;
  lastAccessed: string;
  version: string;
}

/**
 * Load project metadata, creating it if it doesn't exist.
 */
export function loadProjectMeta(cwd?: string): ProjectMeta {
  const metaPath = getProjectMetaPath(cwd);
  const canonicalPath = fs.realpathSync(cwd || process.cwd());

  let meta: ProjectMeta;
  try {
    if (fs.existsSync(metaPath)) {
      const data = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as Partial<ProjectMeta>;
      meta = {
        canonicalPath: data.canonicalPath || canonicalPath,
        lastAccessed: new Date().toISOString(),
        version: data.version || "1.0",
      };
    } else {
      meta = {
        canonicalPath,
        lastAccessed: new Date().toISOString(),
        version: "1.0",
      };
    }
  } catch (err) {
    // Ignore errors and create new meta
    meta = {
      canonicalPath,
      lastAccessed: new Date().toISOString(),
      version: "1.0",
    };
  }

  // Persist the metadata
  saveProjectMeta(meta, cwd);
  return meta;
}

/**
 * Save project metadata.
 */
export function saveProjectMeta(meta: ProjectMeta, cwd?: string): void {
  const metaPath = getProjectMetaPath(cwd);
  const metaDir = path.dirname(metaPath);

  if (!fs.existsSync(metaDir)) {
    fs.mkdirSync(metaDir, { recursive: true });
  }

  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf-8");
}

/**
 * List all known projects with their metadata.
 */
export function listProjects(): Array<ProjectMeta & { id: string }> {
  const projects: Array<ProjectMeta & { id: string }> = [];

  if (!fs.existsSync(PROJECTS_DIR)) {
    return projects;
  }

  try {
    const projectDirs = fs.readdirSync(PROJECTS_DIR).filter(dir =>
      fs.statSync(path.join(PROJECTS_DIR, dir)).isDirectory()
    );

    for (const projectId of projectDirs) {
      const metaPath = path.join(PROJECTS_DIR, projectId, "meta.json");
      try {
        if (fs.existsSync(metaPath)) {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as ProjectMeta;
          projects.push({ ...meta, id: projectId });
        }
      } catch (err) {
        // Skip invalid meta files
      }
    }
  } catch (err) {
    // Return empty list if directory operations fail
  }

  // Sort by lastAccessed descending
  return projects.sort((a, b) => new Date(b.lastAccessed).getTime() - new Date(a.lastAccessed).getTime());
}

function migrateGlobalHistory(cwd?: string): void {
  const oldPath = path.join(getStateRoot(), "history");
  const newPath = getProjectHistoryPath(cwd);

  if (!fs.existsSync(oldPath) || fs.existsSync(newPath)) return;

  // Ensure the target directory exists
  const dir = path.dirname(newPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  try {
    fs.copyFileSync(oldPath, newPath);
    if (fs.readFileSync(oldPath, 'utf-8') === fs.readFileSync(newPath, 'utf-8')) {
      fs.unlinkSync(oldPath);
    } else {
      // Remove failed copy
      try { fs.unlinkSync(newPath); } catch {}
    }
  } catch (err) {
    // Ignore migration errors
  }
}

/**
 * Migrate old hash-only project directory to new slug-hash format.
 * e.g., projects/31d95f21 → projects/shipapi-demo-31d95f21
 */
function migrateProjectDir(cwd?: string): void {
  const dir = cwd || process.cwd();
  let canonicalPath: string;
  try { canonicalPath = fs.realpathSync(dir); } catch { canonicalPath = dir; }
  const hash = crypto.createHash("md5").update(canonicalPath).digest("hex").slice(0, 8);
  const oldDir = path.join(PROJECTS_DIR, hash);
  const newDir = getProjectRootDir(cwd);
  if (oldDir === newDir) return; // already new format or slug is empty
  if (!fs.existsSync(oldDir) || fs.existsSync(newDir)) return;
  try {
    fs.renameSync(oldDir, newDir);
  } catch {
    // Ignore — will just create a new directory
  }
}

/**
 * Ensure the project directory structure exists.
 */
export function ensureProjectDirs(cwd?: string): void {
  migrateProjectDir(cwd);
  migrateGlobalHistory(cwd);
  const rootDir = getProjectRootDir(cwd);
  const sessionsDir = getProjectSessionsDir(cwd);
  const logsDir = path.dirname(getProjectLogPath(cwd));

  [rootDir, sessionsDir, logsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}