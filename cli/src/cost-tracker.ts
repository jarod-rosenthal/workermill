import { getPricingEngine } from "../../api/src/providers/index.js";

export interface CostEntry {
  persona: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
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
    const engine = getPricingEngine(provider);
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
