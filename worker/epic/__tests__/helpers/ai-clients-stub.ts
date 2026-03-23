/**
 * Stub for ai-clients/index.js to avoid pulling in anthropic-agent dist chain during tests.
 */
export function createAIClient(_config: unknown) {
  return {
    provider: "test",
    capabilities: {},
    execute: async () => ({ success: true, messages: [], tokenUsage: { inputTokens: 0, outputTokens: 0 }, modelUsed: "test", markers: {} }),
  };
}

export function createAnthropicAgentClient(_config: unknown) {
  return createAIClient(_config);
}
