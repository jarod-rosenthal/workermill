import { describe, it, expect } from "vitest";

/**
 * Tests for tool call loop detection.
 *
 * The algorithm (from useAgent.ts):
 *   - After each tool call, push `${name}:${JSON.stringify(input).substring(0, 200)}` to an array
 *   - If array length > LOOP_WINDOW (6), shift oldest entry off
 *   - If array length >= LOOP_THRESHOLD (4), count frequencies
 *   - If any single signature appears >= LOOP_THRESHOLD (4) times, abort
 */

const LOOP_WINDOW = 6;
const LOOP_THRESHOLD = 4;

/**
 * Simulate the loop detection from useAgent.ts.
 * Accepts the full history of signatures (as they would be pushed one-by-one),
 * maintains a sliding window of LOOP_WINDOW, and checks after each push.
 * Returns true if a loop would have been detected at any point.
 */
function detectLoop(signatures: string[]): boolean {
  const window: string[] = [];
  for (const sig of signatures) {
    window.push(sig);
    if (window.length > LOOP_WINDOW) window.shift();
    if (window.length >= LOOP_THRESHOLD) {
      const counts: Record<string, number> = {};
      for (const s of window) counts[s] = (counts[s] || 0) + 1;
      if (Math.max(...Object.values(counts)) >= LOOP_THRESHOLD) {
        return true;
      }
    }
  }
  return false;
}

describe("tool call loop detection", () => {
  it("does not trigger on varied tool calls", () => {
    const sigs = [
      'read_file:{"path":"a.ts"}',
      'glob:{"pattern":"*.ts"}',
      'read_file:{"path":"b.ts"}',
      'edit_file:{"path":"a.ts"}',
      'bash:{"command":"npm test"}',
      'read_file:{"path":"c.ts"}',
    ];
    expect(detectLoop(sigs)).toBe(false);
  });

  it("triggers when same call repeated 4 times consecutively", () => {
    const repeated = 'read_file:{"path":"same.ts"}';
    const sigs = [repeated, repeated, repeated, repeated];
    expect(detectLoop(sigs)).toBe(true);
  });

  it("triggers when same call repeated 4 times in window of 6", () => {
    const repeated = 'read_file:{"path":"same.ts"}';
    const sigs = [
      repeated,
      repeated,
      'glob:{"pattern":"*"}',
      repeated,
      repeated,
    ];
    expect(detectLoop(sigs)).toBe(true);
  });

  it("does not trigger at 3 repeats (below threshold)", () => {
    const repeated = 'bash:{"command":"npm test"}';
    const sigs = [
      repeated,
      'read_file:{"path":"a.ts"}',
      repeated,
      'glob:{"pattern":"*"}',
      repeated,
    ];
    expect(detectLoop(sigs)).toBe(false);
  });

  it("only considers the last 6 calls (window)", () => {
    const old = 'read_file:{"path":"old.ts"}';
    const varied = [
      'glob:{"pattern":"*.ts"}',
      'read_file:{"path":"a.ts"}',
      'edit_file:{"path":"b.ts"}',
      'bash:{"command":"ls"}',
      'read_file:{"path":"c.ts"}',
      'grep:{"pattern":"foo"}',
    ];
    // 4 old calls would trigger, but then 6 varied calls push them out of the window
    const sigs = [old, old, old, old, ...varied];
    // The loop IS detected at push #4 (4x old), but varied calls come after.
    // Since we check after every push, this returns true at the 4th push.
    expect(detectLoop(sigs)).toBe(true);
  });

  it("does not trigger when old repeats are fully outside the window", () => {
    // 3 old calls (not enough to trigger), then 6 varied calls
    const old = 'read_file:{"path":"old.ts"}';
    const varied = [
      'glob:{"pattern":"*.ts"}',
      'read_file:{"path":"a.ts"}',
      'edit_file:{"path":"b.ts"}',
      'bash:{"command":"ls"}',
      'read_file:{"path":"c.ts"}',
      'grep:{"pattern":"foo"}',
    ];
    const sigs = [old, old, old, ...varied];
    expect(detectLoop(sigs)).toBe(false);
  });

  it("detects loop at exactly threshold count within mixed window", () => {
    const repeated = 'bash:{"command":"cat /etc/hosts"}';
    // 6 calls total: repeated appears exactly 4 times
    const sigs = [
      repeated,
      "other:{}",
      repeated,
      repeated,
      "other2:{}",
      repeated,
    ];
    expect(detectLoop(sigs)).toBe(true);
  });

  it("handles empty signature list", () => {
    expect(detectLoop([])).toBe(false);
  });

  it("handles fewer signatures than threshold", () => {
    expect(detectLoop(["a:1", "a:1", "a:1"])).toBe(false);
  });

  it("uses truncated JSON for signature (matches useAgent behavior)", () => {
    // In useAgent, signatures are `${name}:${JSON.stringify(input).substring(0, 200)}`
    const longInput = JSON.stringify({ path: "a".repeat(300) }).substring(
      0,
      200,
    );
    const sig = `read_file:${longInput}`;
    const sigs = [sig, sig, sig, sig];
    expect(detectLoop(sigs)).toBe(true);
  });

  it("detects loop that starts after initial varied calls", () => {
    const varied = 'glob:{"pattern":"*.ts"}';
    const repeated = 'read_file:{"path":"stuck.ts"}';
    // 2 varied, then 4 repeated — loop detected on the 4th repeated
    const sigs = [varied, varied, repeated, repeated, repeated, repeated];
    expect(detectLoop(sigs)).toBe(true);
  });

  it("does not trigger when two different calls each appear 3 times", () => {
    const a = 'read_file:{"path":"a.ts"}';
    const b = 'bash:{"command":"test"}';
    // Window of 6: 3 of each — neither reaches threshold of 4
    const sigs = [a, b, a, b, a, b];
    expect(detectLoop(sigs)).toBe(false);
  });

  it("triggers on 5 identical calls (above threshold)", () => {
    const repeated = 'read_file:{"path":"same.ts"}';
    const sigs = [repeated, "other:{}", repeated, repeated, repeated, repeated];
    expect(detectLoop(sigs)).toBe(true);
  });

  it("triggers on 6 identical calls (full window)", () => {
    const repeated = 'read_file:{"path":"same.ts"}';
    const sigs = [
      repeated,
      repeated,
      repeated,
      repeated,
      repeated,
      repeated,
    ];
    expect(detectLoop(sigs)).toBe(true);
  });
});
