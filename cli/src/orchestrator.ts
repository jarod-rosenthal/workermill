import chalk from "chalk";
import ora from "ora";
import { streamText, generateObject, generateText, stepCountIs, type ToolSet } from "ai";
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
  id: string;       // Short kebab-case slug
  title: string;
  persona: string;
  description: string;
  dependsOn?: string[];  // References to other story IDs
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
          id: z.string().describe("Short kebab-case slug for this story"),
          title: z.string(),
          persona: z.string(),
          description: z.string(),
          dependsOn: z.array(z.string()).optional().describe("IDs of stories this depends on"),
        })).optional(),
      }),
      prompt: `Analyze this coding task. If it involves multiple distinct concerns that would benefit from different specialist personas working sequentially, classify as "multi" and provide a story breakdown with persona assignments. Otherwise classify as "single".

Give each story a short kebab-case id (e.g., "setup-db", "add-api-routes"). Use these IDs in dependsOn to express ordering constraints.

Available personas: architect, backend_developer, frontend_developer, fullstack_developer, devops_engineer, qa_engineer, security_engineer, database_engineer, mobile_developer, data_engineer, ml_engineer

Task:
${userInput}`,
    });

    return {
      isMulti: result.object.complexity === "multi",
      stories: result.object.stories,
      reason: result.object.reason,
    };
  } catch (err) {
    // Fallback to text-based classification if structured output fails
    try {
      const textResult = await generateText({
        model,
        prompt: `Classify this task as "single" or "multi". If multi, list stories with personas as JSON in a \`\`\`json code fence.

Give each story a short kebab-case id (e.g., "setup-db", "add-api-routes"). Use these IDs in dependsOn to express ordering constraints.

Available personas: architect, backend_developer, frontend_developer, fullstack_developer, devops_engineer, qa_engineer, security_engineer, database_engineer, mobile_developer, data_engineer, ml_engineer

Task: ${userInput}

Respond with JSON: {"complexity": "single"|"multi", "reason": "...", "stories": [{"id": "...", "title": "...", "persona": "...", "description": "...", "dependsOn": [...]}]}`,
      });

      const jsonMatch = textResult.text.match(/\{[\s\S]*"complexity"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          isMulti: parsed.complexity === "multi",
          stories: parsed.stories,
          reason: parsed.reason || "",
        };
      }
    } catch { /* double fallback failed */ }

    return { isMulti: false, reason: `Classification failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function topologicalSort(stories: Story[]): Story[] {
  const idMap = new Map(stories.map(s => [s.id, s]));
  const visited = new Set<string>();
  const result: Story[] = [];
  const visiting = new Set<string>();

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      console.log(chalk.yellow(`  ⚠ Circular dependency at ${id}, using input order`));
      return;
    }
    visiting.add(id);
    const story = idMap.get(id);
    if (story?.dependsOn) {
      for (const dep of story.dependsOn) {
        if (idMap.has(dep)) visit(dep);
      }
    }
    visiting.delete(id);
    visited.add(id);
    if (story) result.push(story);
  }

  for (const story of stories) {
    visit(story.id);
  }
  return result;
}

async function runPlannerCriticLoop(
  config: CliConfig,
  stories: Story[],
  workingDir: string,
): Promise<boolean> {
  const planner = loadPersona("planner");
  const critic = loadPersona("critic");
  if (!planner || !critic) {
    console.log(chalk.dim("  Skipping planner/critic (personas not found)"));
    return true;
  }

  const { provider: pProvider, model: pModel, host: pHost } = getProviderForPersona(config, "planner");
  const plannerModel = createModel(pProvider as AIProvider, pModel, pHost);
  const plannerTools = createToolDefinitions(workingDir, plannerModel);

  const readOnlyNames = planner.tools;
  const readOnlyTools: Record<string, AnyToolDef> = {};
  for (const toolName of readOnlyNames) {
    if (plannerTools[toolName as keyof typeof plannerTools]) {
      readOnlyTools[toolName] = plannerTools[toolName as keyof typeof plannerTools];
    }
  }

  const storySummary = stories.map(s => `- ${s.id}: ${s.title} (${s.persona}) — ${s.description}`).join("\n");

  // Build critic model + tools once (reused each iteration)
  const { provider: cProvider, model: cModel, host: cHost } = getProviderForPersona(config, "critic");
  const criticModel = createModel(cProvider as AIProvider, cModel, cHost);
  const criticTools = createToolDefinitions(workingDir, criticModel);
  const criticReadOnly: Record<string, AnyToolDef> = {};
  for (const name of critic.tools) {
    if (criticTools[name as keyof typeof criticTools]) {
      criticReadOnly[name] = criticTools[name as keyof typeof criticTools];
    }
  }

  // First pass: plan + critique
  const spinner = ora({ stream: process.stdout, text: chalk.white("Planning implementation..."), prefixText: "  " }).start();

  const planStream = streamText({
    model: plannerModel,
    system: planner.systemPrompt,
    prompt: `Create an implementation plan for these stories:\n\n${storySummary}\n\nWorking directory: ${workingDir}`,
    tools: readOnlyTools as ToolSet,
    stopWhen: stepCountIs(30),
    abortSignal: AbortSignal.timeout(5 * 60 * 1000),
  });

  for await (const _chunk of planStream.textStream) { /* drive */ }
  const planText = await planStream.text;
  spinner.stop();

  const criticSpinner = ora({ stream: process.stdout, text: chalk.white("Critic reviewing plan..."), prefixText: "  " }).start();

  const criticStream = streamText({
    model: criticModel,
    system: critic.systemPrompt,
    prompt: `Review this implementation plan and output a score using ::review_score::N (0-100) and ::review_verdict::approve or ::review_verdict::revise markers.\n\nPlan:\n${planText}`,
    tools: criticReadOnly as ToolSet,
    stopWhen: stepCountIs(20),
    abortSignal: AbortSignal.timeout(3 * 60 * 1000),
  });

  for await (const _chunk of criticStream.textStream) { /* drive */ }
  const criticText = await criticStream.text;
  criticSpinner.stop();

  const score = extractScore(criticText);
  const scoreColor = score >= 80 ? chalk.green : score >= 60 ? chalk.yellow : chalk.red;
  console.log(`  ${scoreColor(`Plan score: ${score}/100`)}`);

  if (score >= 80) {
    console.log(chalk.green("  ✓ Plan approved"));
    return true;
  }

  // One revision pass with critic feedback
  console.log(chalk.yellow(`  Revising plan with critic feedback...`));

  const revisionSpinner = ora({ stream: process.stdout, text: chalk.white("Revising plan..."), prefixText: "  " }).start();

  const revisionStream = streamText({
    model: plannerModel,
    system: planner.systemPrompt,
    prompt: `Create an implementation plan for these stories:\n\n${storySummary}\n\nWorking directory: ${workingDir}\n\n## Critic feedback (address these issues):\n${criticText.slice(0, 2000)}`,
    tools: readOnlyTools as ToolSet,
    stopWhen: stepCountIs(30),
    abortSignal: AbortSignal.timeout(5 * 60 * 1000),
  });

  for await (const _chunk of revisionStream.textStream) { /* drive */ }
  const revisedPlan = await revisionStream.text;
  revisionSpinner.stop();

  const criticSpinner2 = ora({ stream: process.stdout, text: chalk.white("Critic reviewing revision..."), prefixText: "  " }).start();

  const criticStream2 = streamText({
    model: criticModel,
    system: critic.systemPrompt,
    prompt: `Review this implementation plan and output a score using ::review_score::N (0-100) and ::review_verdict::approve or ::review_verdict::revise markers.\n\nPlan:\n${revisedPlan}`,
    tools: criticReadOnly as ToolSet,
    stopWhen: stepCountIs(20),
    abortSignal: AbortSignal.timeout(3 * 60 * 1000),
  });

  for await (const _chunk of criticStream2.textStream) { /* drive */ }
  const criticText2 = await criticStream2.text;
  criticSpinner2.stop();

  const score2 = extractScore(criticText2);
  const scoreColor2 = score2 >= 80 ? chalk.green : score2 >= 60 ? chalk.yellow : chalk.red;
  console.log(`  ${scoreColor2(`Revised plan score: ${score2}/100`)}`);

  if (score2 >= 80) {
    console.log(chalk.green("  ✓ Plan approved after revision"));
  } else {
    console.log(chalk.yellow("  ⚠ Plan scored below 80, proceeding anyway"));
  }
  return true;
}

/** Extract a numeric score from critic output — tries markers, then natural language patterns */
function extractScore(text: string): number {
  // 1. Try ::review_score:: marker
  const markerMatch = text.match(/::review_score::(\d+)/);
  if (markerMatch) return parseInt(markerMatch[1], 10);

  // 2. Try "Score: N/100" or "score: N" patterns
  const scorePatterns = [
    /\bscore[:\s]+(\d+)\s*\/\s*100/i,
    /\b(\d+)\s*\/\s*100/,
    /\bscore[:\s]+(\d+)/i,
    /\brating[:\s]+(\d+)/i,
  ];
  for (const pattern of scorePatterns) {
    const match = text.match(pattern);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n >= 0 && n <= 100) return n;
    }
  }

  // 3. If text contains "approve" but no score, assume 85
  if (/\bapprove/i.test(text)) return 85;

  // 4. If text contains "revise" or "revision" but no score, assume 60
  if (/\brevis/i.test(text)) return 60;

  // 5. No score found — default to 75 (proceed with caution rather than block)
  return 75;
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

  // Sort by dependencies
  const sorted = topologicalSort(stories);

  console.log();
  console.log(chalk.bold(`  Plan: ${sorted.length} stories`));
  sorted.forEach((s, i) => {
    console.log(chalk.dim(`    ${i + 1}. ${s.persona}: ${s.title}${s.dependsOn?.length ? ` (after: ${s.dependsOn.join(", ")})` : ""}`));
  });
  console.log();

  // Planner/critic validation
  await runPlannerCriticLoop(config, sorted, workingDir);
  console.log();

  for (let i = 0; i < sorted.length; i++) {
    const story = sorted[i];
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
      text: chalk.white(`Story ${i + 1}/${sorted.length} — ${persona.name} — ${story.title}`),
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

    let revisionFeedback = "";
    for (let revision = 0; revision <= 2; revision++) {

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

## Critical rules
- NEVER start long-running processes (dev servers, watch modes, npm start, npm run dev, nodemon, tsc --watch, webpack serve, etc.). These block execution indefinitely.
- NEVER run interactive commands that wait for user input.
- Only run commands that complete and exit: npm install, npm test, npx tsc --noEmit, etc.
- If you need to verify a server works, check that the code compiles or run a quick test — do NOT start the actual server.

When you make a decision that affects other parts of the system, include ::decision:: markers in your output.
When you learn something useful, include ::learning:: markers.
When you create a file, include ::file_created::path markers.
When you modify a file, include ::file_modified::path markers.${revisionFeedback ? `\n\n## Revision requested\n${revisionFeedback}` : ""}`;

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

      console.log(chalk.green(`  ✓ Story ${i + 1}/${sorted.length} — ${persona.name} — ${story.title}`));
      console.log();
      break; // Story succeeded, exit revision loop
    } catch (err) {
      spinner.stop();
      printError(`Story ${i + 1} failed: ${err instanceof Error ? err.message : String(err)}`);
      break; // Don't retry on errors, move to next story
    }

    } // end revision loop
  }

  // Review config
  const maxRevisions = config.review?.maxRevisions ?? 2;
  const autoRevise = config.review?.autoRevise ?? false;
  const approvalThreshold = config.review?.approvalThreshold ?? 80;

  // Run inline review with revision loop
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

    const reviewModel = createModel(revProvider as AIProvider, revModel, revHost);
    const reviewTools = createToolDefinitions(workingDir, reviewModel);

    // Only read-only tools for reviewer
    const reviewerTools: Record<string, AnyToolDef> = {};
    for (const toolName of reviewer.tools) {
      if (reviewTools[toolName as keyof typeof reviewTools]) {
        reviewerTools[toolName] = reviewTools[toolName as keyof typeof reviewTools];
      }
    }

    for (let reviewRound = 0; reviewRound <= maxRevisions; reviewRound++) {
      const isRevision = reviewRound > 0;
      console.log(chalk.bold(`  ─── Review${isRevision ? ` (revision ${reviewRound}/${maxRevisions})` : ""} ───`));
      console.log();

      const reviewSpinner = ora({
        stream: process.stdout,
        text: chalk.white(isRevision ? "Reviewer — Re-checking after revisions" : "Reviewer — Checking code quality"),
        prefixText: "  ",
      }).start();

      try {
        const reviewPrompt = `Review the changes made by the following experts:

${sorted.map((s, idx) => `${idx + 1}. ${s.persona}: ${s.title} — ${s.description}`).join("\n")}

Files created: ${context.filesCreated.join(", ") || "none"}
Files modified: ${context.filesModified.join(", ") || "none"}

Use the read_file, glob, and grep tools to examine the actual changes. Look for:
- Bugs or logic errors
- Missing error handling
- Security issues
- Code that doesn't follow project conventions
- Missing tests

Provide a review with a quality score (0-100) using ::review_score:: marker and a verdict using ::review_verdict::approved or ::review_verdict::needs_revision.
If there are issues, be specific about which files and what needs to change.`;

        const reviewStream = streamText({
          model: reviewModel,
          system: reviewer.systemPrompt,
          prompt: reviewPrompt,
          tools: reviewerTools,
          stopWhen: stepCountIs(30),
          abortSignal: AbortSignal.timeout(5 * 60 * 1000),
        });

        for await (const _chunk of reviewStream.textStream) { /* drive */ }

        const reviewText = await reviewStream.text;
        const reviewUsage = await reviewStream.totalUsage;

        reviewSpinner.stop();

        // Extract review markers (with fallback parsing)
        const score = extractScore(reviewText);
        const approved = score >= approvalThreshold;

        // Display review result
        const scoreColor = score >= approvalThreshold ? chalk.green : score >= 60 ? chalk.yellow : chalk.red;
        console.log(`  ${scoreColor(`Score: ${score}/100`)} — ${approved ? chalk.green("APPROVED") : chalk.yellow("NEEDS REVISION")}`);

        // Print full review feedback (strip marker lines only)
        const feedbackLines = reviewText.split("\n").filter(l => !l.includes("::review_score::") && !l.includes("::review_verdict::"));
        const feedback = feedbackLines.join("\n").trim();
        if (feedback) {
          console.log();
          for (const line of feedback.split("\n")) {
            console.log(chalk.dim("  " + line));
          }
        }
        console.log();

        // Track reviewer cost
        costTracker.addUsage(`Reviewer (round ${reviewRound + 1})`, revProvider, revModel,
          reviewUsage?.inputTokens || 0, reviewUsage?.outputTokens || 0);

        // If approved or out of revision attempts, done
        if (approved) break;
        if (reviewRound >= maxRevisions) {
          console.log(chalk.yellow(`  ⚠ Max review revisions (${maxRevisions}) reached`));
          break;
        }

        // Ask user or auto-revise
        let shouldRevise = autoRevise;
        if (!autoRevise) {
          try {
            const answer = await permissions.askUser(
              chalk.dim("  Revise and re-review? ") + chalk.white(`(y/n, ${maxRevisions - reviewRound} attempt${maxRevisions - reviewRound > 1 ? "s" : ""} left): `)
            );
            shouldRevise = answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
          } catch {
            shouldRevise = false; // cancelled
          }
        } else {
          console.log(chalk.dim(`  Auto-revising (${maxRevisions - reviewRound} attempt${maxRevisions - reviewRound > 1 ? "s" : ""} left)...`));
        }

        if (!shouldRevise) {
          console.log(chalk.dim("  Skipping revision, proceeding to commit."));
          break;
        }

        // Re-execute stories with reviewer feedback
        console.log(chalk.bold("\n  ─── Revision Pass ───\n"));

        for (let i = 0; i < sorted.length; i++) {
          const story = sorted[i];
          const storyPersona = loadPersona(story.persona);
          if (!storyPersona) continue;

          const { provider: sProvider, model: sModel, host: sHost } = getProviderForPersona(
            config, storyPersona.provider || story.persona
          );
          if (sProvider) {
            const sApiKey = config.providers[sProvider]?.apiKey;
            if (sApiKey) {
              const envMap: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_API_KEY" };
              const envVar = envMap[sProvider];
              if (envVar && !process.env[envVar]) {
                const key = sApiKey.startsWith("{env:") ? process.env[sApiKey.slice(5, -1)] : sApiKey;
                if (key) process.env[envVar] = key;
              }
            }
          }

          const revSpinner = ora({
            stream: process.stdout,
            text: chalk.white(`Revising ${i + 1}/${sorted.length} — ${storyPersona.name} — ${story.title}`),
            prefixText: "  ",
          }).start();

          const storyModel = createModel(sProvider as AIProvider, sModel, sHost);
          const storyAllTools = createToolDefinitions(workingDir, storyModel);
          const storyTools: Record<string, AnyToolDef> = {};
          for (const toolName of storyPersona.tools) {
            const toolDef = storyAllTools[toolName as keyof typeof storyAllTools] as AnyToolDef;
            if (toolDef) {
              storyTools[toolName] = {
                ...toolDef,
                execute: async (input: Record<string, unknown>) => {
                  const allowed = await permissions.checkPermission(toolName, input);
                  if (!allowed) return "Tool execution denied by user.";
                  revSpinner.stop();
                  printToolCall(toolName, input);
                  const result = await toolDef.execute(input);
                  const resultStr = typeof result === "string" ? result : JSON.stringify(result);
                  printToolResult(toolName, resultStr);
                  revSpinner.start();
                  return result;
                },
              };
            }
          }

          const revisionSystemPrompt = `${storyPersona.systemPrompt}

Working directory: ${workingDir}

## Critical rules
- NEVER start long-running processes (dev servers, watch modes, npm start, npm run dev, nodemon, tsc --watch, etc.)
- NEVER run interactive commands that wait for user input
- Only run commands that complete and exit

## Reviewer feedback — fix these issues:
${reviewText.slice(0, 3000)}

Your task: Address the reviewer's feedback for "${story.title}". Fix the specific issues mentioned. Do not rewrite code that wasn't flagged.`;

          try {
            const revStream = streamText({
              model: storyModel,
              system: revisionSystemPrompt,
              prompt: `Fix the reviewer's issues for: ${story.title}\n\n${story.description}`,
              tools: storyTools as ToolSet,
              stopWhen: stepCountIs(30),
              abortSignal: AbortSignal.timeout(5 * 60 * 1000),
            });

            for await (const _chunk of revStream.textStream) { /* drive */ }
            const revUsage = await revStream.totalUsage;
            revSpinner.stop();

            costTracker.addUsage(`${storyPersona.name} (revision)`, sProvider, sModel,
              revUsage?.inputTokens || 0, revUsage?.outputTokens || 0);

            console.log(chalk.green(`  ✓ Revised ${i + 1}/${sorted.length} — ${storyPersona.name} — ${story.title}`));
          } catch (err) {
            revSpinner.stop();
            console.log(chalk.yellow(`  ⚠ Revision failed for story ${i + 1}: ${err instanceof Error ? err.message : String(err)}`));
          }
        }
        console.log();
        // Loop back to review again
      } catch (err) {
        reviewSpinner.stop();
        console.log(chalk.yellow(`  ⚠ Review skipped: ${err instanceof Error ? err.message : String(err)}`));
        console.log();
        break;
      }
    } // end review loop
  }

  // Git commit step
  try {
    const { execSync } = await import("child_process");

    // Auto-init git if not a repo
    try {
      execSync("git rev-parse --git-dir", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" });
    } catch {
      console.log(chalk.dim("  Initializing git repository..."));
      execSync("git init", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" });
      console.log(chalk.green("  ✓ Git repo initialized"));
    }

    const diff = execSync("git diff --stat", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
    // Also check for untracked files
    const untracked = execSync("git ls-files --others --exclude-standard", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
    const hasChanges = diff || untracked;

    if (hasChanges) {
      console.log(chalk.bold("  ─── Changes ───"));
      if (diff) {
        console.log(chalk.dim("  " + diff.split("\n").join("\n  ")));
      }
      if (untracked) {
        const untrackedFiles = untracked.split("\n").slice(0, 20);
        console.log(chalk.dim("  New files:"));
        for (const f of untrackedFiles) {
          console.log(chalk.dim(`    + ${f}`));
        }
        if (untracked.split("\n").length > 20) {
          console.log(chalk.dim(`    ... and ${untracked.split("\n").length - 20} more`));
        }
      }
      console.log();

      if (!trustAll) {
        const answer = await permissions.askUser(chalk.dim("  Commit these changes? (y/n): "));
        if (answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes") {
          // Stage specific files from context (NOT git add -A)
          const filesToStage = [...context.filesCreated, ...context.filesModified].filter(Boolean);
          if (filesToStage.length > 0) {
            for (const f of filesToStage) {
              try {
                execSync(`git add "${f}"`, { cwd: workingDir, stdio: "pipe" });
              } catch { /* file may not exist */ }
            }
          } else {
            // Fallback: stage tracked modified + all new files from context
            execSync("git add -u", { cwd: workingDir, stdio: "pipe" });
          }
          const storyTitles = sorted.map(s => s.title).join(", ");
          const msg = `feat: ${storyTitles}`.slice(0, 72);
          execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { cwd: workingDir, stdio: "pipe" });
          console.log(chalk.green("  ✓ Changes committed"));
        }
      }
    }
  } catch (err) {
    // Silently skip — don't dump git help text
  }

  // Print cost summary
  console.log(chalk.bold("  ─── Session Complete ───"));
  console.log();
  console.log(chalk.dim("  " + costTracker.getSummary().split("\n").join("\n  ")));
  console.log();
}
