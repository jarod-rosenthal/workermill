import { describe, expect, it } from "vitest";
import { getPrdDecompositionPhaseLabel } from "../prd-decomposition-phases.js";

describe("PRD decomposition phase labels", () => {
  it("matches full-platform labels exactly", () => {
    expect(getPrdDecompositionPhaseLabel()).toBe("Decomposing spec into cards...");
    expect(getPrdDecompositionPhaseLabel("resolving_content")).toBe("Resolving content...");
    expect(getPrdDecompositionPhaseLabel("validating_spec")).toBe("Checking for dependency issues...");
    expect(getPrdDecompositionPhaseLabel("calling_llm")).toBe("Calling LLM...");
    expect(getPrdDecompositionPhaseLabel("streaming")).toBe("Streaming response...");
    expect(getPrdDecompositionPhaseLabel("repairing_spec")).toBe("Repairing spec...");
    expect(getPrdDecompositionPhaseLabel("parsing")).toBe("Parsing JSON...");
    expect(getPrdDecompositionPhaseLabel("creating_board")).toBe("Creating board...");
  });
});
