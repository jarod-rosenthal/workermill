/**
 * Terminal manager — simple status bar above the prompt.
 *
 * No scroll regions, no monkey-patching. Content scrolls normally.
 * Status bar is printed as a line above the readline prompt.
 */
export declare function initTerminal(): void;
export declare function setStatusBar(text: string): void;
/** Print the status bar line. Called before showing the prompt. */
export declare function showStatusBar(): void;
export declare function exitTerminal(): void;
export declare function isManaged(): boolean;
export declare function getStatusBarText(): string;
