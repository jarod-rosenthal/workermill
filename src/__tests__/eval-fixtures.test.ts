import { describe, expect, it } from "vitest";
import { validateFixture } from "../../evals/tasks/r20-bugfix-batch-config.mjs";

describe("R20a offline fixture", () => {
  it("distinguishes baseline, reference, and incomplete solutions", async () => {
    const result = await validateFixture();
    expect(result.baselineFails).toBe(true);
    expect(result.referencePasses).toBe(true);
    expect(result.incompleteFails).toBe(true);
    expect(result.initialRevision).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
