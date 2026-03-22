/**
 * Terminal manager — scroll region with pinned bottom prompt/status bar.
 * Content scrolls up. Prompt stays at the bottom. Like Claude Code / vim.
 */

let initialized = false;
let rows = process.stdout.rows || 40;
let cols = process.stdout.columns || 80;

let currentStatusBar = "";

// Store originals BEFORE any patching
const _origWrite = process.stdout.write.bind(process.stdout);
const _origLog = console.log.bind(console);

function raw(s: string): void {
  _origWrite(s);
}

function setScrollRegion(): void {
  const scrollEnd = Math.max(1, rows - 1);  // Reserve last line for status bar
  raw(`\x1b[1;${scrollEnd}r`);
}

function renderStatusBar(): void {
  if (!currentStatusBar) return;
  raw("\x1b[s");  // Save cursor
  raw(`\x1b[${rows};1H`);  // Move to last line
  raw("\x1b[2K");  // Clear line
  raw(currentStatusBar.slice(0, cols));
  raw("\x1b[u");  // Restore cursor
}

/** Enter managed terminal mode */
export function initTerminal(): void {
  if (initialized) return;
  initialized = true;

  rows = process.stdout.rows || 40;
  cols = process.stdout.columns || 80;

  // Enter alternate screen buffer
  raw("\x1b[?1049h");
  raw("\x1b[2J");
  setScrollRegion();
  raw("\x1b[1;1H");

  // Monkey-patch console.log — write to scroll region then re-render status bar
  console.log = (...args: unknown[]) => {
    const text = args.map(a => typeof a === "string" ? a : String(a)).join(" ");
    raw(text + "\n");
    renderStatusBar();
  };

  // Handle resize
  process.stdout.on("resize", () => {
    rows = process.stdout.rows || 40;
    cols = process.stdout.columns || 80;
    setScrollRegion();
    renderStatusBar();
  });
}

/** Update the pinned status bar (bottom line) */
export function setStatusBar(text: string): void {
  currentStatusBar = text;
  if (initialized) renderStatusBar();
}

/** Exit managed terminal mode — restore normal screen */
export function exitTerminal(): void {
  if (!initialized) return;
  initialized = false;

  // Restore console.log
  console.log = _origLog;

  // Reset scroll region
  raw("\x1b[r");
  // Exit alternate screen buffer
  raw("\x1b[?1049l");
}

/** Check if terminal is in managed mode */
export function isManaged(): boolean {
  return initialized;
}
