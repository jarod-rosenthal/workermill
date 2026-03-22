/**
 * Terminal manager — pinned status bar at the bottom of the screen.
 * Uses normal terminal (NOT alternate screen) so scrollback works.
 * Status bar is rendered by repositioning cursor to last line.
 */

let rows = process.stdout.rows || 40;
let cols = process.stdout.columns || 80;
let currentStatusBar = "";
let active = false;

const _origWrite = process.stdout.write.bind(process.stdout);

function raw(s: string): void {
  _origWrite(s);
}

/** Start terminal management (just resize tracking + status bar) */
export function initTerminal(): void {
  if (active) return;
  active = true;

  rows = process.stdout.rows || 40;
  cols = process.stdout.columns || 80;

  // Clear screen
  raw("\x1b[2J\x1b[H");

  process.stdout.on("resize", () => {
    rows = process.stdout.rows || 40;
    cols = process.stdout.columns || 80;
  });
}

/** Update the status bar — renders at current position inline */
export function setStatusBar(text: string): void {
  currentStatusBar = text;
}

/** Get the current status bar text (for rendering inline) */
export function getStatusBar(): string {
  return currentStatusBar;
}

/** Clean exit */
export function exitTerminal(): void {
  active = false;
}

export function isManaged(): boolean {
  return active;
}
