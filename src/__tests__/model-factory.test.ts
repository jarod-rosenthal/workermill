import { describe, expect, it } from "vitest";
import { createModel } from "../engine/model-factory.js";

describe("createModel", () => {
  it("uses the native xAI provider for xai models", () => {
    const model = createModel("xai", "grok-code-fast-1", undefined, undefined, "xai-test-key") as {
      provider?: string;
      modelId?: string;
    };

    expect(model.provider).toBe("xai.chat");
    expect(model.modelId).toBe("grok-code-fast-1");
  });

  it("uses the native OpenRouter provider for openrouter models", () => {
    const model = createModel("openrouter", "openai/gpt-4o-mini", undefined, undefined, "openrouter-test-key") as {
      provider?: string;
      modelId?: string;
    };

    expect(model.provider).toBe("openrouter");
    expect(model.modelId).toBe("openai/gpt-4o-mini");
  });
});
