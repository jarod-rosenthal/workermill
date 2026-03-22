/**
 * Terminal manager — ANSI scroll region with pinned status bar.
 *
 * NO alternate screen buffer (preserves scrollback).
 * Sets a scroll region so content scrolls up within rows 1 to (height-1).
 * Status bar is rendered at row height, outside the scroll region.
 */

let active = false;
let rows = process.stdout.rows || 40;
let cols = process.stdout.columns || 80;
let currentStatusBar = "";

const _origWrite = process.stdout.write.bind(process.stdout);

function raw(s: string): void {
  _origWrite(s);
}

function applyScrollRegion(): void {
  // Scroll region: rows 1 through (height - 1)
  // Row (height) is reserved for status bar, outside the scroll region
  raw(`\x1b[1;${rows - 1}r`);
}

function renderStatusBar(): void {
  if (!currentStatusBar) return;
  // Save cursor, jump to last row, clear it, render, restore cursor
  raw("\x1b[s");
  raw(`\x1b[${rows};1H`);
  raw("\x1b[2K");
  raw(currentStatusBar.slice(0, cols));
  raw("\x1b[u");
}

export function initTerminal(): void {
  if (active) return;
  active = true;

  rows = process.stdout.rows || 40;
  cols = process.stdout.columns || 80;

  // Clear screen and set up scroll region
  raw("\x1b[2J\x1b[H");
  applyScrollRegion();
  // Position cursor at top of scroll region
  raw("\x1b[1;1H");

  // Monkey-patch console.log to stay in scroll region and refresh status bar
  console.log = (...args: unknown[]) => {
    const text = args.map(a => typeof a === "string" ? a : String(a)).join(" ");
    // Write within scroll region (cursor is already there)
    raw(text + "\n");
    renderStatusBar();
  };

  process.stdout.on("resize", () => {
    rows = process.stdout.rows || 40;
    cols = process.stdout.columns || 80;
    applyScrollRegion();
    renderStatusBar();
  });
}

export function setStatusBar(text: string): void {
  currentStatusBar = text;
  if (active) renderStatusBar();
}

export function exitTerminal(): void {
  if (!active) return;
  active = false;
  // Reset scroll region to full screen
  raw("\x1b[r");
  // Move cursor below status bar
  raw(`\x1b[${rows};1H\n`);
}

export function isManaged(): boolean {
  return active;
}
