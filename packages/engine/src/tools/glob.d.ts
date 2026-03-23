export declare const name = "glob";
export declare const description = "Find files matching a glob pattern. Supports patterns like \"**/*.ts\", \"src/**/*.js\", \"*.{ts,tsx}\". Excludes node_modules and hidden files by default.";
export declare const parameters: {
    type: "object";
    properties: {
        pattern: {
            type: "string";
            description: string;
        };
        cwd: {
            type: "string";
            description: string;
        };
        maxResults: {
            type: "number";
            description: string;
        };
        includeHidden: {
            type: "boolean";
            description: string;
        };
    };
    required: readonly ["pattern"];
};
interface GlobParams {
    pattern: string;
    cwd?: string;
    maxResults?: number;
    includeHidden?: boolean;
}
interface GlobResult {
    success: boolean;
    pattern?: string;
    cwd?: string;
    matches?: string[];
    absolutePaths?: string[];
    count?: number;
    truncated?: boolean;
    error?: string;
}
export declare function execute({ pattern, cwd, maxResults, includeHidden, }: GlobParams): Promise<GlobResult>;
export {};
