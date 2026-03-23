import readline from "readline";
export declare class PermissionManager {
    private sessionAllow;
    private trustAll;
    private configTrust;
    private rl;
    private cancelCurrentPrompt;
    /** True while rl.question() is active — external line handlers must ignore input */
    questionActive: boolean;
    constructor(trustAll?: boolean, configTrust?: string[]);
    /** Bind to the agent's readline instance so we reuse it for prompts */
    setReadline(rl: readline.Interface): void;
    cancelPrompt(): void;
    checkPermission(toolName: string, toolInput: Record<string, unknown>): Promise<boolean>;
    private promptUser;
    /**
     * Prompt the user with a question. Sets questionActive flag so the
     * agent's line handler knows to ignore this input.
     */
    askUser(prompt: string): Promise<string>;
    private formatToolCall;
}
