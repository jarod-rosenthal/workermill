export interface ProviderConfig {
    model: string;
    apiKey?: string;
    host?: string;
    /** Ollama context window size (num_ctx). Default: 2048 by Ollama. Set to e.g. 65536 for 64K. */
    contextLength?: number;
}
export interface MCPServerConfig {
    command: string;
    args?: string[];
    env?: Record<string, string>;
}
export interface ReviewConfig {
    /** Max review→revise cycles before giving up (default: 2) */
    maxRevisions?: number;
    /** Auto-revise without prompting user (default: false — prompts each time) */
    autoRevise?: boolean;
    /** Score threshold for approval (default: 80) */
    approvalThreshold?: number;
    /** Run separate critic pass on the plan before execution (default: false) */
    useCritic?: boolean;
}
export interface CliConfig {
    providers: Record<string, ProviderConfig>;
    default: string;
    routing?: Record<string, string>;
    mcp?: Record<string, MCPServerConfig>;
    review?: ReviewConfig;
}
export declare function loadConfig(): CliConfig | null;
export declare function saveConfig(config: CliConfig): void;
export declare function loadProjectConfig(): Partial<CliConfig> | null;
export declare function resolveConfig(): CliConfig;
export declare function getProviderForPersona(config: CliConfig, persona?: string): {
    provider: string;
    model: string;
    apiKey?: string;
    host?: string;
    contextLength?: number;
};
