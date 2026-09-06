import { describe, expect, it } from "vitest";
import { fixture, validateFixture } from "../../evals/tasks/r20-bugfix-batch-config.mjs";

describe("R20a offline fixture", () => {
  it("distinguishes baseline, reference, and incomplete solutions", async () => {
    const result = await validateFixture();
    expect(result.baselineFails).toBe(true);
    expect(result.referencePasses).toBe(true);
    expect(result.incompleteFails).toBe(true);
    // Rejection must exercise the duplicate-key acceptance check, not fail
    // merely because a fixture has a syntax error or cannot start.
    expect(result.outcomes.baseline.code).toBe(3);
    expect(result.outcomes.incomplete.code).toBe(3);
    expect(result.initialRevision).toBe("sha256:355014f38206f2051f1cb2a88a4d4fd88f76114d985e2e6a5233d9515eb26c4f");
    expect(fixture.workspace.network).toBe(false);
    expect(fixture.workspace.writableFiles).toEqual(["src/config.mjs"]);
  });
});
