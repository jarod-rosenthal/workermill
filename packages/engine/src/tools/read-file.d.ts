export declare const name = "read_file";
export declare const description = "Read the contents of a file. Returns the file content as a string. Supports text files of any type.";
export declare const parameters: {
    type: "object";
    properties: {
        path: {
            type: "string";
            description: string;
        };
        encoding: {
            type: "string";
            description: string;
        };
        maxLines: {
            type: "number";
            description: string;
        };
        startLine: {
            type: "number";
            description: string;
        };
    };
    required: readonly ["path"];
};
interface ReadFileParams {
    path: string;
    encoding?: BufferEncoding;
    maxLines?: number;
    startLine?: number;
}
interface ReadFileResult {
    success: boolean;
    content?: string;
    path?: string;
    totalLines?: number;
    linesReturned?: number;
    startLine?: number;
    endLine?: number;
    size?: number;
    error?: string;
}
export declare function execute({ path: filePath, encoding, maxLines, startLine, }: ReadFileParams): Promise<ReadFileResult>;
export {};
