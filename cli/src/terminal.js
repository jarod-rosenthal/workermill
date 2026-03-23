/**
 * Terminal manager — simple status bar above the prompt.
 *
 * No scroll regions, no monkey-patching. Content scrolls normally.
 * Status bar is printed as a line above the readline prompt.
 */
let currentStatusBar = "";
export function initTerminal() {
    // Nothing to do — no scroll regions, no monkey-patching
}
export function setStatusBar(text) {
    currentStatusBar = text;
}
/** Print the status bar line. Called before showing the prompt. */
export function showStatusBar() {
    if (currentStatusBar) {
        process.stdout.write("\n" + currentStatusBar + "\n");
    }
}
export function exitTerminal() {
    // Nothing to clean up
}
export function isManaged() {
    return false;
}
export function getStatusBarText() {
    return currentStatusBar;
}
