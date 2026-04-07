import { describe, expect, it } from "vitest";

import { resolveRunModelSelection } from "../run-command.js";
import type { CliConfig } from "../config.js";

describe("resolveRunModelSelection", () => {
  const config: CliConfig = {
    providers: {
      anthropic: { model: "claude-sonnet-4-6", apiKey: "sk-ant" },
      openai: { model: "gpt-5.4", apiKey: "sk-openai" },
    },
    default: "anthropic",
  };

  it("keeps the configured provider and overrides only the model when passed a bare model name", () => {
    expect(resolveRunModelSelection(config, "claude-opus-4-6")).toEqual({
      provider: "anthropic",
      model: "claude-opus-4-6",
    });
  });

  it("supports runtime provider/model overrides without mutating config", () => {
    const result = resolveRunModelSelection(config, "openai/gpt-5.4");

    expect(result).toEqual({
      provider: "openai",
      model: "gpt-5.4",
    });
    expect(config.default).toBe("anthropic");
    expect(config.providers.openai.model).toBe("gpt-5.4");
  });

  it("fails clearly when the override references an unconfigured provider", () => {
    expect(() => resolveRunModelSelection(config, "google/gemini-3.1-pro")).toThrow(
      "Provider google not configured.",
    );
  });
});
