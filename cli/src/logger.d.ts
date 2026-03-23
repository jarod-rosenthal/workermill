export declare function log(level: string, message: string, data?: Record<string, unknown>): void;
export declare function info(message: string, data?: Record<string, unknown>): void;
export declare function error(message: string, data?: Record<string, unknown>): void;
export declare function debug(message: string, data?: Record<string, unknown>): void;
export declare function tool(toolName: string, input: Record<string, unknown>, result?: string): void;
export declare function flush(): void;
