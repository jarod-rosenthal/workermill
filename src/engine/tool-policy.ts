import { isDangerous, isDangerousFile, checkPermissionRules } from "../safety.js";
import { getToolMeta } from "./tools/tool-metadata.js";
import { parsePatchHeaders } from "./tools/patch.js";
import type { PermissionMode } from "../ui/agent/utils.js";
import path from "node:path";
import { canonicalizePath } from "./path-policy.js";

export interface PermissionRules {
  allow?: readonly string[];
  ask?: readonly string[];
  deny?: readonly string[];
}

/** The state read by the policy. It is intentionally data-only and React-free. */
export interface PermissionState {
  mode: PermissionMode;
  trustAll: boolean;
  sessionAllow: ReadonlySet<string>;
  /** Configured persistent allow/ask/deny rules. */
  rules: PermissionRules;
  readOnlyRole: boolean;
  /** Workspace used to compare relative and canonical rule spellings. */
  workspace?: string;
}

export type PermissionDecision =
  | { kind: "allow"; reason: string }
  | { kind: "deny"; reason: string }
  | { kind: "ask"; reason: string };

function isMutating(toolName: string): boolean {
  // Metadata deliberately describes the historical sub-agent behavior. Until
  // R10, both forms are treated as mutation-capable by this boundary.
  return toolName === "sub_agent" || !getToolMeta(toolName).isReadOnly;
}

/** Return every path/target that must be authorized by a multi-target call. */
export function extractToolTargets(toolName: string, input: Record<string, unknown>): string[] {
  const pathValue = (value: unknown): string[] => {
    if (typeof value === "string" && value.trim()) return [value];
    if (Array.isArray(value)) return value.flatMap((item) => pathValue(item));
    return [];
  };

  if (toolName === "bash" || toolName === "bash_background" || toolName === "verify") {
    return typeof input.command === "string" ? [input.command] : [];
  }

  const targets: string[] = [];
  for (const key of ["file_path", "path", "file", "paths", "files", "filePaths", "target", "destination"]) {
    targets.push(...pathValue(input[key]));
  }
  for (const key of ["edits", "files", "operations"]) {
    const entries = input[key];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        for (const pathKey of ["file_path", "path", "file"]) targets.push(...pathValue(record[pathKey]));
      }
    }
  }

  // Unified diffs commonly contain `*** Update File:` or a/ and b/ headers.
  if (toolName === "patch" && typeof input.patch_text === "string") {
    for (const header of parsePatchHeaders(input.patch_text)) {
      if (header.oldPath !== "/dev/null") targets.push(header.oldPath.replace(/^a\//, ""));
      if (header.newPath !== "/dev/null") targets.push(header.newPath.replace(/^b\//, ""));
    }
  }
  return [...new Set(targets)];
}

function matchInput(toolName: string, input: Record<string, unknown>, rules: PermissionRules | undefined, target?: string): "allow" | "ask" | "deny" | "none" {
  const normalized = toolName;
  const mutableRules = rules && {
    allow: rules.allow ? [...rules.allow] : undefined,
    ask: rules.ask ? [...rules.ask] : undefined,
    deny: rules.deny ? [...rules.deny] : undefined,
  };
  if (!target) return checkPermissionRules(normalized, input, mutableRules);
  const targetInput: Record<string, unknown> = { ...input, file_path: target, path: target, file: target };
  return checkPermissionRules(normalized, targetInput, mutableRules);
}

function targetSpellings(target: string, workspace?: string): string[] {
  const values = new Set<string>([target, path.normalize(target).replace(/\\/g, "/")]);
  if (!workspace) return [...values];
  const absolute = path.resolve(workspace, target);
  values.add(absolute.replace(/\\/g, "/"));
  values.add(path.relative(workspace, absolute).replace(/\\/g, "/") || ".");
  const canonical = canonicalizePath(absolute).replace(/\\/g, "/");
  values.add(canonical);
  values.add(path.relative(workspace, canonical).replace(/\\/g, "/") || ".");
  return [...values];
}

function configuredRuleDecision(toolName: string, input: Record<string, unknown>, rules: PermissionRules | undefined, workspace?: string): "allow" | "ask" | "deny" | "none" {
  if (!rules) return "none";
  const targets = extractToolTargets(toolName, input);
  const names = toolName === "verify" || toolName === "bash_background" ? [toolName, "bash"] : [toolName];
  const valuesByTarget = targets.length > 0
    ? targets.map((target) => (toolName === "bash" || toolName === "verify" || toolName === "bash_background" ? [target] : targetSpellings(target, workspace))
      .flatMap((spelling) => names.map((name) => matchInput(name, input, rules, spelling))))
    : [names.map((name) => matchInput(name, input, rules))];
  if (valuesByTarget.some((values) => values.includes("deny"))) return "deny";
  if (valuesByTarget.some((values) => values.includes("ask"))) return "ask";
  // A multi-target allow is valid only when every target was explicitly allowed.
  if (valuesByTarget.every((values) => values.includes("allow"))) return "allow";
  return "none";
}

/**
 * Decide a tool call using one precedence table for interactive and headless
 * callers. Sensitive writes remain prompts even when trust or an allow rule is
 * active; explicit deny and read-only modes always win.
 */
export function decideToolPermission(
  toolName: string,
  input: Record<string, unknown>,
  state: PermissionState,
): PermissionDecision {
  const mutating = isMutating(toolName);
  let configured: "allow" | "ask" | "deny" | "none";
  try {
    configured = configuredRuleDecision(toolName, input, state.rules, state.workspace);
  } catch {
    return { kind: "deny", reason: "unable to canonicalize a tool target" };
  }

  if (configured === "deny") return { kind: "deny", reason: "blocked by an explicit deny rule" };
  if (mutating && (state.mode === "plan" || state.readOnlyRole)) {
    return { kind: "deny", reason: state.readOnlyRole ? "read-only role cannot mutate" : "plan mode is read-only" };
  }

  const command = typeof input.command === "string" ? input.command : "";
  if (mutating && command && isDangerous(command)) {
    return { kind: "ask", reason: `dangerous command: ${isDangerous(command)}` };
  }

  if (configured === "ask") return { kind: "ask", reason: "required by an explicit ask rule" };

  const targets = extractToolTargets(toolName, input);
  const pathTool = toolName !== "bash" && toolName !== "verify" && toolName !== "bash_background";
  let dangerousTargets: string[] = [];
  try {
    dangerousTargets = pathTool ? targets.flatMap((target) => targetSpellings(target, state.workspace)) : [];
  } catch {
    return { kind: "deny", reason: "unable to canonicalize a tool target" };
  }
  if (mutating && dangerousTargets.some((target) => Boolean(isDangerousFile(target)))) {
    const label = dangerousTargets.map((target) => isDangerousFile(target)).find(Boolean);
    return { kind: "ask", reason: `sensitive file: ${label}` };
  }

  if (configured === "allow") return { kind: "allow", reason: "matched an explicit allow rule" };
  if (state.sessionAllow.has(toolName) || state.sessionAllow.has("*")) return { kind: "allow", reason: "allowed for this session" };
  if (state.trustAll || state.mode === "bypassPermissions") return { kind: "allow", reason: "trust/bypass mode" };

  const metadata = getToolMeta(toolName);
  if (!mutating && metadata.isReadOnly) return { kind: "allow", reason: "read-only tool" };
  if (state.mode === "acceptEdits" && metadata.acceptEditsApproved) return { kind: "allow", reason: "acceptEdits mode" };
  if (state.mode === "dontAsk") return { kind: "deny", reason: "permission prompts are disabled" };
  return { kind: "ask", reason: "no permission rule matched" };
}
