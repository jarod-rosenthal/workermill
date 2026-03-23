export declare const name = "fetch";
export declare const description: string;
export declare const parameters: {
    type: "object";
    properties: {
        url: {
            type: "string";
            description: string;
        };
        format: {
            type: "string";
            enum: string[];
            description: string;
        };
        timeout: {
            type: "number";
            description: string;
        };
    };
    required: readonly ["url"];
};
interface FetchParams {
    url: string;
    format?: "text" | "markdown" | "html";
    timeout?: number;
}
interface FetchResult {
    success: boolean;
    content: string;
    url: string;
    statusCode?: number;
    contentType?: string;
    error?: string;
}
export declare function execute({ url, format, timeout, }: FetchParams): Promise<FetchResult>;
export {};
