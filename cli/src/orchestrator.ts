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

  // Run inline review
  console.log(chalk.bold("  ─── Review ───"));
  console.log();

  const reviewer = loadPersona("reviewer");
  if (reviewer) {
    const { provider: revProvider, model: revModel, host: revHost } = getProviderForPersona(
      config,
      reviewer.provider || "reviewer"
    );

    const revApiKey = config.providers[revProvider]?.apiKey;
    if (revApiKey) {
      const envMap: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_API_KEY" };
      const envVar = envMap[revProvider];
      const key = revApiKey.startsWith("{env:") ? process.env[revApiKey.slice(5, -1)] : revApiKey;
      if (envVar && key && !process.env[envVar]) process.env[envVar] = key;
    }

    const reviewSpinner = ora({
      text: chalk.white("Reviewer — Checking code quality"),
      prefixText: "  ",
    }).start();

    const reviewModel = createModel(revProvider as AIProvider, revModel, revHost);
    const reviewTools = createToolDefinitions(workingDir, reviewModel);

    // Only read-only tools for reviewer
    const reviewerTools: Record<string, AnyToolDef> = {};
    for (const toolName of reviewer.tools) {
      if (reviewTools[toolName as keyof typeof reviewTools]) {
        reviewerTools[toolName] = reviewTools[toolName as keyof typeof reviewTools];
      }
    }

    try {
      const reviewPrompt = `Review the changes made by the following experts:

${stories.map((s, i) => `${i + 1}. ${s.persona}: ${s.title} — ${s.description}`).join("\n")}

Files created: ${context.filesCreated.join(", ") || "none"}
Files modified: ${context.filesModified.join(", ") || "none"}

Use the read_file, glob, and grep tools to examine the actual changes. Look for:
- Bugs or logic errors
- Missing error handling
- Security issues
- Code that doesn't follow project conventions
- Missing tests

Provide a review with a quality score (0-100) using ::review_score:: marker and a verdict using ::review_verdict::approved or ::review_verdict::needs_revision.`;

      const reviewStream = streamText({
        model: reviewModel,
        system: reviewer.systemPrompt,
        prompt: reviewPrompt,
        tools: reviewerTools,
        stopWhen: stepCountIs(30),
        abortSignal: AbortSignal.timeout(5 * 60 * 1000),
      });

      for await (const _chunk of reviewStream.textStream) {
        // Drive execution
      }

      const reviewText = await reviewStream.text;
      const reviewUsage = await reviewStream.totalUsage;

      reviewSpinner.stop();

      // Extract review markers
      const scoreMatch = reviewText.match(/::review_score::(\d+)/);
      const verdictMatch = reviewText.match(/::review_verdict::(\w+)/);
      const score = scoreMatch ? parseInt(scoreMatch[1], 10) : null;
      const verdict = verdictMatch ? verdictMatch[1] : "unknown";

      // Display review result
      if (score !== null) {
        const scoreColor = score >= 85 ? chalk.green : score >= 70 ? chalk.yellow : chalk.red;
        console.log(`  ${scoreColor(`Score: ${score}/100`)} — ${verdict === "approved" ? chalk.green("APPROVED") : chalk.yellow("NEEDS REVISION")}`);
      }

      // Print review feedback (last meaningful paragraph)
      const reviewParagraphs = reviewText.split("\n\n").filter(p => p.trim() && !p.includes("::"));
      if (reviewParagraphs.length > 0) {
        console.log();
        const feedback = reviewParagraphs[reviewParagraphs.length - 1].slice(0, 300);
        console.log(chalk.dim("  " + feedback));
      }
      console.log();

      // Track reviewer cost
      const revIn = reviewUsage?.inputTokens || 0;
      const revOut = reviewUsage?.outputTokens || 0;
      costTracker.addUsage("Reviewer", revProvider, revModel, revIn, revOut);
    } catch (err) {
      reviewSpinner.stop();
      console.log(chalk.yellow(`  ⚠ Review skipped: ${err instanceof Error ? err.message : String(err)}`));
      console.log();
    }
  }

  // Print cost summary
  console.log(chalk.bold("  ─── Session Complete ───"));
  console.log();
  console.log(chalk.dim("  " + costTracker.getSummary().split("\n").join("\n  ")));
  console.log();
}
