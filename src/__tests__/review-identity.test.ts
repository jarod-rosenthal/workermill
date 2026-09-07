import { describe, expect, it } from "vitest";
import {
  compareReviewBindings,
  preflightReviewIdentity,
  resolveReviewBinding,
} from "../review-identity.js";
import type { CliConfig } from "../config.js";

const config = (overrides: Partial<CliConfig> = {}): CliConfig => ({
  providers: {
    openai: { model: "gpt-worker", host: "https://api.example.test/v1/" },
    openai_reviewer: { model: "gpt-worker" },
    anthropic: { model: "claude-sonnet-4-6" },
  },
  default: "openai",
  ...overrides,
});

describe("review identity", () => {
  it("resolves aliases to the inherited endpoint and model without a provider call", () => {
    const resolved = resolveReviewBinding(config(), "openai_reviewer");
    expect(resolved.provider).toBe("openai");
    expect(resolved.model).toBe("gpt-worker");
    expect(resolved.endpoint).toBe("https://api.example.test/v1");
    expect(resolved.identity).not.toContain("apiKey");
  });

  it("normalizes hosts while removing credentials and query strings", () => {
    const comparison = compareReviewBindings(
      { provider: "openai", model: "same", host: "https://user:secret@API.Example.test:443/v1/?token=do-not-report" },
      { provider: "openai", model: "same", host: "https://api.example.test/v1" },
    );
    expect(comparison.status).toBe("shared");
    expect(comparison.worker.endpoint).toBe("https://api.example.test/v1");
    expect(JSON.stringify(comparison)).not.toContain("secret");
    expect(JSON.stringify(comparison)).not.toContain("do-not-report");
  });

  it("recognizes different configured endpoint/model identifiers without claiming training independence", () => {
    const comparison = compareReviewBindings(
      { provider: "openai", model: "gpt-worker", host: "https://worker.example.test/v1" },
      { provider: "anthropic", model: "claude-sonnet-4-6" },
    );
    expect(comparison.status).toBe("different");
    expect(comparison.independentTrainingProven).toBe(false);
  });

  it("follows provider-factory host behavior and Google model aliases", () => {
    const googleHostIgnored = compareReviewBindings(
      { provider: "google", model: "gemini-3.1-pro", host: "https://one.example.test" },
      { provider: "google", model: "gemini-3.1-pro-preview", host: "https://two.example.test" },
    );
    expect(googleHostIgnored.status).toBe("shared");

    const anthropicHostIgnored = compareReviewBindings(
      { provider: "anthropic", model: "claude-sonnet-4-6", host: "https://one.example.test" },
      { provider: "anthropic", model: "claude-sonnet-4-6", host: "https://two.example.test" },
    );
    expect(anthropicHostIgnored.status).toBe("shared");
  });

  it("treats unknown identity as unverified and blocks required independence", () => {
    const result = preflightReviewIdentity({
      workers: [{ provider: "unknown", model: "worker" }],
      reviewer: { provider: "unknown", model: "reviewer" },
      requireDifferentModel: true,
    });
    expect(result.status).toBe("unverified");
    expect(result.allowed).toBe(false);
  });

  it("requires every worker binding to differ from the reviewer", () => {
    const result = preflightReviewIdentity({
      config: config({
        providers: {
          openai: { model: "gpt-worker", host: "https://worker.example.test/v1" },
          openai_reviewer: { model: "gpt-reviewer", host: "https://reviewer.example.test/v1" },
          openai_shared: { model: "gpt-reviewer", host: "https://reviewer.example.test/v1" },
        },
        default: "openai",
      }),
      workers: [{ provider: "openai" }, { provider: "openai_shared" }],
      reviewer: "openai_reviewer",
      requireDifferentModel: true,
    });
    expect(result.status).toBe("shared");
    expect(result.allowed).toBe(false);
    expect(result.comparisons).toHaveLength(2);
  });

  it("leaves optional unverified identity allowed", () => {
    const result = preflightReviewIdentity({
      workers: [{ provider: "unknown", model: "worker" }],
      reviewer: { provider: "unknown", model: "reviewer" },
    });
    expect(result.status).toBe("unverified");
    expect(result.allowed).toBe(true);
  });

  it("does not pass required preflight with no worker bindings", () => {
    const result = preflightReviewIdentity({
      workers: [],
      reviewer: { provider: "openai", model: "gpt-reviewer" },
      requireDifferentModel: true,
    });
    expect(result.status).toBe("unverified");
    expect(result.allowed).toBe(false);
  });

  it("treats an invalid explicit endpoint as unverified", () => {
    const result = preflightReviewIdentity({
      workers: [{ provider: "custom", model: "worker", host: "not-a-url" }],
      reviewer: { provider: "custom", model: "reviewer", host: "https://reviewer.example.test/v1" },
      requireDifferentModel: true,
    });
    expect(result.status).toBe("unverified");
    expect(result.allowed).toBe(false);
  });

  it("uses the installed SDK base URL environment endpoint without exposing it", () => {
    const previous = process.env.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = "https://shared.example.test/v1/?token=hidden";
    try {
      const comparison = compareReviewBindings(
        { provider: "anthropic", model: "claude-sonnet-4-6" },
        { provider: "anthropic", model: "claude-sonnet-4-6", host: "https://ignored.example.test" },
      );
      expect(comparison.status).toBe("shared");
      expect(JSON.stringify(comparison)).not.toContain("hidden");
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_BASE_URL;
      else process.env.ANTHROPIC_BASE_URL = previous;
    }
  });
});
