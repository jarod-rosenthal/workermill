export declare function killActiveProcess(): void;
export declare const name = "bash";
export declare const description = "Execute a bash command and return the output. Use for running shell commands, git operations, npm commands, etc.";
export declare const parameters: {
    type: "object";
    properties: {
        command: {
            type: "string";
            description: string;
        };
        cwd: {
            type: "string";
            description: string;
        };
        timeout: {
            type: "number";
            description: string;
        };
    };
    required: readonly ["command"];
};
interface BashParams {
    command: string;
    cwd?: string;
    timeout?: number;
}
interface BashResult {
    success: boolean;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    error?: string;
    duration: number;
}
export declare function execute({ command, cwd, timeout, }: BashParams): Promise<BashResult>;
export {};
