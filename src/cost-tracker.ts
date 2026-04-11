import { getPricingEngine, hasProvider } from "./provider-registry.js";
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
  return provider; // fallback — getPricingEngine will use its own fallback
}

function normalizeOpenAIModel(model: string): string {
  return model.startsWith("openai/") ? model.slice("openai/".length) : model;
}

function classifyRole(persona: string): UsageRole {
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

  addUsage(
    persona: string,
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number
  ): void {
    const engine = getPricingEngine(resolveBaseProvider(provider));
    const resolvedModel = normalizeOpenAIModel(model);
    const cost = engine.calculateTokenCost(
      { inputTokens, outputTokens, cacheCreationTokens: 0, cacheReadTokens: 0 },
      resolvedModel,
    );

    this.entries.push({
      persona,
      provider,
      model: resolvedModel,
      inputTokens,
      outputTokens,
      cost,
    });

    const running = this.getTotalCost();
    logger.info("Cost tracked", {
      persona, provider, model,
      inputTokens, outputTokens,
      cost: `$${cost.toFixed(4)}`,
      runningTotal: `$${running.toFixed(4)}`,
    });
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

    return lines.join("\n");
  }
}
