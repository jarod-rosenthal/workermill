import { vi } from "vitest";

export interface MockStreamConfig {
  text?: string;
  steps?: Array<{
    text?: string;
    toolCalls?: Array<{ toolName: string; args: Record<string, unknown> }>;
    toolResults?: Array<{ result: unknown }>;
  }>;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export function createMockStreamText(config: MockStreamConfig = {}) {
  return vi.fn(({ onStepFinish }: { onStepFinish?: (step: unknown) => void }) => {
    if (onStepFinish && config.steps) {
      for (const step of config.steps) {
        onStepFinish({
          text: step.text,
          toolCalls: step.toolCalls,
          toolResults: step.toolResults,
        });
      }
    }
    const text = config.text ?? "Done.";
    return {
      textStream: (async function* () { yield text; })(),
      text: Promise.resolve(text),
      totalUsage: Promise.resolve({
        inputTokens: config.usage?.inputTokens ?? 100,
        outputTokens: config.usage?.outputTokens ?? 50,
      }),
    };
  });
}

export function createMockGenerateObject(result: Record<string, unknown>) {
  return vi.fn().mockResolvedValue({ object: result });
}

export function createMockGenerateText(text: string) {
  return vi.fn().mockResolvedValue({ text });
}

export function createMockStepCountIs() {
  return vi.fn().mockReturnValue(() => false);
}
