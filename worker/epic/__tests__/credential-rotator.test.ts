import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "fs";
import path from "path";
import os from "os";
import { CredentialRotator } from "../credential-rotator.js";

let tmpDir: string;

function setupPool(accountCount: number, poolState?: object) {
  const claudeDir = path.join(tmpDir, ".claude");
  const poolDir = path.join(claudeDir, ".credentials-pool");
  mkdirSync(poolDir, { recursive: true });

  for (let i = 0; i < accountCount; i++) {
    writeFileSync(
      path.join(poolDir, `account-${i}.json`),
      JSON.stringify({ token: `token-${i}`, email: `user${i}@test.com` }),
    );
  }

  if (poolState) {
    writeFileSync(
      path.join(poolDir, "pool-state.json"),
      JSON.stringify(poolState),
    );
  }

  return claudeDir;
}

describe("CredentialRotator", () => {
  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `cred-rotator-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // discover
  // ==========================================================================

  describe("discover", () => {
    it("returns 0 when pool directory does not exist", () => {
      const claudeDir = path.join(tmpDir, ".claude-missing");
      const rotator = new CredentialRotator(claudeDir);
      expect(rotator.discover()).toBe(0);
    });

    it("returns 0 when pool directory is empty", () => {
      const claudeDir = path.join(tmpDir, ".claude");
      mkdirSync(path.join(claudeDir, ".credentials-pool"), { recursive: true });
      const rotator = new CredentialRotator(claudeDir);
      expect(rotator.discover()).toBe(0);
    });

    it("finds credential files in the pool directory", () => {
      const claudeDir = setupPool(3);
      const rotator = new CredentialRotator(claudeDir);
      expect(rotator.discover()).toBe(3);
    });

    it("ignores non-account files", () => {
      const claudeDir = setupPool(2);
      const poolDir = path.join(claudeDir, ".credentials-pool");
      writeFileSync(path.join(poolDir, "README.md"), "ignore me");
      writeFileSync(path.join(poolDir, "config.json"), "{}");

      const rotator = new CredentialRotator(claudeDir);
      expect(rotator.discover()).toBe(2);
    });

    it("sorts accounts numerically", () => {
      const claudeDir = path.join(tmpDir, ".claude");
      const poolDir = path.join(claudeDir, ".credentials-pool");
      mkdirSync(poolDir, { recursive: true });

      // Create out of order
      writeFileSync(path.join(poolDir, "account-2.json"), '{"token":"t2"}');
      writeFileSync(path.join(poolDir, "account-0.json"), '{"token":"t0"}');
      writeFileSync(path.join(poolDir, "account-1.json"), '{"token":"t1"}');

      const rotator = new CredentialRotator(claudeDir);
      rotator.discover();

      // After discover, getCurrentLabel should be account-0 (first sorted)
      expect(rotator.getCurrentLabel()).toBe("account-0");
    });

    it("restores active index from pool-state.json", () => {
      const claudeDir = setupPool(3, {
        activeIndex: 2,
        lastRotatedAt: "2026-01-01T00:00:00Z",
        rotationCount: 5,
      });

      const rotator = new CredentialRotator(claudeDir);
      rotator.discover();
      expect(rotator.getCurrentLabel()).toBe("account-2");
    });

    it("wraps active index when state exceeds account count", () => {
      const claudeDir = setupPool(2, {
        activeIndex: 5,
        lastRotatedAt: "2026-01-01T00:00:00Z",
        rotationCount: 10,
      });

      const rotator = new CredentialRotator(claudeDir);
      rotator.discover();
      // 5 % 2 = 1
      expect(rotator.getCurrentLabel()).toBe("account-1");
    });
  });

  // ==========================================================================
  // rotate
  // ==========================================================================

  describe("rotate", () => {
    it("cycles through discovered credentials", () => {
      const claudeDir = setupPool(3);
      const rotator = new CredentialRotator(claudeDir);
      rotator.discover();

      // Start at 0, rotate to 1
      const label1 = rotator.rotate();
      expect(label1).toBe("account-1");

      // Rotate to 2
      const label2 = rotator.rotate();
      expect(label2).toBe("account-2");

      // Wraps back to 0
      const label3 = rotator.rotate();
      expect(label3).toBe("account-0");
    });

    it("copies credential file to .credentials.json", () => {
      const claudeDir = setupPool(2);
      const rotator = new CredentialRotator(claudeDir);
      rotator.discover();

      rotator.rotate(); // moves to account-1
      const credsPath = path.join(claudeDir, ".credentials.json");
      expect(existsSync(credsPath)).toBe(true);

      const content = JSON.parse(readFileSync(credsPath, "utf-8"));
      expect(content.token).toBe("token-1");
    });

    it("updates pool-state.json on rotate", () => {
      const claudeDir = setupPool(2);
      const rotator = new CredentialRotator(claudeDir);
      rotator.discover();

      rotator.rotate();
      const statePath = path.join(claudeDir, ".credentials-pool", "pool-state.json");
      const state = JSON.parse(readFileSync(statePath, "utf-8"));

      expect(state.activeIndex).toBe(1);
      expect(state.rotationCount).toBe(1);
      expect(state.lastRotatedAt).toBeTruthy();
    });

    it("returns current label when only 1 account exists", () => {
      const claudeDir = setupPool(1);
      const rotator = new CredentialRotator(claudeDir);
      rotator.discover();

      const label = rotator.rotate();
      expect(label).toBe("account-0");
    });

    it("auto-discovers if rotate called before discover", () => {
      const claudeDir = setupPool(2);
      const rotator = new CredentialRotator(claudeDir);

      // rotate() calls discover() internally when accounts is empty
      const label = rotator.rotate();
      // With 2 accounts found, it rotates from 0 to 1
      expect(label).toBe("account-1");
    });

    it("returns current label when no pool exists", () => {
      const claudeDir = path.join(tmpDir, ".claude-no-pool");
      mkdirSync(claudeDir, { recursive: true });
      const rotator = new CredentialRotator(claudeDir);

      const label = rotator.rotate();
      expect(label).toBe("account-0");
    });
  });

  // ==========================================================================
  // getCurrentLabel
  // ==========================================================================

  describe("getCurrentLabel", () => {
    it("returns account-0 by default", () => {
      const rotator = new CredentialRotator(path.join(tmpDir, ".claude"));
      expect(rotator.getCurrentLabel()).toBe("account-0");
    });
  });
});
