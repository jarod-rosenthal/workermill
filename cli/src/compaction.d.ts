import type { LanguageModel } from "ai";
export declare function getContextLimit(model: string): number;
export declare function shouldCompact(totalTokens: number, model: string, configuredContextLength?: number): "none" | "soft" | "hard";
export declare function compactMessages(model: LanguageModel, messages: Array<{
    role: "user" | "assistant";
    content: string;
}>, mode: "soft" | "hard"): Promise<Array<{
    role: "user" | "assistant";
    content: string;
}>>;
