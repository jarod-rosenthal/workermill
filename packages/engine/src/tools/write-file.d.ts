export declare const name = "write_file";
export declare const description = "Write content to a file. Creates the file if it does not exist, and creates any necessary parent directories. Overwrites existing content.";
export declare const parameters: {
    type: "object";
    properties: {
        path: {
            type: "string";
            description: string;
        };
        content: {
            type: "string";
            description: string;
        };
        encoding: {
            type: "string";
            description: string;
        };
        append: {
            type: "boolean";
            description: string;
        };
    };
    required: readonly ["path", "content"];
};
interface WriteFileParams {
    path: string;
    content: string;
    encoding?: BufferEncoding;
    append?: boolean;
}
interface WriteFileResult {
    success: boolean;
    path?: string;
    size?: number;
    action?: string;
    linesWritten?: number;
    error?: string;
}
export declare function execute({ path: filePath, content, encoding, append, }: WriteFileParams): Promise<WriteFileResult>;
export {};
