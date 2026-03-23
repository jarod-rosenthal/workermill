import type { LanguageModel } from "ai";
export declare const name = "sub_agent";
export declare const description: string;
export declare const parameters: {
    type: "object";
    properties: {
        prompt: {
            type: "string";
            description: string;
        };
        maxTurns: {
            type: "number";
            description: string;
        };
    };
    required: readonly ["prompt"];
};
interface SubAgentParams {
    prompt: string;
    maxTurns?: number;
}
interface SubAgentResult {
    success: boolean;
    content: string;
    turnsUsed: number;
    error?: string;
}
export declare function createSubAgentExecutor(model: LanguageModel, workingDir: string, readOnlyTools: Record<string, any>): ({ prompt, maxTurns, }: SubAgentParams) => Promise<SubAgentResult>;
export {};
