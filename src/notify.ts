/**
 * Desktop/terminal notification helpers.
 * Respects config.bell — does nothing when disabled.
 */

import { execSync } from "child_process";
import * as logger from "./logger.js";

/** Ring the terminal bell (BEL character). */
export function terminalBell(): void {
  process.stderr.write("\x07");
}

/**
 * Send a desktop notification if possible, fall back to terminal bell.
 * Best-effort — never throws.
 */
export function notify(title: string, message: string): void {
  try {
    const platform = process.platform;
    if (platform === "darwin") {
      execSync(`osascript -e 'display notification "${message}" with title "${title}"'`, { stdio: "ignore", timeout: 5000 });
    } else if (platform === "linux") {
      execSync(`notify-send "${title}" "${message}" 2>/dev/null || true`, { stdio: "ignore", timeout: 5000 });
    } else if (platform === "win32") {
      // PowerShell toast — best effort
      const ps = `[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); $n=New-Object System.Windows.Forms.NotifyIcon; $n.Icon=[System.Drawing.SystemIcons]::Information; $n.Visible=$true; $n.ShowBalloonTip(5000,'${title}','${message}',[System.Windows.Forms.ToolTipIcon]::Info)`;
      execSync(`powershell -NoProfile -Command "${ps}"`, { stdio: "ignore", timeout: 5000 });
    }
  } catch {
    // Fall back to bell
    terminalBell();
  }
}

/**
 * Notify if bell is enabled in config. Call this at the end of long operations.
 */
export function notifyIfEnabled(bellEnabled: boolean | undefined, title: string, message: string): void {
  if (!bellEnabled) return;
  try {
    notify(title, message);
  } catch (err) {
    logger.debug("Notification failed", { error: err instanceof Error ? err.message : String(err) });
  }
}
