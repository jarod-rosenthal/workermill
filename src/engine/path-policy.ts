import fs from "node:fs";
import path from "node:path";

export type PathAccess = "read" | "read_write";

/** A canonical capability granted to an explicit file or directory. */
export interface PathGrant {
  root: string;
  access: PathAccess;
}

/** Filesystem scope for explicit file tools. Memory/application state is separate. */
export interface PathScope {
  workspace: string;
  extraGrants: readonly PathGrant[];
}

type GrantKind = "file" | "directory" | "exact";
const grantKinds = new WeakMap<object, GrantKind>();

export interface ResolvePathOptions {
  /** Full-disk mode still canonicalizes paths, but does not apply containment. */
  enforceScope?: boolean;
}

function realpath(filePath: string): string {
  return fs.realpathSync.native(filePath);
}

function nearestExistingParent(filePath: string): { parent: string; missing: string[] } {
  const missing: string[] = [];
  let current = path.resolve(filePath);
  while (true) {
    try {
      // lstat keeps dangling links in the walk; realpath then determines
      // whether this is a usable canonical parent.
      fs.lstatSync(current);
      try {
        return { parent: realpath(current), missing };
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        missing.unshift(path.basename(current));
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Unable to resolve path: ${filePath}`);
    }
    if (missing[0] !== path.basename(current)) missing.unshift(path.basename(current));
    current = parent;
  }
}

function rejectSymlinkComponents(parent: string, missing: string[]): void {
  let current = parent;
  for (const component of missing) {
    current = path.join(current, component);
    // A dangling symlink is not included by existsSync. Reject it rather than
    // allowing a write to follow an uncanonicalized link at execution time.
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new Error(`Path contains a symbolic link: ${current}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Path contains a symbolic link:")) {
        throw error;
      }
      // This component is genuinely absent; later components are absent too.
      break;
    }
  }
}

/** Canonicalize an existing path or a new path beneath its nearest real parent. */
export function canonicalizePath(filePath: string): string {
  const absolute = path.resolve(filePath);
  try {
    return realpath(absolute);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    const { parent, missing } = nearestExistingParent(absolute);
    rejectSymlinkComponents(parent, missing);
    return path.join(parent, ...missing);
  }
}

function isWithin(root: string, candidate: string): boolean {
  const filesystemRoot = path.parse(root).root;
  return candidate === root || (root === filesystemRoot ? candidate.startsWith(root) : candidate.startsWith(root + path.sep));
}

function canonicalGrant(grant: PathGrant): PathGrant {
  const root = canonicalizePath(grant.root);
  let kind: GrantKind = "exact";
  try {
    kind = fs.statSync(root).isDirectory() ? "directory" : "file";
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const normalized = { root, access: grant.access };
  grantKinds.set(normalized, kind);
  return normalized;
}

/** Create a scope and canonicalize its workspace and explicit grants once. */
export function createPathScope(
  workspace: string,
  extraGrants: readonly PathGrant[] = [],
): PathScope {
  return {
    workspace: canonicalizePath(workspace),
    extraGrants: extraGrants.map(canonicalGrant),
  };
}

function grantAllows(grant: PathGrant, candidate: string, access: PathAccess): boolean {
  if (access === "read_write" && grant.access !== "read_write") return false;
  const kind = grantKinds.get(grant);
  // Unnormalized grants are treated conservatively as exact capabilities.
  return kind === "directory" ? isWithin(grant.root, candidate) : candidate === grant.root;
}

/**
 * Resolve and authorize a path. Existing path components and the nearest
 * existing parent for a new path are realpath-canonicalized before checking
 * containment. This is a path check, not an OS sandbox or TOCTOU defense.
 */
export function resolvePath(
  scope: PathScope,
  inputPath: string,
  access: PathAccess = "read",
  options: ResolvePathOptions = {},
): string {
  if (!inputPath || inputPath.includes("\0")) {
    throw new Error("Path must be a non-empty string without NUL bytes");
  }
  const candidate = canonicalizePath(path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(scope.workspace, inputPath));
  if (options.enforceScope === false) return candidate;

  const workspaceGrant: PathGrant = { root: scope.workspace, access: "read_write" };
  grantKinds.set(workspaceGrant, "directory");
  if (grantAllows(workspaceGrant, candidate, access)) return candidate;
  for (const grant of scope.extraGrants) {
    if (grantAllows(grant, candidate, access)) return candidate;
  }
  throw new Error(
    `Path "${inputPath}" is outside the working directory/allowed filesystem scope or lacks ${access} access`,
  );
}

/** Compatibility-friendly assertion alias for tool adapters. */
export const assertPathAllowed = resolvePath;

/** Resolve multiple paths before a mutating operation begins. */
export function resolveAllPaths(
  scope: PathScope,
  inputPaths: readonly string[],
  access: PathAccess,
  options: ResolvePathOptions = {},
): string[] {
  return inputPaths.map((inputPath) => resolvePath(scope, inputPath, access, options));
}
