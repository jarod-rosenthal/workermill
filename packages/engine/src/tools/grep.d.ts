interface ContextLine {
    line: number;
    content: string;
}
export declare const name = "grep";
export declare const description = "Search for a pattern in files. Uses regex pattern matching. Returns matching lines with file paths and line numbers.";
export declare const parameters: {
    type: "object";
    properties: {
        pattern: {
            type: "string";
            description: string;
        };
        path: {
            type: "string";
            description: string;
        };
        filePattern: {
            type: "string";
            description: string;
        };
        ignoreCase: {
            type: "boolean";
            description: string;
        };
        contextLines: {
            type: "number";
            description: string;
        };
        maxResults: {
            type: "number";
            description: string;
        };
    };
    required: readonly ["pattern"];
};
interface GrepParams {
    pattern: string;
    path?: string;
    filePattern?: string;
    ignoreCase?: boolean;
    contextLines?: number;
    maxResults?: number;
}
interface GrepMatchEntry {
    line: number;
    content: string;
    before?: ContextLine[];
    after?: ContextLine[];
}
interface GrepResult {
    success: boolean;
    pattern?: string;
    searchPath?: string;
    matchCount?: number;
    fileCount?: number;
    truncated?: boolean;
    results?: Record<string, GrepMatchEntry[]>;
    error?: string;
}
export declare function execute({ pattern, path: searchPath, filePattern, ignoreCase, contextLines, maxResults, }: GrepParams): Promise<GrepResult>;
export {};
