/**
 * Credential Rotator for Claude Max Account Pool
 *
 * Manages rotating between multiple Claude Max subscription credentials
 * when rate limits are hit. Works via the bind-mounted ~/.claude directory
 * so writes inside the container update the host file instantly.
 *
 * Pool structure:
 *   ~/.claude/.credentials-pool/
 *     account-0.json    ← first Max plan
 *     account-1.json    ← second Max plan
 *     pool-state.json   ← { activeIndex, lastRotatedAt, rotationCount }
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, copyFileSync } from "fs";
import path from "path";

interface PoolState {
  activeIndex: number;
  lastRotatedAt: string;
  rotationCount: number;
}

export class CredentialRotator {
  private poolDir: string;
  private credsPath: string;
  private accounts: string[] = [];
  private activeIndex = 0;

  constructor(claudeDir?: string) {
    const base = claudeDir || path.join(process.env.HOME || "/home/worker", ".claude");
    this.poolDir = path.join(base, ".credentials-pool");
    this.credsPath = path.join(base, ".credentials.json");
  }

  /**
   * Discover account files in the pool directory.
   * Returns the number of accounts found.
   */
  discover(): number {
    if (!existsSync(this.poolDir)) {
      return 0;
    }

    const files = readdirSync(this.poolDir)
      .filter((f) => /^account-\d+\.json$/.test(f))
      .sort((a, b) => {
        const indexA = parseInt(a.match(/\d+/)![0], 10);
        const indexB = parseInt(b.match(/\d+/)![0], 10);
        return indexA - indexB;
      });

    this.accounts = files.map((f) => path.join(this.poolDir, f));

    // Load existing state
    const statePath = path.join(this.poolDir, "pool-state.json");
    if (existsSync(statePath)) {
      try {
        const state: PoolState = JSON.parse(readFileSync(statePath, "utf-8"));
        this.activeIndex = state.activeIndex % this.accounts.length;
      } catch {
        this.activeIndex = 0;
      }
    }

    return this.accounts.length;
  }

  /**
   * Rotate to the next account in the pool.
   * Copies the next account's credentials to .credentials.json.
   * Returns a label like "account-1" for logging.
   *
   * If only 1 account (or no pool), logs warning and returns current label.
   */
  rotate(): string {
    if (this.accounts.length === 0) {
      this.discover();
    }

    if (this.accounts.length <= 1) {
      console.log("[CredentialRotator] Only 1 account (or no pool) — cannot rotate, will retry same account");
      return this.getCurrentLabel();
    }

    // Move to next account
    this.activeIndex = (this.activeIndex + 1) % this.accounts.length;
    const accountFile = this.accounts[this.activeIndex];

    // Copy account credentials to active credentials file
    copyFileSync(accountFile, this.credsPath);

    // Update pool state
    const state: PoolState = {
      activeIndex: this.activeIndex,
      lastRotatedAt: new Date().toISOString(),
      rotationCount: this.getRotationCount() + 1,
    };
    writeFileSync(path.join(this.poolDir, "pool-state.json"), JSON.stringify(state, null, 2));

    const label = `account-${this.activeIndex}`;
    console.log(`[CredentialRotator] Rotated to ${label}`);
    return label;
  }

  /**
   * Get the label of the currently active account.
   */
  getCurrentLabel(): string {
    return `account-${this.activeIndex}`;
  }

  private getRotationCount(): number {
    const statePath = path.join(this.poolDir, "pool-state.json");
    if (!existsSync(statePath)) return 0;
    try {
      const state: PoolState = JSON.parse(readFileSync(statePath, "utf-8"));
      return state.rotationCount || 0;
    } catch {
      return 0;
    }
  }
}
