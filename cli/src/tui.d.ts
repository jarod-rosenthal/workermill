export declare function incrementToolCount(toolName: string): void;
export declare function printHeader(version: string, provider?: string, model?: string, cwd?: string): void;
export declare function printToolCall(toolName: string, toolInput: Record<string, unknown>): void;
export declare function getPersonaEmoji(persona: string): string;
/**
 * Print tool result — compact format like WorkerMill's worker.
 * Only shows errors and brief summaries, NOT raw file contents.
 */
export declare function printToolResult(toolName: string, result: string): void;
/**
 * Print a WorkerMill-style log line.
 * Format: [emoji persona_slug 🏠] message
 * Matches the exact output from worker/epic/coordinator.ts
 */
export declare function wmLog(persona: string, message: string): void;
/**
 * Write a WorkerMill-style prefix for streaming text.
 * Returns the prefix string so caller can write chunks after it.
 */
export declare function wmLogPrefix(persona: string): string;
/**
 * Print a WorkerMill-style coordinator log line.
 * Format: [coordinator] message
 */
export declare function wmCoordinatorLog(message: string): void;
export declare function printAgentText(text: string): void;
export declare function printError(message: string): void;
export declare function printSuccess(message: string): void;
export declare function printStatusBar(provider: string, model: string, tokens: number, permissionMode: string, cost?: number): string;
