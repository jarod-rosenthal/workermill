import type { CliConfig } from "./config.js";
export interface Story {
    id: string;
    title: string;
    persona: string;
    description: string;
    dependsOn?: string[];
}
export declare function classifyComplexity(config: CliConfig, userInput: string): Promise<{
    isMulti: boolean;
    reason: string;
}>;
export declare function runOrchestration(config: CliConfig, userTask: string, trustAll: boolean, sandboxed?: boolean, agentRl?: import("readline").Interface): Promise<void>;
