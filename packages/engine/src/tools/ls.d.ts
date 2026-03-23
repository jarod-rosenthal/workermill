export declare const name = "ls";
export declare const description: string;
export declare const parameters: {
    type: "object";
    properties: {
        path: {
            type: "string";
            description: string;
        };
        ignore: {
            type: "array";
            items: {
                type: "string";
            };
            description: string;
        };
        maxDepth: {
            type: "number";
            description: string;
        };
        maxFiles: {
            type: "number";
            description: string;
        };
    };
    required: readonly ["path"];
};
interface LsParams {
    path: string;
    ignore?: string[];
    maxDepth?: number;
    maxFiles?: number;
}
interface LsResult {
    success: boolean;
    tree: string;
    totalFiles: number;
    totalDirs: number;
    truncated: boolean;
    error?: string;
}
export declare function execute({ path: dirPath, ignore, maxDepth, maxFiles, }: LsParams): Promise<LsResult>;
export {};
