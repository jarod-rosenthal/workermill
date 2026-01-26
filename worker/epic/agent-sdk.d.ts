/**
 * Agent SDK Wrapper for Epic Executor
 *
 * Spawns the Claude CLI (@anthropic-ai/claude-code) as a subprocess
 * with streaming JSON output for real tool execution.
 */
import type { ExpertConfig, EpicConfig, StreamMessage, AgentResult } from "./types.js";
export interface AgentOptions {
    prompt: string;
    expertConfig: ExpertConfig;
    repoPath: string;
    storyId: string;
    env?: Record<string, string>;
    onMessage?: (msg: StreamMessage) => void;
}
/**
 * Run an agent with real tool execution via Claude CLI.
 * The agent can Read, Write, Edit files and run Bash commands.
 */
export declare function runAgent(config: EpicConfig, options: AgentOptions): Promise<AgentResult>;
//# sourceMappingURL=agent-sdk.d.ts.map