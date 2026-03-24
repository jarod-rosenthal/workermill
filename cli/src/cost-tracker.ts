import { getPricingEngine, hasProvider } from "../../api/src/providers/index.js";

export interface CostEntry {
  persona: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
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
    const cost = engine.calculateTokenCost(
      { inputTokens, outputTokens, cacheCreationTokens: 0, cacheReadTokens: 0 },
      model,
    );

    this.entries.push({
      persona,
      provider,
      model,
      inputTokens,
      outputTokens,
      cost,
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

  getSummary(): string {
    const total = this.getTotalCost();
    const totalIn = this.entries.reduce((s, e) => s + e.inputTokens, 0);
    const totalOut = this.entries.reduce((s, e) => s + e.outputTokens, 0);

    const lines = [
      `Session cost: $${total.toFixed(4)} (${totalIn.toLocaleString()} in / ${totalOut.toLocaleString()} out)`,
    ];

    for (const entry of this.entries) {
      lines.push(
        `  * ${entry.persona}: $${entry.cost.toFixed(4)} (${entry.provider}/${entry.model})`
      );
    }

    return lines.join("\n");
  }
}
