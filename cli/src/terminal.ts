/**
 * Terminal manager — simple status bar above the prompt.
 *
 * No scroll regions, no monkey-patching. Content scrolls normally.
 * Status bar is printed as a line above the readline prompt.
 */

let currentStatusBar = "";

export function initTerminal(): void {
  // Set a bottom scroll margin so the terminal reserves a few blank rows
  // at the bottom. This keeps content from being jammed against the last line.
  const rows = process.stdout.rows || 40;
  // Reserve 3 rows at the bottom as breathing room
  process.stdout.write(`\x1b[1;${rows - 3}r`);
  // Position cursor at top
  process.stdout.write("\x1b[H");

  process.stdout.on("resize", () => {
    const newRows = process.stdout.rows || 40;
    process.stdout.write(`\x1b[1;${newRows - 3}r`);
  });
}

export function setStatusBar(text: string): void {
  currentStatusBar = text;
}

/** Print the status bar line. Called before showing the prompt.
 *  Adds breathing room so output isn't jammed against the terminal bottom. */
export function showStatusBar(): void {
  if (currentStatusBar) {
    process.stdout.write("\n\n" + currentStatusBar + "\n");
  } else {
    process.stdout.write("\n");
  }
}

export function exitTerminal(): void {
  // Reset scroll margin to full terminal
  process.stdout.write("\x1b[r");
}

export function isManaged(): boolean {
  return false;
}

export function getStatusBarText(): string {
  return currentStatusBar;
}
