import { streamText, stepCountIs } from "ai";
import type { LanguageModel, tool } from "ai";

export const name = "sub_agent";

export const description =
  "Spawn a read-only sub-agent to explore the codebase. The sub-agent can read files, " +
  "search with glob/grep, and list directories, but cannot write files, edit, or run commands. " +
  "Use this for parallel codebase exploration — understanding architecture, finding patterns, " +
  "or researching how something works before making changes.";

export const parameters = {
  type: "object" as const,
  properties: {
    prompt: {
      type: "string" as const,
      description:
        "A detailed task description for the sub-agent. Be specific about what to look for.",
    },
    maxTurns: {
      type: "number" as const,
      description:
        "Maximum number of tool-use turns (default: 20). Higher values allow deeper exploration.",
    },
  },
  required: ["prompt"] as const,
};

interface SubAgentParams {
  prompt: string;
  maxTurns?: number;
}

interface SubAgentResult {
  success: boolean;
  content: string;
  turnsUsed: number;
  error?: string;
}

export function createSubAgentExecutor(
  model: LanguageModel,
  workingDir: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readOnlyTools: Record<string, any>
) {
  return async function execute({
    prompt,
    maxTurns = 20,
  }: SubAgentParams): Promise<SubAgentResult> {
    try {
      let turnsUsed = 0;
      const stream = streamText({
        model,
        system:
          "You are a codebase exploration agent. You can read files, search for patterns, " +
          "and list directories to understand the codebase. You CANNOT modify any files. " +
          "Provide a thorough, detailed answer to the task you are given. " +
          "Include specific file paths, line numbers, and code snippets in your findings.",
        prompt,
        tools: readOnlyTools,
        stopWhen: stepCountIs(maxTurns),
        abortSignal: AbortSignal.timeout(5 * 60 * 1000),
        onStepFinish() {
          turnsUsed++;
        },
      });

      for await (const _chunk of stream.textStream) {
        // Consume stream to drive execution
      }

      const text = await stream.text;

      return {
        success: true,
        content: text,
        turnsUsed,
      };
    } catch (err) {
      return {
        success: false,
        content: "",
        turnsUsed: 0,
        error: `Sub-agent failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  };
}
