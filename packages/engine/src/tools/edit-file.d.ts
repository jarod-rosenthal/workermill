export declare const name = "edit_file";
export declare const description = "Edit a file by finding and replacing text. The old_string must be unique in the file (or use replaceAll for multiple occurrences). Use this instead of write_file when making targeted changes to existing files.";
export declare const parameters: {
    type: "object";
    properties: {
        path: {
            type: "string";
            description: string;
        };
        old_string: {
            type: "string";
            description: string;
        };
        new_string: {
            type: "string";
            description: string;
        };
        replaceAll: {
            type: "boolean";
            description: string;
        };
    };
    required: readonly ["path", "old_string", "new_string"];
};
interface EditFileParams {
    path: string;
    old_string: string;
    new_string: string;
    replaceAll?: boolean;
}
interface EditFileResult {
    success: boolean;
    path?: string;
    replacements?: number;
    linesBefore?: number;
    linesAfter?: number;
    linesDiff?: string;
    error?: string;
    hint?: string;
    filePreview?: string;
    occurrences?: number;
}
export declare function execute({ path: filePath, old_string, new_string, replaceAll, }: EditFileParams): Promise<EditFileResult>;
export {};
