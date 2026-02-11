/**
 * AI SDK Text Generation with Tool Support
 *
 * Wraps the Vercel AI SDK to provide tool-enabled text generation for
 * non-Anthropic providers (OpenAI, Google, Ollama). Anthropic planning
 * still uses Claude CLI for tool access (battle-tested, OAuth auth).
 *
 * Tools: glob (file search), read_file (file reading), grep (content search).
 * These match the tools Claude CLI exposes to analysts.
 */

import { generateText as aiGenerateText, tool, stepCountIs } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import type { AIProvider } from "./providers.js";

export interface GenerateWithToolsOptions {
  provider: AIProvider;
  model: string;
  apiKey: string;
  prompt: string;
  systemPrompt?: string;
  workingDir?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  maxSteps?: number;
  /** Enable tool use (glob, read_file, grep). Default: true */
  enableTools?: boolean;
}

/**
 * Create the AI SDK model instance for a given provider.
 */
function createModel(provider: AIProvider, model: string, apiKey: string) {
  switch (provider) {
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey });
      return anthropic(model);
    }
    case "openai": {
      const openai = createOpenAI({ apiKey });
      return openai(model);
    }
    case "google": {
      const google = createGoogleGenerativeAI({ apiKey });
      return google(model);
    }
    case "ollama": {
      // Ollama uses OpenAI-compatible API
      const ollama = createOpenAI({
        baseURL: apiKey || "http://localhost:11434/v1",
        apiKey: "ollama", // Ollama doesn't need a real key
      });
      return ollama(model);
    }
    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
}

// Zod schemas for tool inputs
const globSchema = z.object({
  pattern: z
    .string()
    .describe("Glob pattern like '**/*.ts', 'src/**/*.js', 'package.json'"),
});

const readFileSchema = z.object({
  path: z.string().describe("File path relative to the working directory"),
  limit: z
    .number()
    .optional()
    .describe("Max number of lines to read (default: 500)"),
});

const grepSchema = z.object({
  pattern: z.string().describe("Search pattern (regex supported)"),
  glob: z
    .string()
    .optional()
    .describe("File glob to filter (e.g. '*.ts', '*.py')"),
});

/**
 * Build filesystem tools scoped to a working directory.
 * These are the same tools Claude CLI exposes (Glob, Read, Grep).
 */
function buildTools(workingDir: string) {
  return {
    glob: tool({
      description:
        "Find files matching a glob pattern. Returns file paths relative to the working directory.",
      inputSchema: globSchema,
      execute: async (input: z.infer<typeof globSchema>) => {
        try {
          // Use find as a cross-platform glob (fast-glob not available)
          const result = execSync(
            `find . -path './.git' -prune -o -path './node_modules' -prune -o -name '${input.pattern.replace(/\*\*/g, "*")}' -print 2>/dev/null | head -200`,
            { cwd: workingDir, encoding: "utf-8", timeout: 15000 },
          ).trim();

          if (!result) {
            // Try with a broader approach for ** patterns
            const broader = execSync(
              `find . -path './.git' -prune -o -path './node_modules' -prune -o -type f -print 2>/dev/null | head -500`,
              { cwd: workingDir, encoding: "utf-8", timeout: 15000 },
            ).trim();
            return broader || "No files found";
          }
          return result;
        } catch {
          return "Error running glob search";
        }
      },
    }),

    read_file: tool({
      description: "Read the contents of a file. Returns the file text.",
      inputSchema: readFileSchema,
      execute: async (input: z.infer<typeof readFileSchema>) => {
        try {
          const fullPath = `${workingDir}/${input.path}`.replace(/\/\//g, "/");
          if (!existsSync(fullPath)) {
            return `File not found: ${input.path}`;
          }
          const content = readFileSync(fullPath, "utf-8");
          const lines = content.split("\n");
          const maxLines = input.limit || 500;
          if (lines.length > maxLines) {
            return (
              lines.slice(0, maxLines).join("\n") +
              `\n... (truncated, ${lines.length - maxLines} more lines)`
            );
          }
          return content;
        } catch (err) {
          return `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    grep: tool({
      description:
        "Search for a pattern in files. Returns matching lines with file paths and line numbers.",
      inputSchema: grepSchema,
      execute: async (input: z.infer<typeof grepSchema>) => {
        try {
          const includeFlag = input.glob ? `--include='${input.glob}'` : "";
          const result = execSync(
            `grep -rn ${includeFlag} --exclude-dir=node_modules --exclude-dir=.git '${input.pattern.replace(/'/g, "'\\''")}' . 2>/dev/null | head -100`,
            { cwd: workingDir, encoding: "utf-8", timeout: 15000 },
          ).trim();
          return result || "No matches found";
        } catch {
          return "No matches found";
        }
      },
    }),
  };
}

/**
 * Generate text using the Vercel AI SDK with optional tool support.
 *
 * For providers that support tool calling (OpenAI, Google, Anthropic),
 * the model can use glob/read_file/grep to explore a cloned repo.
 * maxSteps controls how many tool call rounds are allowed.
 */
export async function generateTextWithTools(
  options: GenerateWithToolsOptions,
): Promise<string> {
  const {
    provider,
    model: modelName,
    apiKey,
    prompt,
    systemPrompt,
    workingDir,
    maxTokens = 16384,
    temperature = 0.7,
    timeoutMs = 600_000,
    maxSteps = 15,
    enableTools = true,
  } = options;

  const sdkModel = createModel(provider, modelName, apiKey);

  const tools = enableTools && workingDir ? buildTools(workingDir) : undefined;

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const result = await aiGenerateText({
      model: sdkModel,
      prompt,
      system: systemPrompt,
      maxOutputTokens: maxTokens,
      temperature,
      tools,
      stopWhen: tools ? stepCountIs(maxSteps) : undefined,
      abortSignal: abortController.signal,
    });

    return result.text;
  } finally {
    clearTimeout(timeout);
  }
}
