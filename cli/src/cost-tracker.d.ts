export interface CostEntry {
    persona: string;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
}
export declare class CostTracker {
    private entries;
    addUsage(persona: string, provider: string, model: string, inputTokens: number, outputTokens: number): void;
    getTotalCost(): number;
    getTotalTokens(): number;
    getBreakdown(): CostEntry[];
    getSummary(): string;
}
