export declare const name = "git";
export declare const description = "Execute git operations. Supports: status, diff, log, add, commit, branch, checkout, stash. Blocks destructive operations like force-push or reset --hard.";
export declare const parameters: {
    type: "object";
    properties: {
        action: {
            type: "string";
            enum: string[];
            description: string;
        };
        args: {
            type: "string";
            description: string;
        };
    };
    required: readonly ["action"];
};
interface GitParams {
    action: string;
    args?: string;
    cwd?: string;
}
interface GitResult {
    success: boolean;
    output: string;
    error?: string;
}
export declare function execute({ action, args, cwd }: GitParams): Promise<GitResult>;
export {};
