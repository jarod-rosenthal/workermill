/** Persistent, deliberately small evidence for a /build run. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { getProjectRootDir } from "./project-data.js";
import type { QualityGateResult } from "./orchestrator/gates.js";
import type { ReviewOutcome } from "./orchestrator/review.js";
import type { RepositoryFingerprintResult } from "./repository-fingerprint.js";

export const RUN_MANIFEST_VERSION = 2 as const;
const MAX_ITEMS = 2_000;
const MAX_TEXT = 5_000;
const MAX_SHORT_TEXT = 500;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const runIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export type RunPhase = "active" | "terminal";
export type RunOutcome = "in_progress" | "success" | "partial" | "failed" | "cancelled";
type LegacyRunOutcome = Exclude<RunOutcome, "in_progress">;
export type TerminalReason = "success" | "partial" | "cancelled" | "planner_failed" | "planning_rejected" | "permission_blocked" | "required_gate_failed" | "review_rejected" | "verification_failed" | "completion_blocked" | "cleanup_failed" | "no_progress" | "provider_failed" | "unknown";

export interface RunManifestStory {
  id: string; title: string; persona: string; provider?: string; model?: string;
  status: "completed" | "failed" | "skipped"; retryCount: number; failureCode?: string;
  inputTokens?: number; outputTokens?: number;
}
export interface RunManifestPlannedStory { id: string; title: string; persona: string; }
export interface RunManifestStoryAttempt {
  storyId: string; attempt: number; status: "started" | "completed" | "failed" | "cancelled";
  startedAt: string; completedAt?: string; failureCode?: string;
  /** Binding only; never endpoint, key, prompt, or tool payload. */
  provider?: string; model?: string; role?: string;
}
/** Typed R13 gate evidence, intentionally without command output. */
export type RunManifestGate = Pick<QualityGateResult, "id" | "name" | "source" | "required" | "status" | "passed">;
/** Typed review evidence, intentionally without feedback or model text. */
export interface RunManifestReview {
  round: number; provider: string; model: string; score?: number;
  decision?: "approved" | "revision_needed" | "rejected";
  outcome: Pick<ReviewOutcome, "kind" | "approved" | "decision" | "score">;
  inputTokens?: number; outputTokens?: number;
}
export type RunManifestFingerprint = Pick<RepositoryFingerprintResult, "verified"> & {
  algorithm?: "sha256"; head?: string; digest?: string; reason?: string;
};

export interface RunManifest {
  version: typeof RUN_MANIFEST_VERSION;
  id: string; startedAt: string; completedAt?: string; phase: RunPhase; terminalReason?: TerminalReason; priorRunId?: string;
  userTask: string; ticketKey?: string; featureBranch?: string | null; mainBranch?: string; outcome: RunOutcome;
  /** Existing summary retained for current callers and concise renderers. */
  stories: RunManifestStory[];
  plannedStories: RunManifestPlannedStory[];
  attempts: RunManifestStoryAttempt[];
  gates: RunManifestGate[]; reviews: RunManifestReview[]; fingerprint?: RunManifestFingerprint;
  effectiveSandbox?: "none" | "path" | "os";
  totalCost: number; totalInputTokens: number; totalOutputTokens: number;
}

/** A readable pre-R15 record. It is explicitly not verified R13 evidence. */
export interface LegacyRunManifest {
  version: 0; phase: "legacy"; evidenceLimitation: "legacy_unverified";
  id: string; startedAt: string; completedAt?: string; userTask: string; ticketKey?: string;
  featureBranch?: string | null; mainBranch?: string; outcome: LegacyRunOutcome; stories: RunManifestStory[];
  gates: Array<{ name: string; passed: boolean }>;
  reviews: Array<{ round: number; provider: string; model: string; score: number; decision: "approved" | "revision_needed" | "rejected" }>;
  totalCost: number; totalInputTokens: number; totalOutputTokens: number;
}
export type StoredRunManifest = RunManifest | LegacyRunManifest;
export function isActiveRunManifest(manifest: StoredRunManifest): manifest is RunManifest & { phase: "active" } { return manifest.version === RUN_MANIFEST_VERSION && manifest.phase === "active"; }
export function isTerminalRunManifest(manifest: StoredRunManifest): manifest is RunManifest & { phase: "terminal"; completedAt: string; terminalReason: TerminalReason } { return manifest.version === RUN_MANIFEST_VERSION && manifest.phase === "terminal"; }

const boundedString = (max = MAX_SHORT_TEXT) => z.string().min(1).max(max);
const optionalBoundedString = (max = MAX_SHORT_TEXT) => boundedString(max).optional();
const nonNegative = z.number().finite().nonnegative();
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "invalid ISO timestamp")
  .refine((value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, "invalid ISO date");
const safeId = boundedString(128).regex(runIdPattern, "invalid run ID");
const entityId = boundedString(128);
const score = z.number().finite().min(0).max(10);
const storySchema = z.object({ id: entityId, title: boundedString(), persona: boundedString(), provider: optionalBoundedString(), model: optionalBoundedString(), status: z.enum(["completed", "failed", "skipped"]), retryCount: z.number().int().nonnegative(), failureCode: optionalBoundedString(), inputTokens: nonNegative.optional(), outputTokens: nonNegative.optional() }).strict();
const plannedStorySchema = z.object({ id: entityId, title: boundedString(), persona: boundedString() }).strict();
const attemptSchema = z.object({ storyId: entityId, attempt: z.number().int().positive(), status: z.enum(["started", "completed", "failed", "cancelled"]), startedAt: dateString, completedAt: dateString.optional(), failureCode: optionalBoundedString(), provider: optionalBoundedString(), model: optionalBoundedString(), role: optionalBoundedString() }).strict();
const gateSchema = z.object({ id: boundedString(), name: boundedString(), source: z.enum(["static", "required_command", "planner_verification"]), required: z.boolean(), status: z.enum(["passed", "failed", "cancelled"]), passed: z.boolean() }).strict().refine((gate) => gate.passed === (gate.status === "passed"), "gate passed must match status");
const reviewOutcomeSchema = z.object({ kind: z.enum(["approved", "disabled", "revision_needed", "rejected", "revision_exhausted", "revision_declined", "parse_failed", "provider_failed", "timed_out", "cancelled", "unavailable", "unverified"]), approved: z.boolean(), decision: z.enum(["approved", "revision_needed", "rejected"]).optional(), score: score.optional() }).strict().superRefine((outcome, ctx) => {
  if (outcome.approved !== (outcome.kind === "approved")) ctx.addIssue({ code: "custom", message: "review approval must match outcome kind" });
  if (outcome.kind === "approved" && outcome.decision !== undefined && outcome.decision !== "approved") ctx.addIssue({ code: "custom", message: "approved review must have approved decision" });
});
const reviewSchema = z.object({ round: z.number().int().positive(), provider: boundedString(), model: boundedString(), score: score.optional(), decision: z.enum(["approved", "revision_needed", "rejected"]).optional(), outcome: reviewOutcomeSchema, inputTokens: nonNegative.optional(), outputTokens: nonNegative.optional() }).strict().superRefine((review, ctx) => {
  if (review.outcome.kind === "approved" && review.decision !== undefined && review.decision !== "approved") ctx.addIssue({ code: "custom", message: "approved review must have approved decision" });
});
const fingerprintSchema = z.object({ verified: z.boolean(), algorithm: z.literal("sha256").optional(), head: optionalBoundedString(), digest: optionalBoundedString(), reason: optionalBoundedString() }).strict().superRefine((value, ctx) => {
  if (value.verified && (!value.algorithm || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(value.head ?? "") || !/^[0-9a-f]{64}$/i.test(value.digest ?? ""))) ctx.addIssue({ code: "custom", message: "verified fingerprint is incomplete" });
  if (!value.verified && !value.reason) ctx.addIssue({ code: "custom", message: "unverified fingerprint needs a reason" });
});
const currentSchema = z.object({
  version: z.literal(RUN_MANIFEST_VERSION), id: safeId, startedAt: dateString, completedAt: dateString.optional(), phase: z.enum(["active", "terminal"]), terminalReason: z.enum(["success", "partial", "cancelled", "planner_failed", "planning_rejected", "permission_blocked", "required_gate_failed", "review_rejected", "verification_failed", "completion_blocked", "cleanup_failed", "no_progress", "provider_failed", "unknown"]).optional(), priorRunId: safeId.optional(),
  userTask: z.string().max(MAX_TEXT), ticketKey: optionalBoundedString(), featureBranch: z.union([boundedString(), z.null()]).optional(), mainBranch: optionalBoundedString(), outcome: z.enum(["in_progress", "success", "partial", "failed", "cancelled"]),
  stories: z.array(storySchema).max(MAX_ITEMS), plannedStories: z.array(plannedStorySchema).max(MAX_ITEMS), attempts: z.array(attemptSchema).max(MAX_ITEMS), gates: z.array(gateSchema).max(MAX_ITEMS), reviews: z.array(reviewSchema).max(MAX_ITEMS), fingerprint: fingerprintSchema.optional(), effectiveSandbox: z.enum(["none", "path", "os"]).optional(), totalCost: nonNegative, totalInputTokens: nonNegative, totalOutputTokens: nonNegative,
}).strict().superRefine((value, ctx) => {
  if (value.phase === "active" && (value.completedAt || value.terminalReason || value.outcome !== "in_progress")) ctx.addIssue({ code: "custom", message: "active manifests must be in-progress without terminal fields" });
  if (value.phase === "terminal" && (!value.completedAt || !value.terminalReason || value.outcome === "in_progress")) ctx.addIssue({ code: "custom", message: "terminal manifests require completedAt, terminalReason, and a terminal outcome" });
  if (value.completedAt && Date.parse(value.completedAt) < Date.parse(value.startedAt)) ctx.addIssue({ code: "custom", message: "manifest completed before it started" });
  const attempts = new Set<string>();
  for (const attempt of value.attempts) {
    const key = `${attempt.storyId}\u0000${attempt.attempt}`;
    if (attempts.has(key)) ctx.addIssue({ code: "custom", message: "duplicate story attempt" });
    attempts.add(key);
    if (attempt.status === "started" && attempt.completedAt) ctx.addIssue({ code: "custom", message: "started attempt cannot be completed" });
    if (attempt.status !== "started" && !attempt.completedAt) ctx.addIssue({ code: "custom", message: "terminal attempt requires completedAt" });
    if (attempt.completedAt && Date.parse(attempt.completedAt) < Date.parse(attempt.startedAt)) ctx.addIssue({ code: "custom", message: "attempt completed before it started" });
  }
});
const legacySchema = z.object({
  id: safeId, startedAt: dateString, completedAt: dateString.optional(), userTask: z.string().max(MAX_TEXT), ticketKey: optionalBoundedString(), featureBranch: z.union([boundedString(), z.null()]).optional(), mainBranch: optionalBoundedString(), outcome: z.enum(["success", "partial", "failed", "cancelled"]), stories: z.array(storySchema).max(MAX_ITEMS), gates: z.array(z.object({ name: boundedString(), passed: z.boolean(), output: z.string().max(1024 * 1024).optional() }).strict()).max(MAX_ITEMS), reviews: z.array(z.object({ round: z.number().int().positive(), provider: boundedString(), model: boundedString(), score: score, decision: z.enum(["approved", "revision_needed", "rejected"]), inputTokens: nonNegative.optional(), outputTokens: nonNegative.optional() }).strict()).max(MAX_ITEMS), totalCost: nonNegative, totalInputTokens: nonNegative, totalOutputTokens: nonNegative,
}).strict();

function runsDir(cwd?: string): string { return path.join(getProjectRootDir(cwd), "runs"); }
export function isValidRunId(id: string): boolean { return runIdPattern.test(id); }
export function getRunManifestPath(runId: string, cwd?: string): string | null { return isValidRunId(runId) ? path.join(runsDir(cwd), `${runId}.json`) : null; }
export function generateRunId(): string { return `run-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`; }

export function createRunManifest(userTask: string, ticketKey?: string): RunManifest {
  return { version: RUN_MANIFEST_VERSION, id: generateRunId(), startedAt: new Date().toISOString(), phase: "active", userTask: userTask.slice(0, MAX_TEXT), ticketKey, outcome: "in_progress", stories: [], plannedStories: [], attempts: [], gates: [], reviews: [], totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0 };
}

function allowlistedManifest(manifest: RunManifest): RunManifest {
  if (manifest.version !== RUN_MANIFEST_VERSION) throw new Error(`Unsupported run manifest version: ${String(manifest.version)}`);
  return {
    version: manifest.version, id: manifest.id, startedAt: manifest.startedAt, completedAt: manifest.completedAt, phase: manifest.phase, terminalReason: manifest.terminalReason, priorRunId: manifest.priorRunId, userTask: manifest.userTask.slice(0, MAX_TEXT), ticketKey: manifest.ticketKey, featureBranch: manifest.featureBranch, mainBranch: manifest.mainBranch, outcome: manifest.outcome,
    stories: manifest.stories.map(({ id, title, persona, provider, model, status, retryCount, failureCode, inputTokens, outputTokens }) => ({ id, title, persona, provider, model, status, retryCount, failureCode, inputTokens, outputTokens })),
    plannedStories: manifest.plannedStories.map(({ id, title, persona }) => ({ id, title, persona })),
    attempts: manifest.attempts.map(({ storyId, attempt, status, startedAt, completedAt, failureCode, provider, model, role }) => ({ storyId, attempt, status, startedAt, completedAt, failureCode, provider, model, role })),
    gates: manifest.gates.map(({ id, name, source, required, status, passed }) => ({ id, name, source, required, status, passed })),
    reviews: manifest.reviews.map(({ round, provider, model, score, decision, outcome, inputTokens, outputTokens }) => ({ round, provider, model, score, decision, outcome: { kind: outcome.kind, approved: outcome.approved, decision: outcome.decision, score: outcome.score }, inputTokens, outputTokens })),
    fingerprint: manifest.fingerprint ? { verified: manifest.fingerprint.verified, algorithm: manifest.fingerprint.algorithm, head: manifest.fingerprint.head, digest: manifest.fingerprint.digest, reason: manifest.fingerprint.reason } : undefined,
    effectiveSandbox: manifest.effectiveSandbox, totalCost: manifest.totalCost, totalInputTokens: manifest.totalInputTokens, totalOutputTokens: manifest.totalOutputTokens,
  };
}

/** Atomically replace one validated manifest. Persistence errors intentionally reach the caller. */
export function saveRunManifest(manifest: RunManifest, cwd?: string): void {
  const checked = currentSchema.parse(allowlistedManifest(manifest));
  const serialized = `${JSON.stringify(checked, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_MANIFEST_BYTES) throw new Error(`Run manifest ${checked.id} exceeds storage limit`);
  const dir = runsDir(cwd);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = getRunManifestPath(checked.id, cwd);
  if (!target) throw new Error(`Invalid run manifest ID: ${checked.id}`);
  const temp = path.join(dir, `.${checked.id}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temp, "wx", 0o600);
    fs.writeFileSync(descriptor, serialized, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temp, target);
  } catch (error) {
    if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch { /* best effort */ }
    try { fs.unlinkSync(temp); } catch { /* owned temp may not have been created */ }
    throw new Error(`Failed to persist run manifest ${checked.id}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

function parseLoaded(value: unknown): StoredRunManifest | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.version === RUN_MANIFEST_VERSION) { const parsed = currentSchema.safeParse(record); return parsed.success ? parsed.data : null; }
  if (record.version !== undefined) return null;
  const parsed = legacySchema.safeParse(record);
  if (!parsed.success) return null;
  const legacy = parsed.data;
  return { version: 0, phase: "legacy", evidenceLimitation: "legacy_unverified", id: legacy.id, startedAt: legacy.startedAt, completedAt: legacy.completedAt, userTask: legacy.userTask, ticketKey: legacy.ticketKey, featureBranch: legacy.featureBranch, mainBranch: legacy.mainBranch, outcome: legacy.outcome, stories: legacy.stories, gates: legacy.gates.map(({ name, passed }) => ({ name, passed })), reviews: legacy.reviews.map(({ round, provider, model, score, decision }) => ({ round, provider, model, score, decision })), totalCost: legacy.totalCost, totalInputTokens: legacy.totalInputTokens, totalOutputTokens: legacy.totalOutputTokens };
}
function loadPath(filePath: string, expectedId: string): StoredRunManifest | null {
  let descriptor: number | undefined;
  try {
    const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | noFollow);
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.size < 1 || before.size > MAX_MANIFEST_BYTES) return null;
    const bytes = Buffer.allocUnsafe(before.size);
    const read = fs.readSync(descriptor, bytes, 0, before.size, 0);
    const after = fs.fstatSync(descriptor);
    if (read !== before.size || after.size !== before.size || !after.isFile()) return null;
    const manifest = parseLoaded(JSON.parse(bytes.toString("utf8")) as unknown);
    return manifest?.id === expectedId ? manifest : null;
  } catch { return null; }
  finally { if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch { /* no-op */ } }
}
export function loadRunManifest(runId: string, cwd?: string): StoredRunManifest | null { const target = getRunManifestPath(runId, cwd); return target ? loadPath(target, runId) : null; }
/** List valid records newest first; corrupt/unsupported files never break `wm runs`. */
export function listRunManifests(cwd?: string, limit = 20): StoredRunManifest[] {
  if (!Number.isInteger(limit) || limit < 0) return [];
  try {
    const dir = runsDir(cwd);
    const records = fs.readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => ({ file, id: file.slice(0, -".json".length) }))
      .filter(({ id }) => isValidRunId(id))
      .map(({ file, id }) => loadPath(path.join(dir, file), id))
      .filter((manifest): manifest is StoredRunManifest => manifest !== null)
      .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt) || right.id.localeCompare(left.id));
    return records.slice(0, limit);
  } catch { return []; }
}
