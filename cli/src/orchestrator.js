import chalk from "chalk";
import ora from "ora";
import { streamText, generateObject, generateText, stepCountIs } from "ai";
import { z } from "zod";
import { createModel } from "../../packages/engine/src/model-factory.js";
import { createToolDefinitions } from "../../packages/engine/src/tools/index.js";
import { loadPersona } from "./personas.js";
import { CostTracker } from "./cost-tracker.js";
import { PermissionManager } from "./permissions.js";
import { printToolCall, printToolResult, printError, getPersonaEmoji, wmLog, wmLogPrefix, wmCoordinatorLog } from "./tui.js";
import { getProviderForPersona } from "./config.js";
export async function classifyComplexity(config, userInput) {
    const { provider, model: modelName, apiKey, host } = getProviderForPersona(config);
    if (apiKey) {
        const envMap = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_API_KEY" };
        const envVar = envMap[provider];
        if (envVar && !process.env[envVar])
            process.env[envVar] = apiKey;
    }
    const model = createModel(provider, modelName, host);
    try {
        const result = await generateObject({
            model,
            schema: z.object({
                complexity: z.enum(["single", "multi"]),
                reason: z.string(),
            }),
            prompt: `Analyze this coding task. If it involves multiple distinct concerns that would benefit from different specialist personas (e.g., database + backend + frontend + devops), classify as "multi". If it's a focused task that one developer could handle, classify as "single". Just classify — do not break down into stories.

Task:
${userInput}`,
        });
        return {
            isMulti: result.object.complexity === "multi",
            reason: result.object.reason,
        };
    }
    catch (err) {
        // Fallback to text-based classification
        try {
            const textResult = await generateText({
                model,
                prompt: `Is this task "single" (one developer) or "multi" (needs multiple specialists)? Respond with just "single" or "multi" and a brief reason.

Task: ${userInput}`,
            });
            const isMulti = /\bmulti\b/i.test(textResult.text);
            return { isMulti, reason: textResult.text.slice(0, 200) };
        }
        catch { /* double fallback failed */ }
        return { isMulti: false, reason: `Classification failed: ${err instanceof Error ? err.message : String(err)}` };
    }
}
function topologicalSort(stories) {
    const idMap = new Map(stories.map(s => [s.id, s]));
    const visited = new Set();
    const result = [];
    const visiting = new Set();
    function visit(id) {
        if (visited.has(id))
            return;
        if (visiting.has(id)) {
            console.log(chalk.yellow(`  ⚠ Circular dependency at ${id}, using input order`));
            return;
        }
        visiting.add(id);
        const story = idMap.get(id);
        if (story?.dependsOn) {
            for (const dep of story.dependsOn) {
                if (idMap.has(dep))
                    visit(dep);
            }
        }
        visiting.delete(id);
        visited.add(id);
        if (story)
            result.push(story);
    }
    for (const story of stories) {
        visit(story.id);
    }
    return result;
}
async function planStories(config, userTask, workingDir, sandboxed = true) {
    const planner = loadPersona("planner");
    const { provider: pProvider, model: pModel, host: pHost } = getProviderForPersona(config, "planner");
    if (pProvider) {
        const pApiKey = config.providers[pProvider]?.apiKey;
        if (pApiKey) {
            const envMap = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_API_KEY" };
            const envVar = envMap[pProvider];
            if (envVar && !process.env[envVar]) {
                const key = pApiKey.startsWith("{env:") ? process.env[pApiKey.slice(5, -1)] : pApiKey;
                if (key)
                    process.env[envVar] = key;
            }
        }
    }
    const plannerModel = createModel(pProvider, pModel, pHost);
    const plannerTools = createToolDefinitions(workingDir, plannerModel, sandboxed);
    const readOnlyTools = {};
    if (planner) {
        for (const toolName of planner.tools) {
            if (plannerTools[toolName]) {
                readOnlyTools[toolName] = plannerTools[toolName];
            }
        }
    }
    const plannerPrompt = `You are an expert implementation planner. Analyze this task and create a high-quality implementation plan.

## Task
${userTask}

## Working directory
${workingDir}

## Instructions
1. Use your tools to explore the working directory and understand what exists. Stay within the working directory.
2. Design a plan that breaks the task into focused stories, each assigned to a specialist persona.
3. Each story should be a meaningful unit of work — not too granular, not too broad.
4. Quality criteria:
   - Every story has a clear, specific description
   - Stories are ordered correctly — dependencies satisfied before dependents
   - Each story is scoped for ONE persona
   - Descriptions include enough detail for the persona to execute without ambiguity

## Output format
Return ONLY a JSON code block with this structure:
\`\`\`json
{
  "stories": [
    {
      "id": "short-kebab-case-id",
      "title": "Brief title",
      "persona": "persona_name",
      "description": "Detailed description: what to create/modify, which files, what approach, what to watch out for",
      "dependsOn": ["id-of-dependency"]
    }
  ]
}
\`\`\`

Available personas: architect, backend_developer, frontend_developer, fullstack_developer, devops_engineer, qa_engineer, security_engineer, database_engineer, mobile_developer, data_engineer, ml_engineer`;
    wmLog("planner", `Starting planning agent using ${pModel}`);
    wmLog("planner", "Reading repository structure...");
    const planStream = streamText({
        model: plannerModel,
        system: planner?.systemPrompt || "You are an implementation planner.",
        prompt: plannerPrompt,
        tools: readOnlyTools,
        stopWhen: stepCountIs(100),
        abortSignal: AbortSignal.timeout(3 * 60 * 1000),
    });
    // Stream planner thinking — WorkerMill format
    let planText = "";
    const planPrefix = wmLogPrefix("planner");
    let planNeedsPrefix = true;
    let inJsonBlock = false;
    for await (const chunk of planStream.textStream) {
        if (chunk) {
            planText += chunk;
            // Track JSON blocks — don't print raw JSON structure
            if (chunk.includes("```json")) {
                inJsonBlock = true;
                continue;
            }
            if (chunk.includes("```") && inJsonBlock) {
                inJsonBlock = false;
                continue;
            }
            if (inJsonBlock)
                continue;
            if (planNeedsPrefix) {
                process.stdout.write(planPrefix);
                planNeedsPrefix = false;
            }
            process.stdout.write(chalk.white(chunk));
            if (chunk.endsWith("\n"))
                planNeedsPrefix = true;
        }
    }
    if (!planNeedsPrefix)
        process.stdout.write("\n");
    // Also check stream.text in case the accumulated text missed something
    const finalText = await planStream.text;
    if (finalText && finalText.length > planText.length) {
        planText = finalText;
    }
    let stories = parseStoriesFromText(planText);
    if (stories.length === 0) {
        console.log(chalk.yellow("  ⚠ Planner didn't produce structured stories, falling back to single story"));
        stories = [{
                id: "implement",
                title: userTask.slice(0, 60),
                persona: "fullstack_developer",
                description: userTask,
            }];
    }
    return stories;
}
/** Parse stories JSON from planner output text */
function parseStoriesFromText(text) {
    // Strategy 1: JSON code block (```json ... ```)
    // Use greedy match and try multiple code blocks if first fails
    const codeBlocks = [...text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/g)];
    for (const match of codeBlocks) {
        const stories = tryParseStories(match[1].trim());
        if (stories)
            return stories;
    }
    // Strategy 2: Find JSON object with "stories" key using bracket matching
    const storiesIdx = text.indexOf('"stories"');
    if (storiesIdx !== -1) {
        // Walk back to find the opening {
        let braceStart = text.lastIndexOf("{", storiesIdx);
        if (braceStart !== -1) {
            const json = extractBalancedJSON(text, braceStart);
            if (json) {
                const stories = tryParseStories(json);
                if (stories)
                    return stories;
            }
        }
    }
    // Strategy 3: Find any JSON array containing objects with "persona"
    const arrayStart = text.indexOf("[");
    if (arrayStart !== -1 && text.indexOf('"persona"') !== -1) {
        const json = extractBalancedJSON(text, arrayStart);
        if (json) {
            const stories = tryParseStories(json);
            if (stories)
                return stories;
        }
    }
    // Strategy 4: Try parsing the entire text as JSON
    const stories = tryParseStories(text.trim());
    if (stories)
        return stories;
    // Log what we couldn't parse for debugging
    const preview = text.slice(0, 500);
    console.log(chalk.dim(`  (planner output preview: ${preview}${text.length > 500 ? "..." : ""})`));
    return [];
}
/** Try to parse text as a stories array or object containing stories */
function tryParseStories(text) {
    try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
            // Validate at least one item has persona field
            if (parsed.length > 0 && parsed[0].persona)
                return parsed;
        }
        if (parsed && Array.isArray(parsed.stories)) {
            if (parsed.stories.length > 0)
                return parsed.stories;
        }
    }
    catch { /* not valid JSON */ }
    return null;
}
/** Extract a balanced JSON structure starting at the given index */
function extractBalancedJSON(text, start) {
    const open = text[start];
    const close = open === "{" ? "}" : open === "[" ? "]" : null;
    if (!close)
        return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (ch === "\\") {
            escape = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString)
            continue;
        if (ch === open)
            depth++;
        if (ch === close) {
            depth--;
            if (depth === 0) {
                return text.slice(start, i + 1);
            }
        }
    }
    return null; // Unbalanced
}
/** Extract a numeric score from critic output — tries markers, then natural language patterns */
function extractScore(text) {
    // 1. Try ::review_score:: marker
    const markerMatch = text.match(/::review_score::(\d+)/);
    if (markerMatch)
        return parseInt(markerMatch[1], 10);
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
            if (n >= 0 && n <= 100)
                return n;
        }
    }
    // 3. If text contains "approve" but no score, assume 85
    if (/\bapprove/i.test(text))
        return 85;
    // 4. If text contains "revise" or "revision" but no score, assume 60
    if (/\brevis/i.test(text))
        return 60;
    // 5. No score found — default to 75 (proceed with caution rather than block)
    return 75;
}
export async function runOrchestration(config, userTask, trustAll, sandboxed = true, agentRl) {
    const costTracker = new CostTracker();
    const context = {
        filesCreated: [],
        filesModified: [],
        decisions: [],
        learnings: [],
    };
    const permissions = new PermissionManager(trustAll);
    if (agentRl)
        permissions.setReadline(agentRl);
    const workingDir = process.cwd();
    // Planner explores codebase and produces stories
    const plannerStories = await planStories(config, userTask, workingDir, sandboxed);
    // Show the plan — WorkerMill format
    wmLog("planner", `Plan generated: ${plannerStories.length} stories`);
    plannerStories.forEach((s, i) => {
        const emoji = getPersonaEmoji(s.persona);
        wmLog("planner", `Step ${i + 1}: [${s.persona}] ${s.title}${s.dependsOn?.length ? ` (after: ${s.dependsOn.join(", ")})` : ""}`);
    });
    wmLog("planner", `Plan validated: ${plannerStories.length} stories. Task queued for execution.`);
    console.log();
    // Optional critic pass (--critic or config.review.useCritic)
    if (config.review?.useCritic) {
        const critic = loadPersona("critic");
        if (critic) {
            const { provider: cProvider, model: cModel, host: cHost } = getProviderForPersona(config, "critic");
            const criticModel = createModel(cProvider, cModel, cHost);
            const criticTools = createToolDefinitions(workingDir, criticModel, sandboxed);
            const criticReadOnly = {};
            for (const name of critic.tools) {
                if (criticTools[name]) {
                    criticReadOnly[name] = criticTools[name];
                }
            }
            const criticSpinner = ora({ stream: process.stdout, text: chalk.white("Critic reviewing plan..."), prefixText: "  " }).start();
            const criticStream = streamText({
                model: criticModel,
                system: critic.systemPrompt,
                prompt: `Review this implementation plan. Score it 0-100 using ::review_score::N marker.\n\nStories:\n${plannerStories.map(s => `- ${s.id}: ${s.title} (${s.persona}) — ${s.description}`).join("\n")}`,
                tools: criticReadOnly,
                stopWhen: stepCountIs(100),
                abortSignal: AbortSignal.timeout(3 * 60 * 1000),
            });
            for await (const _chunk of criticStream.textStream) { /* drive */ }
            const criticText = await criticStream.text;
            criticSpinner.stop();
            const score = extractScore(criticText);
            wmLog("critic", `::review_score::${score}`);
            wmLog("critic", score >= 80 ? "Plan approved" : "Plan needs revision");
            console.log();
        }
    }
    // Sort by dependencies
    const sorted = topologicalSort(plannerStories);
    // Prompt user to proceed (unless --trust mode)
    if (!trustAll) {
        let answer = "n";
        try {
            answer = await permissions.askUser(chalk.dim("  Execute this plan? (y/n): "));
        }
        catch {
            // readline closed — default to no
        }
        if (answer.trim().toLowerCase() !== "y" && answer.trim().toLowerCase() !== "yes") {
            console.log(chalk.dim("  Plan cancelled.\n"));
            return;
        }
        console.log();
    }
    for (let i = 0; i < sorted.length; i++) {
        const story = sorted[i];
        const persona = loadPersona(story.persona);
        if (!persona) {
            printError(`Unknown persona: ${story.persona}`);
            continue;
        }
        // Resolve provider for this persona
        const { provider, model: modelName, apiKey, host } = getProviderForPersona(config, persona.provider || story.persona);
        // Set API key
        if (apiKey) {
            const envMap = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_API_KEY" };
            const envVar = envMap[provider];
            if (envVar && !process.env[envVar])
                process.env[envVar] = apiKey;
        }
        wmCoordinatorLog(`Task claimed by orchestrator`);
        wmLog(story.persona, `Starting ${story.title}`);
        wmLog(story.persona, `Executing story with AIClient (model: ${modelName})...`);
        const spinner = ora({
            stream: process.stdout,
            text: "",
            prefixText: "",
            spinner: "dots",
        }).start();
        const model = createModel(provider, modelName, host);
        // Build tools filtered by persona's allowed tools
        const allTools = createToolDefinitions(workingDir, model, sandboxed);
        const personaTools = {};
        let lastToolCall = ""; // Dedup consecutive identical tool calls
        for (const toolName of persona.tools) {
            const toolDef = allTools[toolName];
            if (toolDef) {
                personaTools[toolName] = {
                    ...toolDef,
                    execute: async (input) => {
                        const allowed = await permissions.checkPermission(toolName, input);
                        if (!allowed)
                            return "Tool execution denied by user.";
                        // Dedup: skip printing if identical to last call
                        const callKey = `${toolName}:${JSON.stringify(input)}`;
                        const isDuplicate = callKey === lastToolCall;
                        lastToolCall = callKey;
                        if (!isDuplicate) {
                            spinner.stop();
                            // WorkerMill format: [emoji persona 🏠] Tool: tool_name
                            wmLog(story.persona, `Tool: ${toolName}`);
                        }
                        const result = await toolDef.execute(input);
                        const resultStr = typeof result === "string" ? result : JSON.stringify(result);
                        if (!isDuplicate) {
                            printToolResult(toolName, resultStr);
                        }
                        spinner.start();
                        return result;
                    },
                };
            }
        }
        let revisionFeedback = "";
        for (let revision = 0; revision <= 2; revision++) {
            // Build system prompt with context from prior stories
            const contextParts = [];
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
                    tools: personaTools,
                    stopWhen: stepCountIs(100),
                    abortSignal: AbortSignal.timeout(10 * 60 * 1000),
                });
                // Stream persona thinking — WorkerMill format: [emoji persona 🏠] thinking text
                // Print each text segment with the persona prefix, just like the real worker does
                let allText = "";
                const storyPrefix = wmLogPrefix(story.persona);
                let needsPrefix = true; // true = next chunk needs the [emoji persona] prefix
                for await (const chunk of stream.textStream) {
                    if (chunk) {
                        allText += chunk;
                        // Skip marker text
                        if (chunk.includes("::decision::") || chunk.includes("::learning::") ||
                            chunk.includes("::file_created::") || chunk.includes("::file_modified::"))
                            continue;
                        spinner.stop();
                        // Print prefix at start of each new line/segment
                        if (needsPrefix) {
                            process.stdout.write(storyPrefix);
                            needsPrefix = false;
                        }
                        process.stdout.write(chalk.white(chunk));
                        // If chunk ends with newline, next chunk needs prefix
                        if (chunk.endsWith("\n")) {
                            needsPrefix = true;
                        }
                    }
                }
                // End the current line if we were mid-line
                if (!needsPrefix) {
                    process.stdout.write("\n");
                }
                const finalStreamText = await stream.text;
                const text = finalStreamText && finalStreamText.length > allText.length ? finalStreamText : allText;
                const usage = await stream.totalUsage;
                spinner.stop();
                // Extract markers and display as WorkerMill-style persona activity
                const decisionMatches = text.match(/::decision::(.*?)(?=::\w+::|$)/gs);
                if (decisionMatches) {
                    for (const m of decisionMatches) {
                        const decision = m.replace("::decision::", "").trim();
                        context.decisions.push(decision);
                        wmLog(story.persona, decision);
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
                wmLog(story.persona, `${story.title} — completed!`);
                console.log();
                break; // Story succeeded, exit revision loop
            }
            catch (err) {
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
        const { provider: revProvider, model: revModel, host: revHost } = getProviderForPersona(config, reviewer.provider || "reviewer");
        const revApiKey = config.providers[revProvider]?.apiKey;
        if (revApiKey) {
            const envMap = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_API_KEY" };
            const envVar = envMap[revProvider];
            const key = revApiKey.startsWith("{env:") ? process.env[revApiKey.slice(5, -1)] : revApiKey;
            if (envVar && key && !process.env[envVar])
                process.env[envVar] = key;
        }
        const reviewModel = createModel(revProvider, revModel, revHost);
        const reviewTools = createToolDefinitions(workingDir, reviewModel, sandboxed);
        // Only read-only tools for reviewer
        const reviewerTools = {};
        for (const toolName of reviewer.tools) {
            if (reviewTools[toolName]) {
                reviewerTools[toolName] = reviewTools[toolName];
            }
        }
        for (let reviewRound = 0; reviewRound <= maxRevisions; reviewRound++) {
            const isRevision = reviewRound > 0;
            wmCoordinatorLog(isRevision ? `Starting Tech Lead review (revision ${reviewRound}/${maxRevisions})...` : "Starting Tech Lead review...");
            wmLog("tech_lead", "Starting agent execution");
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
                    stopWhen: stepCountIs(100),
                    abortSignal: AbortSignal.timeout(5 * 60 * 1000),
                });
                // Stream reviewer thinking — WorkerMill format
                let allReviewText = "";
                const revPrefix = wmLogPrefix("tech_lead");
                let revNeedsPrefix = true;
                for await (const chunk of reviewStream.textStream) {
                    if (chunk) {
                        allReviewText += chunk;
                        if (chunk.includes("::review_score::") || chunk.includes("::review_verdict::"))
                            continue;
                        reviewSpinner.stop();
                        if (revNeedsPrefix) {
                            process.stdout.write(revPrefix);
                            revNeedsPrefix = false;
                        }
                        process.stdout.write(chalk.white(chunk));
                        if (chunk.endsWith("\n"))
                            revNeedsPrefix = true;
                    }
                }
                if (!revNeedsPrefix)
                    process.stdout.write("\n");
                const finalReviewText = await reviewStream.text;
                const reviewText = finalReviewText && finalReviewText.length > allReviewText.length ? finalReviewText : allReviewText;
                const reviewUsage = await reviewStream.totalUsage;
                reviewSpinner.stop();
                // Extract review markers (with fallback parsing)
                const score = extractScore(reviewText);
                const approved = score >= approvalThreshold;
                // Display review result — WorkerMill format
                wmLog("tech_lead", `::code_quality_score::${score}`);
                wmLog("tech_lead", `::review_decision::${approved ? "approved" : "needs_revision"}`);
                wmCoordinatorLog(approved ? `Review approved (score: ${score}/100)` : `Review needs revision (score: ${score}/100)`);
                console.log();
                // Track reviewer cost
                costTracker.addUsage(`Reviewer (round ${reviewRound + 1})`, revProvider, revModel, reviewUsage?.inputTokens || 0, reviewUsage?.outputTokens || 0);
                // If approved or out of revision attempts, done
                if (approved)
                    break;
                if (reviewRound >= maxRevisions) {
                    console.log(chalk.yellow(`  ⚠ Max review revisions (${maxRevisions}) reached`));
                    break;
                }
                // Ask user or auto-revise
                let shouldRevise = autoRevise;
                if (!autoRevise) {
                    try {
                        const answer = await permissions.askUser(chalk.dim("  Revise and re-review? ") + chalk.white(`(y/n, ${maxRevisions - reviewRound} attempt${maxRevisions - reviewRound > 1 ? "s" : ""} left): `));
                        shouldRevise = answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
                    }
                    catch {
                        shouldRevise = false; // cancelled
                    }
                }
                else {
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
                    if (!storyPersona)
                        continue;
                    const { provider: sProvider, model: sModel, host: sHost } = getProviderForPersona(config, storyPersona.provider || story.persona);
                    if (sProvider) {
                        const sApiKey = config.providers[sProvider]?.apiKey;
                        if (sApiKey) {
                            const envMap = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_API_KEY" };
                            const envVar = envMap[sProvider];
                            if (envVar && !process.env[envVar]) {
                                const key = sApiKey.startsWith("{env:") ? process.env[sApiKey.slice(5, -1)] : sApiKey;
                                if (key)
                                    process.env[envVar] = key;
                            }
                        }
                    }
                    const revSpinner = ora({
                        stream: process.stdout,
                        text: chalk.white(`Revising ${i + 1}/${sorted.length} — ${storyPersona.name} — ${story.title}`),
                        prefixText: "  ",
                    }).start();
                    const storyModel = createModel(sProvider, sModel, sHost);
                    const storyAllTools = createToolDefinitions(workingDir, storyModel, sandboxed);
                    const storyTools = {};
                    for (const toolName of storyPersona.tools) {
                        const toolDef = storyAllTools[toolName];
                        if (toolDef) {
                            storyTools[toolName] = {
                                ...toolDef,
                                execute: async (input) => {
                                    const allowed = await permissions.checkPermission(toolName, input);
                                    if (!allowed)
                                        return "Tool execution denied by user.";
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
${reviewText}

Your task: Address the reviewer's feedback for "${story.title}". Fix the specific issues mentioned. Do not rewrite code that wasn't flagged.`;
                    try {
                        const revStream = streamText({
                            model: storyModel,
                            system: revisionSystemPrompt,
                            prompt: `Fix the reviewer's issues for: ${story.title}\n\n${story.description}`,
                            tools: storyTools,
                            stopWhen: stepCountIs(100),
                            abortSignal: AbortSignal.timeout(5 * 60 * 1000),
                        });
                        for await (const _chunk of revStream.textStream) { /* drive */ }
                        const revUsage = await revStream.totalUsage;
                        revSpinner.stop();
                        costTracker.addUsage(`${storyPersona.name} (revision)`, sProvider, sModel, revUsage?.inputTokens || 0, revUsage?.outputTokens || 0);
                        wmLog(story.persona, `${story.title} — revision complete!`);
                    }
                    catch (err) {
                        revSpinner.stop();
                        console.log(chalk.yellow(`  ⚠ Revision failed for story ${i + 1}: ${err instanceof Error ? err.message : String(err)}`));
                    }
                }
                console.log();
                // Loop back to review again
            }
            catch (err) {
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
        }
        catch {
            wmCoordinatorLog("Initializing git repository...");
            execSync("git init", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" });
            // Create default .gitignore if none exists
            const fs = await import("fs");
            const gitignorePath = `${workingDir}/.gitignore`;
            if (!fs.existsSync(gitignorePath)) {
                fs.writeFileSync(gitignorePath, "node_modules/\ndist/\n.env\n.workermill/\n*.log\n", "utf-8");
            }
            wmCoordinatorLog("Git repo initialized");
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
                const untrackedFiles = untracked.split("\n");
                console.log(chalk.dim("  New files:"));
                for (const f of untrackedFiles) {
                    console.log(chalk.dim(`    + ${f}`));
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
                            }
                            catch { /* file may not exist */ }
                        }
                    }
                    else {
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
    }
    catch (err) {
        // Silently skip — don't dump git help text
    }
    // Print cost summary
    console.log(chalk.bold("  ─── Session Complete ───"));
    console.log();
    console.log(chalk.dim("  " + costTracker.getSummary().split("\n").join("\n  ")));
    console.log();
}
