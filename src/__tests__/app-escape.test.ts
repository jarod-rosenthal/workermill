import { describe, expect, it } from "vitest";
import { decideEscapeAction, shouldRunDeferredRollback } from "../ui/App.js";

describe("ESC handling state machine", () => {
  it("single ESC while running cancels only", () => {
    const decision = decideEscapeAction(2_000, 0, false);
    expect(decision.shouldCancel).toBe(true);
    expect(decision.shouldOfferRollback).toBe(false);
    expect(decision.queueDeferredRollbackOffer).toBe(false);
    expect(decision.nextLastEscAt).toBe(2_000);
  });

  it("double ESC while running queues deferred rollback offer", () => {
    const decision = decideEscapeAction(2_500, 2_000, false);
    expect(decision.shouldCancel).toBe(true);
    expect(decision.queueDeferredRollbackOffer).toBe(true);
    expect(decision.shouldOfferRollback).toBe(false);
  });

  it("double ESC while idle opens rollback offer", () => {
    const decision = decideEscapeAction(2_500, 2_000, true);
    expect(decision.shouldCancel).toBe(false);
    expect(decision.shouldOfferRollback).toBe(true);
    expect(decision.nextLastEscAt).toBe(0);
  });

  it("runs deferred rollback only when idle within window", () => {
    expect(shouldRunDeferredRollback("idle", "", true, 1_000, 2_400)).toBe(true);
    expect(shouldRunDeferredRollback("tool_running", "", true, 1_000, 2_400)).toBe(false);
    expect(shouldRunDeferredRollback("idle", "working", true, 1_000, 2_400)).toBe(false);
    expect(shouldRunDeferredRollback("idle", "", false, 1_000, 2_400)).toBe(false);
    expect(shouldRunDeferredRollback("idle", "", true, 1_000, 3_000)).toBe(false);
  });
});
