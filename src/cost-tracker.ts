import { getPricingEngine, hasProvider } from "./provider-registry.js";
import type { ApiPricingState, TokenUsage } from "./providers/types.js";
import { isLocalProvider } from "./provider-capabilities.js";
import * as logger from "./logger.js";

export interface CostEntry {
  persona: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export type UsageRole = "worker" | "planner" | "reviewer";

export interface UsageBucket {
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface ModelUsageSummary extends UsageBucket {
  key: string;
  provider: string;
  model: string;
  roles: UsageRole[];
}

export interface UsageSummary {
  total: UsageBucket;
  byRole: Record<UsageRole, UsageBucket>;
  byModel: ModelUsageSummary[];
}

export interface CallSnapshot {
  /** Stable execution identity. Re-recording this ID is ignored. */
  callId: string;
  persona: string;
  provider: string;
  model: string;
  /** SDK totals, including cached input. Omit when usage was not reported. */
  usage?: Partial<TokenUsage>;
  /** Set false when these otherwise complete subtotals exclude later SDK steps. */
  usageComplete?: boolean;
}

export interface LedgerCall extends CallSnapshot {
  usageState: "reported" | "partial" | "missing";
  pricingState: ApiPricingState;
  /** Estimate for observed tokens only; usageState separately reports gaps. */
  estimatedApiCost?: number;
}

export interface LedgerTotals {
  callCount: number;
  reportedUsageCalls: number;
  partialUsageCalls: number;
  missingUsageCalls: number;
  knownPricingCalls: number;
  unknownPricingCalls: number;
  localApiCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  estimatedApiCost: number;
}

export interface LedgerSnapshot {
  calls: LedgerCall[];
  totals: LedgerTotals;
}

/** Human-readable qualification for an estimate, shared by CLI and Ink views. */
export function formatUsageLedgerLimitation(ledger: LedgerSnapshot | undefined): string {
  if (!ledger) return "";
  const { unknownPricingCalls, partialUsageCalls, missingUsageCalls, localApiCalls } = ledger.totals;
  const parts: string[] = [];
  if (unknownPricingCalls) parts.push(`${unknownPricingCalls} unknown-priced API call(s) excluded`);
  const incomplete = partialUsageCalls + missingUsageCalls;
  if (incomplete) parts.push(`${incomplete} call(s) have incomplete usage`);
  if (localApiCalls) parts.push(`${localApiCalls} local API call(s) are $0 API cost; hardware is unestimated`);
  return parts.length ? `Estimate note: ${parts.join("; ")}.` : "";
}

function createUsageBucket(): UsageBucket {
  return { inputTokens: 0, outputTokens: 0, cost: 0 };
}

export function createEmptyUsageSummary(): UsageSummary {
  return {
    total: createUsageBucket(),
    byRole: {
      worker: createUsageBucket(),
      planner: createUsageBucket(),
      reviewer: createUsageBucket(),
    },
    byModel: [],
  };
}

/**
 * Resolve a config-level provider key (e.g. "openai_planner") to the base
 * provider ID ("openai") that the pricing registry knows about.
 */
function resolveBaseProvider(provider: string): string {
  if (hasProvider(provider)) return provider;
  // Strip _planner, _reviewer, _critic etc. suffix added by setup routing
  const base = provider.replace(/_[a-z]+$/, "");
  if (hasProvider(base)) return base;
  return provider;
}

function normalizeOpenAIModel(model: string): string {
  return model.startsWith("openai/") ? model.slice("openai/".length) : model;
}

function validateUsage(usage: Partial<TokenUsage>): Partial<TokenUsage> {
  const values: Array<[keyof TokenUsage, number | undefined]> = [
    ["inputTokens", usage.inputTokens],
    ["outputTokens", usage.outputTokens],
    ["cacheCreationTokens", usage.cacheCreationTokens],
    ["cacheReadTokens", usage.cacheReadTokens],
  ];
  for (const [name, value] of values) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new Error(`Reported ${name} must be a finite non-negative number`);
    }
  }
  return { ...usage };
}

function hasCompleteUsage(usage: Partial<TokenUsage>): usage is TokenUsage {
  return usage.inputTokens !== undefined && usage.outputTokens !== undefined;
}

function calculateKnownCost(usage: TokenUsage, rates: {
  inputRate: number;
  outputRate: number;
  cacheWriteRate?: number;
  cacheReadRate?: number;
}): number {
  // SDK inputTokens already includes cache reads/writes. Charge each token
  // once; when no cache rate is registered retain the ordinary input rate.
  const cacheWrites = rates.cacheWriteRate === undefined ? 0 : usage.cacheCreationTokens ?? 0;
  const cacheReads = rates.cacheReadRate === undefined ? 0 : usage.cacheReadTokens ?? 0;
  const ordinaryInput = Math.max(0, usage.inputTokens - cacheWrites - cacheReads);
  return (ordinaryInput / 1000) * rates.inputRate
    + (usage.outputTokens / 1000) * rates.outputRate
    + ((usage.cacheCreationTokens ?? 0) / 1000) * (rates.cacheWriteRate ?? 0)
    + ((usage.cacheReadTokens ?? 0) / 1000) * (rates.cacheReadRate ?? 0);
}

/** Map all runtime persona spellings into the persisted session role buckets. */
export function classifyRole(persona: string): UsageRole {
  const normalized = persona.toLowerCase();
  if (normalized.includes("planner")) return "planner";
  if (
    normalized.includes("reviewer") ||
    normalized.includes("tech_lead") ||
    normalized.includes("tech lead") ||
    normalized.includes("critic")
  ) {
    return "reviewer";
  }
  return "worker";
}

export class CostTracker {
  private entries: CostEntry[] = [];
  private calls: LedgerCall[] = [];
  private callIds = new Set<string>();
  private legacyCallNumber = 0;

  /**
   * Record one provider call. `callId` makes retries and callback replays safe:
   * the first observation wins and later observations return false.
   */
  recordCall(snapshot: CallSnapshot): boolean {
    if (!snapshot.callId) throw new Error("Call ID is required");
    if (this.callIds.has(snapshot.callId)) return false;

    const usage = snapshot.usage === undefined ? undefined : validateUsage(snapshot.usage);
    const usageState = usage === undefined
      ? "missing"
      : hasCompleteUsage(usage) && snapshot.usageComplete !== false ? "reported" : "partial";
    const resolvedProvider = resolveBaseProvider(snapshot.provider);
    const resolvedModel = normalizeOpenAIModel(snapshot.model);
    const local = isLocalProvider(resolvedProvider);
    const engine = hasProvider(resolvedProvider) ? getPricingEngine(resolvedProvider) : undefined;
    const modelInfo = engine?.getModelInfo(resolvedModel);
    const pricingState: ApiPricingState = local ? "local" : modelInfo ? "known" : "unknown";
    const estimatedApiCost = !usage || (usage.inputTokens === undefined && usage.outputTokens === undefined
      && usage.cacheCreationTokens === undefined && usage.cacheReadTokens === undefined)
      ? undefined
      : pricingState === "local"
        ? 0
        : pricingState === "known"
          ? calculateKnownCost({ ...usage, inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 }, modelInfo!)
          : undefined;
    const call: LedgerCall = {
      callId: snapshot.callId,
      persona: snapshot.persona,
      provider: snapshot.provider,
      model: resolvedModel,
      usage,
      ...(snapshot.usageComplete === undefined ? {} : { usageComplete: snapshot.usageComplete }),
      usageState,
      pricingState,
      ...(estimatedApiCost === undefined ? {} : { estimatedApiCost }),
    };
    this.callIds.add(snapshot.callId);
    this.calls.push(call);

    if (usage) {
      this.entries.push({
        persona: call.persona,
        provider: call.provider,
        model: call.model,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        // The legacy numeric summaries remain a known-cost subtotal. The
        // ledger exposes unknown and incomplete observations explicitly.
        cost: estimatedApiCost ?? 0,
      });
    }

    logger.info("Cost call tracked", {
      callId: call.callId,
      persona: call.persona,
      provider: call.provider,
      model: call.model,
      usageState: call.usageState,
      pricingState: call.pricingState,
      estimatedApiCost: estimatedApiCost === undefined ? "unknown" : `$${estimatedApiCost.toFixed(4)}`,
    });
    return true;
  }

  addUsage(
    persona: string,
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number
  ): void {
    this.recordCall({
      callId: `legacy-${++this.legacyCallNumber}`,
      persona,
      provider,
      model,
      usage: { inputTokens, outputTokens },
    });
  }

  getLedgerSnapshot(): LedgerSnapshot {
    const totals: LedgerTotals = {
      callCount: this.calls.length, reportedUsageCalls: 0, partialUsageCalls: 0, missingUsageCalls: 0,
      knownPricingCalls: 0, unknownPricingCalls: 0, localApiCalls: 0,
      inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
      estimatedApiCost: 0,
    };
    for (const call of this.calls) {
      if (call.usageState === "reported") totals.reportedUsageCalls += 1;
      else if (call.usageState === "partial") totals.partialUsageCalls += 1;
      else totals.missingUsageCalls += 1;
      if (call.pricingState === "known") totals.knownPricingCalls += 1;
      else if (call.pricingState === "local") totals.localApiCalls += 1;
      else totals.unknownPricingCalls += 1;
      if (call.usage) {
        totals.inputTokens += call.usage.inputTokens ?? 0;
        totals.outputTokens += call.usage.outputTokens ?? 0;
        totals.cacheCreationTokens += call.usage.cacheCreationTokens ?? 0;
        totals.cacheReadTokens += call.usage.cacheReadTokens ?? 0;
      }
      totals.estimatedApiCost += call.estimatedApiCost ?? 0;
    }
    return { calls: this.calls.map((call) => ({ ...call, usage: call.usage && { ...call.usage } })), totals };
  }

  getTotalCost(): number {
    return this.entries.reduce((sum, e) => sum + e.cost, 0);
  }

  getTotalTokens(): number {
    return this.entries.reduce(
      (sum, e) => sum + e.inputTokens + e.outputTokens,
      0
    );
  }

  getBreakdown(): CostEntry[] {
    return [...this.entries];
  }

  getUsageSummary(): UsageSummary {
    const summary = createEmptyUsageSummary();
    const modelMap = new Map<string, { entry: ModelUsageSummary; roleSet: Set<UsageRole> }>();

    for (const entry of this.entries) {
      summary.total.inputTokens += entry.inputTokens;
      summary.total.outputTokens += entry.outputTokens;
      summary.total.cost += entry.cost;

      const role = classifyRole(entry.persona);
      summary.byRole[role].inputTokens += entry.inputTokens;
      summary.byRole[role].outputTokens += entry.outputTokens;
      summary.byRole[role].cost += entry.cost;

      const key = `${entry.provider}/${entry.model}`;
      const existing = modelMap.get(key);
      if (!existing) {
        modelMap.set(key, {
          entry: {
            key,
            provider: entry.provider,
            model: entry.model,
            inputTokens: entry.inputTokens,
            outputTokens: entry.outputTokens,
            cost: entry.cost,
            roles: [role],
          },
          roleSet: new Set<UsageRole>([role]),
        });
      } else {
        existing.entry.inputTokens += entry.inputTokens;
        existing.entry.outputTokens += entry.outputTokens;
        existing.entry.cost += entry.cost;
        existing.roleSet.add(role);
      }
    }

    summary.byModel = [...modelMap.values()]
      .map((v) => ({ ...v.entry, roles: [...v.roleSet.values()] }))
      .sort((a, b) => b.cost - a.cost);

    return summary;
  }

  getSummary(): string {
    const summary = this.getUsageSummary();
    const total = summary.total.cost;
    const totalIn = summary.total.inputTokens;
    const totalOut = summary.total.outputTokens;

    const lines = [
      `Session cost (est.): ~$${total.toFixed(2)} (${totalIn.toLocaleString()} in / ${totalOut.toLocaleString()} out)`,
    ];

    for (const entry of this.entries) {
      lines.push(
        `  * ${entry.persona}: ~$${entry.cost.toFixed(2)} (${entry.provider}/${entry.model})`
      );
    }

    const ledger = this.getLedgerSnapshot().totals;
    if (ledger.unknownPricingCalls || ledger.partialUsageCalls || ledger.missingUsageCalls) {
      lines.push(
        `  Note: subtotal excludes ${ledger.unknownPricingCalls} call(s) with unknown pricing; ${ledger.partialUsageCalls + ledger.missingUsageCalls} call(s) have incomplete or missing usage. Only observed tokens are included.`,
      );
    }

    return lines.join("\n");
  }
}
