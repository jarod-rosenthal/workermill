import { test, expect } from "@playwright/test";
import { APIClient } from "../../helpers/api-client";
import { detectIntegrations, type IntegrationConfig } from "./helpers/integration-config";
import { ProviderSwitcher } from "./helpers/provider-switcher";
import { cleanupBranches } from "./helpers/github-helpers";
import { createAndWait, getProviderTask, SUCCESS_STATUSES } from "./helpers/task-helpers";

const isLocal = !process.env.BASE_URL;

test.describe("AI Provider Integration", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!isLocal, "Integration tests only run against local stack");

  let api: APIClient;
  let config: IntegrationConfig;
  let switcher: ProviderSwitcher;

  test.beforeAll(async ({ request }) => {
    config = await detectIntegrations(request);
    switcher = new ProviderSwitcher();
    await switcher.saveOriginal();
  });

  test.beforeEach(async ({ request }) => {
    api = new APIClient(request);
  });

  test.afterEach(async () => {
    await switcher.restore();
  });

  test.afterAll(async () => {
    await switcher.restore();
    await switcher.dispose();
    await cleanupBranches("story/int-");
  });

  test("Ollama: full pipeline with qwen3-coder", async () => {
    test.skip(!config.hasOllama, "Ollama not available");
    test.setTimeout(480_000);

    await switcher.switchAIProvider("ollama", "qwen3-coder:30b");
    const task = getProviderTask("ollama");
    const result = await createAndWait(api, task);
    expect(SUCCESS_STATUSES.includes(result.status)).toBeTruthy();
  });

  test("OpenAI: full pipeline", async () => {
    test.skip(!config.hasOpenAI, "OpenAI API key not configured");
    test.setTimeout(480_000);

    await switcher.switchAIProvider("openai", "gpt-5-mini");
    const task = getProviderTask("openai");
    const result = await createAndWait(api, task);
    expect(SUCCESS_STATUSES.includes(result.status)).toBeTruthy();
  });

  test("Google: full pipeline", async () => {
    test.skip(!config.hasGoogle, "Google API key not configured");
    test.setTimeout(480_000);

    await switcher.switchAIProvider("google", "gemini-3-flash-preview");
    const task = getProviderTask("google");
    const result = await createAndWait(api, task);
    expect(SUCCESS_STATUSES.includes(result.status)).toBeTruthy();
  });

  test("Anthropic: full pipeline", async () => {
    test.skip(!config.hasAnthropic, "Anthropic API key not configured");
    test.setTimeout(480_000);

    await switcher.switchAIProvider("anthropic", "claude-haiku-4-5-20251001");
    const task = getProviderTask("anthropic");
    const result = await createAndWait(api, task);
    expect(SUCCESS_STATUSES.includes(result.status)).toBeTruthy();
  });
});
