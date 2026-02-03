/**
 * Manager Agent SDK - Re-exports from Epic with manager-specific defaults
 *
 * This module re-exports the unified agent SDK from epic/agent-sdk.ts
 * and provides a helper to convert ManagerConfig to the generic format.
 */

export { runAgent, type GenericAgentConfig } from "../epic/agent-sdk.js";
export type { AgentOptions, AgentResult, StreamMessage } from "../epic/agent-sdk.js";

import type { ManagerConfig } from "./types.js";
import type { GenericAgentConfig } from "../epic/agent-sdk.js";

/**
 * Convert ManagerConfig to GenericAgentConfig for use with runAgent.
 *
 * Manager mode uses "greatest" token reporting because it's a single
 * Claude session (unlike Epic which runs multiple stories).
 */
export function createManagerAgentConfig(config: ManagerConfig): GenericAgentConfig {
  return {
    taskId: config.taskId,
    apiBaseUrl: config.apiBaseUrl,
    orgApiKey: config.orgApiKey,
    anthropicApiKey: config.anthropicApiKey,
    githubToken: config.githubToken,
    targetRepo: config.githubRepo,
    logPrefix: "[Manager]",
    tokenReportMode: "greatest",
  };
}
