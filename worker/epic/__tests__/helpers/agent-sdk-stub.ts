/**
 * Stub for agent-sdk.js to avoid pulling in ai-clients dist chain during tests.
 * The real agent-sdk imports anthropic-agent.ts which requires compiled dist files.
 */
export async function runAgent(_options: unknown): Promise<{ success: boolean; messages: unknown[]; error?: string }> {
  return { success: true, messages: [] };
}
