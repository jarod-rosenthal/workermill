/**
 * Spec Validation Gate Tests
 *
 * Unit tests for dependency validation parsing, validation function,
 * and repair function. LLM calls are mocked.
 */

import { describe, it, expect } from "vitest";
import {
  parseDependencyWarnings,
  validatePrdDependencies,
  repairPrdDependencies,
} from "./prd-dependency-validator.js";
import type { DependencyWarning } from "./prd-dependency-validator.js";
import type {
  LLMBackend,
  LLMGenerateOptions,
  LLMGenerateResult,
  LLMStreamEvent,
} from "./llm-backend.js";

// ── Helpers ──

function mockBackend(response: string): LLMBackend {
  return {
    async generate(_opts: LLMGenerateOptions): Promise<LLMGenerateResult> {
      return { text: response, usage: { inputTokens: 0, outputTokens: 0 } };
    },
    async *stream(_opts: LLMGenerateOptions): AsyncGenerator<LLMStreamEvent> {
      yield { type: "result", text: response };
    },
  };
}

// ── parseDependencyWarnings ──

describe("parseDependencyWarnings", () => {
  it("parses valid JSON array of warnings", () => {
    const raw = JSON.stringify([
      {
        severity: "error",
        category: "incompatible_versions",
        message: "React 19 is incompatible with React Router v5",
        suggestion: "Upgrade to React Router v6 or v7",
        affectedPackages: ["react@19", "react-router@5"],
      },
    ]);
    const result = parseDependencyWarnings(raw);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("error");
    expect(result[0].category).toBe("incompatible_versions");
    expect(result[0].affectedPackages).toEqual(["react@19", "react-router@5"]);
  });

  it("returns empty array for empty JSON array", () => {
    expect(parseDependencyWarnings("[]")).toEqual([]);
  });

  it("returns empty array for unparseable response", () => {
    expect(parseDependencyWarnings("not json")).toEqual([]);
  });

  it("strips markdown fences before parsing", () => {
    const raw = "```json\n[]\n```";
    expect(parseDependencyWarnings(raw)).toEqual([]);
  });

  it("filters out malformed warning objects", () => {
    const raw = JSON.stringify([
      { severity: "error", category: "missing_dependency", message: "Missing X", suggestion: "Add X", affectedPackages: ["x"] },
      { bad: "object" },
      "not an object",
    ]);
    const result = parseDependencyWarnings(raw);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("missing_dependency");
  });
});

// ── validatePrdDependencies ──

describe("validatePrdDependencies", () => {
  it("returns warnings from LLM response", async () => {
    const warnings = JSON.stringify([
      {
        severity: "warning",
        category: "version_incoherence",
        message: "Node 16 specified but package X requires Node 18+",
        suggestion: "Upgrade to Node 18 or higher",
        affectedPackages: ["package-x@2.0"],
      },
    ]);
    const result = await validatePrdDependencies("some prd", mockBackend(warnings), "test-model");
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("version_incoherence");
  });

  it("returns empty array when LLM says no issues", async () => {
    const result = await validatePrdDependencies("clean prd", mockBackend("[]"), "test-model");
    expect(result).toEqual([]);
  });

  it("returns empty array on LLM failure (fail-open)", async () => {
    const failBackend: LLMBackend = {
      async generate(): Promise<LLMGenerateResult> {
        throw new Error("rate limited");
      },
      async *stream(): AsyncGenerator<LLMStreamEvent> {
        throw new Error("rate limited");
      },
    };
    const result = await validatePrdDependencies("some prd", failBackend, "test-model");
    expect(result).toEqual([]);
  });
});

// ── repairPrdDependencies ──

describe("repairPrdDependencies", () => {
  it("returns fixed spec and unified diff", async () => {
    const original = "# My App\n\nUses react@17 and react-router@5\n";
    const fixed = "# My App\n\nUses react@19 and react-router@7\n";
    const warnings: DependencyWarning[] = [
      {
        severity: "error",
        category: "incompatible_versions",
        message: "React 17 is outdated",
        suggestion: "Upgrade to React 19",
        affectedPackages: ["react@17"],
      },
    ];

    const backend = mockBackend(fixed);
    const result = await repairPrdDependencies(original, warnings, backend, "test-model");

    expect(result.fixedPrd).toBe(fixed);
    expect(result.diff).toContain("react@17");
    expect(result.diff).toContain("react@19");
    expect(result.diff).toContain("---");
    expect(result.diff).toContain("+++");
  });

  it("calls onTextDelta callback for streaming", async () => {
    const original = "old spec";
    const deltas: string[] = [];

    const streamBackend: LLMBackend = {
      async generate(_opts: LLMGenerateOptions): Promise<LLMGenerateResult> {
        return { text: "new spec", usage: { inputTokens: 0, outputTokens: 0 } };
      },
      async *stream(_opts: LLMGenerateOptions): AsyncGenerator<LLMStreamEvent> {
        yield { type: "text_delta", text: "new " };
        yield { type: "text_delta", text: "spec" };
      },
    };

    const result = await repairPrdDependencies(
      original,
      [],
      streamBackend,
      "test-model",
      (text) => deltas.push(text),
    );

    expect(deltas).toEqual(["new ", "spec"]);
    expect(result.fixedPrd).toBe("new spec");
  });
});
