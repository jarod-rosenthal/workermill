import chalk from "chalk";
import ora from "ora";
import { streamText, generateObject, stepCountIs, type ToolSet } from "ai";
import { z } from "zod";
import { createModel } from "../../packages/engine/src/model-factory.js";
import { createToolDefinitions } from "../../packages/engine/src/tools/index.js";
import type { AIProvider } from "../../packages/engine/src/types.js";
import { loadPersona } from "./personas.js";
import { CostTracker } from "./cost-tracker.js";
import { PermissionManager } from "./permissions.js";
import { printToolCall, printToolResult, printError } from "./tui.js";
import type { CliConfig } from "./config.js";
import { getProviderForPersona } from "./config.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyToolDef = any;

export interface Story {
  title: string;
  persona: string;
  description: string;
  dependsOn?: number[];
}

interface SharedContext {
  filesCreated: string[];
  filesModified: string[];
  decisions: string[];
  learnings: string[];
}

export async function classifyComplexity(
  config: CliConfig,
  userInput: string
): Promise<{ isMulti: boolean; stories?: Story[]; reason: string }> {
  const { provider, model: modelName, apiKey, host } = getProviderForPersona(config);

  // Set API key
  if (apiKey) {
    const envMap: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_API_KEY" };
    const envVar = envMap[provider];
    if (envVar && !process.env[envVar]) process.env[envVar] = apiKey;
  }

  const model = createModel(provider as AIProvider, modelName, host);

  try {
    const result = await generateObject({
      model,
      schema: z.object({
        complexity: z.enum(["single", "multi"]),
        reason: z.string(),
        stories: z.array(z.object({
          title: z.string(),
          persona: z.string(),
          description: z.string(),
          dependsOn: z.array(z.number()).optional(),
        })).optional(),
      }),
      prompt: `Analyze this coding task. If it involves multiple distinct concerns that would benefit from different specialist personas working sequentially, classify as "multi" and provide a story breakdown with persona assignments. Otherwise classify as "single".

Available personas: architect, backend_developer, frontend_developer, fullstack_developer, devops_engineer, qa_engineer, security_engineer, database_engineer, mobile_developer, data_engineer, ml_engineer

Task:
${userInput}`,
    });

    return {
      isMulti: result.object.complexity === "multi",
      stories: result.object.stories,
      reason: result.object.reason,
    };
  } catch {
    // Fallback for providers without structured output (Ollama)
    return { isMulti: false, reason: "Could not classify — defaulting to single agent" };
  }
}

export async function runOrchestration(
  config: CliConfig,
  stories: Story[],
  trustAll: boolean
): Promise<void> {
  const costTracker = new CostTracker();
  const context: SharedContext = {
    filesCreated: [],
    filesModified: [],
    decisions: [],
    learnings: [],
  };
  const permissions = new PermissionManager(trustAll);
  const workingDir = process.cwd();

  console.log();
  console.log(chalk.bold(`  Plan: ${stories.length} stories`));
  console.log();

  for (let i = 0; i < stories.length; i++) {
    const story = stories[i];
    const persona = loadPersona(story.persona);
    if (!persona) {
      printError(`Unknown persona: ${story.persona}`);
      continue;
    }

    // Resolve provider for this persona
    const { provider, model: modelName, apiKey, host } = getProviderForPersona(
      config,
      persona.provider || story.persona
    );

    // Set API key
    if (apiKey) {
      const envMap: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_API_KEY" };
      const envVar = envMap[provider];
      if (envVar && !process.env[envVar]) process.env[envVar] = apiKey;
    }

    const spinner = ora({
      text: chalk.white(`Story ${i + 1}/${stories.length} — ${persona.name} — ${story.title}`),
      prefixText: "  ",
    }).start();

    const model = createModel(provider as AIProvider, modelName, host);

    // Build tools filtered by persona's allowed tools
    const allTools = createToolDefinitions(workingDir, model);
    const personaTools: Record<string, AnyToolDef> = {};
    for (const toolName of persona.tools) {
      const toolDef = allTools[toolName as keyof typeof allTools] as AnyToolDef;
      if (toolDef) {
        personaTools[toolName] = {
          ...toolDef,
          execute: async (input: Record<string, unknown>) => {
            const allowed = await permissions.checkPermission(toolName, input);
            if (!allowed) return "Tool execution denied by user.";
            spinner.stop();
            printToolCall(toolName, input);
            const result = await toolDef.execute(input);
            const resultStr = typeof result === "string" ? result : JSON.stringify(result);
            printToolResult(toolName, resultStr);
            spinner.start();
            return result;
          },
        };
      }
    }

    // Build system prompt with context from prior stories
    const contextParts: string[] = [];
    if (context.filesCreated.length > 0) {
      contextParts.push(`Files created: ${context.filesCreated.join(", ")}`);
    }
    if (context.filesModified.length > 0) {
      contextParts.push(`Files modified: ${context.filesModified.join(", ")}`);
    }
    if (context.decisions.length > 0) {
      contextParts.push(`Decisions: ${context.decisions.join("; ")}`);
    }
    if (context.learnings.length > 0) {
      contextParts.push(`Learnings: ${context.learnings.join("; ")}`);
    }

    const contextBlock = contextParts.length > 0
      ? `\n\n## Context from prior experts\n${contextParts.join("\n")}`
      : "";

    const systemPrompt = `${persona.systemPrompt}${contextBlock}

Working directory: ${workingDir}

Your task: ${story.description}

When you make a decision that affects other parts of the system, include ::decision:: markers in your output.
When you learn something useful, include ::learning:: markers.
When you create a file, include ::file_created::path markers.
When you modify a file, include ::file_modified::path markers.`;

    try {
      const stream = streamText({
        model,
        system: systemPrompt,
        prompt: story.description,
        tools: personaTools as ToolSet,
        stopWhen: stepCountIs(50),
        abortSignal: AbortSignal.timeout(10 * 60 * 1000),
      });

      for await (const _chunk of stream.textStream) {
        // Drive execution
      }

      const text = await stream.text;
      const usage = await stream.totalUsage;

      spinner.stop();

      // Extract markers for context sharing
      const decisionMatches = text.match(/::decision::(.*?)(?=::\w+::|$)/gs);
      if (decisionMatches) {
        for (const m of decisionMatches) {
          context.decisions.push(m.replace("::decision::", "").trim());
        }
      }

      const learningMatches = text.match(/::learning::(.*?)(?=::\w+::|$)/gs);
      if (learningMatches) {
        for (const m of learningMatches) {
          context.learnings.push(m.replace("::learning::", "").trim());
        }
      }

      const fileCreatedMatches = text.match(/::file_created::(.*?)(?=::\w+::|$)/gs);
      if (fileCreatedMatches) {
        for (const m of fileCreatedMatches) {
          context.filesCreated.push(m.replace("::file_created::", "").trim());
        }
      }

      const fileModifiedMatches = text.match(/::file_modified::(.*?)(?=::\w+::|$)/gs);
      if (fileModifiedMatches) {
        for (const m of fileModifiedMatches) {
          context.filesModified.push(m.replace("::file_modified::", "").trim());
        }
      }

      // Track cost
      const inTokens = usage?.inputTokens || 0;
      const outTokens = usage?.outputTokens || 0;
      costTracker.addUsage(persona.name, provider, modelName, inTokens, outTokens);

      // Print summary
      if (text.trim()) {
        const paragraphs = text.trim().split("\n\n");
        const summary = paragraphs[paragraphs.length - 1].slice(0, 200);
        console.log(chalk.dim(`    ${summary}${summary.length >= 200 ? "..." : ""}`));
      }

      console.log(chalk.green(`  ✓ Story ${i + 1}/${stories.length} — ${persona.name} — ${story.title}`));
      console.log();
    } catch (err) {
      spinner.stop();
      printError(`Story ${i + 1} failed: ${err instanceof Error ? err.message : String(err)}`);
      // Continue with next story rather than aborting
    }
  }

  // Print cost summary
  console.log(chalk.bold("  ─── Session Complete ───"));
  console.log();
  console.log(chalk.dim("  " + costTracker.getSummary().split("\n").join("\n  ")));
  console.log();
}
