// Prices per 1M tokens (input/output)
const PRICING = {
    // Anthropic (Claude 4.5/4.6)
    "claude-opus-4-6": { input: 15, output: 75 },
    "claude-sonnet-4-6": { input: 3, output: 15 },
    "claude-haiku-4-5": { input: 0.80, output: 4 },
    // OpenAI (GPT-5.x)
    "gpt-5.4": { input: 0.75, output: 4.50 },
    "gpt-5.4-mini": { input: 0.15, output: 0.60 },
    "gpt-5.4-pro": { input: 5, output: 20 },
    "gpt-5.3": { input: 1, output: 5 },
    // Google (Gemini 3.x)
    "gemini-3.1-pro": { input: 1.25, output: 10 },
    "gemini-3.1-flash-lite": { input: 0.15, output: 0.60 },
    // Ollama (free, local)
};
export class CostTracker {
    entries = [];
    addUsage(persona, provider, model, inputTokens, outputTokens) {
        const pricing = PRICING[model] || { input: 0, output: 0 };
        const cost = (inputTokens / 1_000_000) * pricing.input +
            (outputTokens / 1_000_000) * pricing.output;
        this.entries.push({
            persona,
            provider,
            model,
            inputTokens,
            outputTokens,
            cost,
        });
    }
    getTotalCost() {
        return this.entries.reduce((sum, e) => sum + e.cost, 0);
    }
    getTotalTokens() {
        return this.entries.reduce((sum, e) => sum + e.inputTokens + e.outputTokens, 0);
    }
    getBreakdown() {
        return [...this.entries];
    }
    getSummary() {
        const total = this.getTotalCost();
        const totalIn = this.entries.reduce((s, e) => s + e.inputTokens, 0);
        const totalOut = this.entries.reduce((s, e) => s + e.outputTokens, 0);
        const lines = [
            `Session cost: $${total.toFixed(4)} (${totalIn.toLocaleString()} in / ${totalOut.toLocaleString()} out)`,
        ];
        for (const entry of this.entries) {
            lines.push(`  * ${entry.persona}: $${entry.cost.toFixed(4)} (${entry.provider}/${entry.model})`);
        }
        return lines.join("\n");
    }
}
