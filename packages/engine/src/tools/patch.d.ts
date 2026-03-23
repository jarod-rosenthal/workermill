export declare const name = "patch";
export declare const description: string;
export declare const parameters: {
    type: "object";
    properties: {
        patch_text: {
            type: "string";
            description: string;
        };
    };
    required: readonly ["patch_text"];
};
interface PatchParams {
    patch_text: string;
}
interface PatchResult {
    success: boolean;
    filesModified: string[];
    filesCreated: string[];
    filesDeleted: string[];
    error?: string;
    hint?: string;
}
export declare function execute({ patch_text }: PatchParams): Promise<PatchResult>;
export {};
