import readline from "readline";
import fs from "fs";
import pathModule from "path";
import chalk from "chalk";
import ora from "ora";
import { execSync } from "child_process";
import { streamText, stepCountIs } from "ai";
import { createModel, buildOllamaOptions } from "../../packages/engine/src/model-factory.js";
import { createToolDefinitions } from "../../packages/engine/src/tools/index.js";
import { PermissionManager } from "./permissions.js";
import { killActiveProcess } from "../../packages/engine/src/tools/bash.js";
import { printError, printStatusBar, printHeader, wmLog, formatToolCall } from "./tui.js";
import { handleCommand as handleSlashCommand } from "./commands.js";
import { CostTracker } from "./cost-tracker.js";
import { initTerminal, exitTerminal, setStatusBar, showStatusBar } from "./terminal.js";
import { getProviderForPersona } from "./config.js";
import { createSession, saveSession, addMessage, loadLatestSession } from "./session.js";
import { shouldCompact, compactMessages } from "./compaction.js";
import * as logger from "./logger.js";
// Input history persistence
const HISTORY_FILE = pathModule.join(process.env.HOME || "~", ".workermill", "history");
const MAX_HISTORY = 1000;
function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const lines = fs.readFileSync(HISTORY_FILE, "utf-8").split("\n").filter(Boolean);
            return lines.slice(-MAX_HISTORY);
        }
    }
    catch { /* ignore */ }
    return [];
}
function appendHistory(line) {
    try {
        const dir = pathModule.dirname(HISTORY_FILE);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(HISTORY_FILE, line + "\n", "utf-8");
    }
    catch { /* ignore */ }
}
// Slash command tab completion
const SLASH_COMMANDS = [
    "/help", "/clear", "/compact", "/status", "/model", "/quit",
    "/cost", "/git", "/editor", "/plan", "/sessions", "/exit",
];
function completer(line) {
    if (line.startsWith("/")) {
        const hits = SLASH_COMMANDS.filter(c => c.startsWith(line));
        return [hits.length ? hits : SLASH_COMMANDS, line];
    }
    return [[], line];
}
export async function runAgent(config, trustAll, resume, startInPlanMode, fullDisk) {
    const { provider, model: modelName, apiKey, host, contextLength } = getProviderForPersona(config);
    // Set API keys in env if provided
    if (apiKey) {
        const envMap = {
            anthropic: "ANTHROPIC_API_KEY",
            openai: "OPENAI_API_KEY",
            google: "GOOGLE_API_KEY",
        };
        const envVar = envMap[provider];
        if (envVar && !process.env[envVar]) {
            process.env[envVar] = apiKey;
        }
    }
    const aiProvider = provider;
    const model = createModel(aiProvider, modelName, host, contextLength);
    const workingDir = process.cwd();
    const sandboxed = !fullDisk;
    const tools = createToolDefinitions(workingDir, model, sandboxed);
    const permissions = new PermissionManager(trustAll);
    // readline will be bound to permissions after creation (see below)
    // Initialize or resume session
    let session;
    if (resume) {
        const loaded = loadLatestSession();
        if (loaded) {
            session = loaded;
            console.log(chalk.green(`  Resumed session ${session.id.slice(0, 8)}... (${session.messages.length} messages)\n`));
        }
        else {
            session = createSession(provider, modelName);
            console.log(chalk.dim("  No previous session found, starting fresh.\n"));
        }
    }
    else {
        session = createSession(provider, modelName);
    }
    let agentState = "idle";
    let currentAbortController = null;
    let lastCtrlCTime = 0;
    let planMode = startInPlanMode || false;
    const costTracker = new CostTracker();
    // Read-only tools allowed in plan mode
    const READ_ONLY_TOOLS = new Set(["read_file", "glob", "grep", "ls", "sub_agent"]);
    // Git is read-only in plan mode (status/diff/log only, filtered in tool wrapper)
    function getActiveTools() {
        if (!planMode)
            return permissionedTools;
        const filtered = {};
        for (const [name, def] of Object.entries(permissionedTools)) {
            if (READ_ONLY_TOOLS.has(name)) {
                filtered[name] = def;
            }
        }
        return filtered;
    }
    // Wrap tools with permission checks
    const permissionedTools = {};
    for (const [name, toolDef] of Object.entries(tools)) {
        const td = toolDef;
        permissionedTools[name] = {
            ...td,
            execute: async (input) => {
                const prevState = agentState;
                agentState = "permission_waiting";
                const allowed = await permissions.checkPermission(name, input);
                if (!allowed) {
                    agentState = prevState;
                    logger.debug("Tool denied by user", { tool: name });
                    return "Tool execution denied by user.";
                }
                logger.info("Tool call", { tool: name, input: JSON.stringify(input).slice(0, 200) });
                wmLog(singleAgentPersona, formatToolCall(name, input));
                agentState = "tool_executing";
                const result = await td.execute(input);
                agentState = "streaming";
                logger.debug("Tool result", { tool: name, result: (typeof result === "string" ? result : JSON.stringify(result)).slice(0, 200) });
                return result;
            },
        };
    }
    logger.info("Session started", { provider, model: modelName, workingDir, trustAll });
    initTerminal();
    // Show header
    printHeader("0.1.9", provider, modelName, workingDir);
    // Set initial status bar
    const statusText = printStatusBar(provider, modelName, 0, planMode ? "PLAN" : (trustAll ? "trust all" : "ask"), 0, contextLength);
    setStatusBar(statusText);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: chalk.cyan("❯ "),
        completer,
    });
    /** Show status bar line then prompt */
    function promptWithStatus() {
        showStatusBar();
        rl.prompt();
    }
    // Load persistent history
    const history = loadHistory();
    rl.history = history.reverse();
    // Bind the readline to the permission manager so it reuses the same instance
    permissions.setReadline(rl);
    process.on("SIGINT", () => {
        if (agentState === "streaming") {
            if (currentAbortController)
                currentAbortController.abort();
            console.log(chalk.yellow("\n  [cancelled]"));
            agentState = "idle";
            currentAbortController = null;
            processing = false;
            rl.resume();
            promptWithStatus();
        }
        else if (agentState === "tool_executing") {
            console.log(chalk.yellow("\n  [cancelling...]"));
            killActiveProcess();
            if (currentAbortController)
                currentAbortController.abort();
            agentState = "idle";
            currentAbortController = null;
            processing = false;
            rl.resume();
            promptWithStatus();
        }
        else if (agentState === "permission_waiting") {
            permissions.cancelPrompt();
            console.log(chalk.yellow("\n  [cancelled]"));
            agentState = "idle";
            currentAbortController = null;
            processing = false;
            rl.resume();
            promptWithStatus();
        }
        else {
            // idle — double-tap to exit
            const now = Date.now();
            if (now - lastCtrlCTime < 500) {
                saveSession(session);
                exitTerminal();
                console.log(chalk.dim("  Goodbye!"));
                process.exit(0);
            }
            lastCtrlCTime = now;
            console.log(chalk.dim("\n  Press Ctrl+C again to exit."));
            promptWithStatus();
        }
    });
    const singleAgentPersona = "backend_developer";
    const systemPrompt = `You are a senior developer in WorkerMill, an AI coding agent running in the user's terminal.

Your specialties:
- Full-stack development (Node.js, TypeScript, React, databases)
- System design and architecture
- Testing and quality assurance
- DevOps and deployment

Working directory: ${workingDir}

## Communication Style

Write in a professional, direct tone. Do NOT open messages with filler words or pleasantries like "Perfect!", "Great!", "Awesome!", "Sure!", "Absolutely!", or similar. Start with the substance — what you did, what you found, or what you need. Be concise and informative. Do NOT repeat what you said in previous steps — each response should add new information only.

## Guidelines
- Use tools proactively to explore the codebase before making changes
- When editing files, read them first to understand context
- Prefer editing existing files over creating new ones
- Run tests after making changes when test infrastructure exists
- Use glob and grep to find relevant files before reading them

## Critical rules
- NEVER start long-running processes (dev servers, watch modes, npm start, npm run dev, nodemon, tsc --watch, etc.)
- NEVER run interactive commands that wait for user input
- Only run commands that complete and exit

## Reporting Learnings

When you discover something specific and actionable about this codebase, emit a learning marker:
::learning::The test suite requires DATABASE_URL env var or tests silently pass without running

## Technology Versions — Trust the Spec

If the task specifies a dependency version, USE THAT VERSION. Do NOT downgrade or "fix" versions you don't recognize.

Focus on writing clean, production-ready code.`;
    promptWithStatus();
    let processing = false;
    let multilineBacktick = false;
    let multilineBackslash = false;
    let multilineBuffer = [];
    // Command context for slash commands
    const cmdCtx = {
        config,
        session,
        costTracker,
        workingDir,
        planMode,
        setPlanMode: (mode) => { planMode = mode; cmdCtx.planMode = mode; },
        processInput,
    };
    function processInput(input) {
        processing = true;
        rl.pause();
        (async () => {
            try {
                addMessage(session, "user", input);
                appendHistory(input);
                if (!session.name) {
                    session.name = input.slice(0, 50).replace(/\n/g, " ");
                }
                logger.info("User message", { length: input.length, preview: input.slice(0, 100) });
                // On first message, check if the task warrants multi-expert orchestration
                if (session.messages.length <= 1) {
                    const { classifyComplexity, runOrchestration } = await import("./orchestrator.js");
                    console.log(chalk.dim("\n  Analyzing task complexity..."));
                    logger.info("Running complexity classifier");
                    const classification = await classifyComplexity(config, input);
                    logger.info("Classification result", { isMulti: classification.isMulti, reason: classification.reason });
                    if (classification.isMulti) {
                        console.log(chalk.dim(`  → multi-expert (${classification.reason})\n`));
                        // Orchestrator runs planner to determine stories, critic validates, then prompts user
                        await runOrchestration(config, input, trustAll, sandboxed, rl);
                        processing = false;
                        rl.resume();
                        promptWithStatus();
                        return;
                    }
                    else {
                        console.log(chalk.dim(`  → single agent (${classification.reason})\n`));
                    }
                }
                logger.info("Starting streamText", { model: modelName, messageCount: session.messages.length });
                const thinkingSpinner = ora({ stream: process.stdout, text: chalk.dim("Thinking..."), prefixText: " " }).start();
                currentAbortController = new AbortController();
                const timeoutId = setTimeout(() => currentAbortController?.abort(), 10 * 60 * 1000);
                agentState = "streaming";
                const stream = streamText({
                    model,
                    system: systemPrompt,
                    messages: session.messages.map((m) => ({
                        role: m.role,
                        content: m.content,
                    })),
                    tools: getActiveTools(),
                    stopWhen: stepCountIs(100),
                    abortSignal: currentAbortController.signal,
                    ...buildOllamaOptions(aiProvider, contextLength),
                    onStepFinish({ text }) {
                        if (text) {
                            thinkingSpinner.stop();
                            const lines = text.split("\n").filter(l => l.trim());
                            for (const line of lines) {
                                if (line.includes("::learning::"))
                                    continue;
                                wmLog(singleAgentPersona, line);
                            }
                        }
                    },
                });
                // Drive the stream — onStepFinish handles display
                for await (const _chunk of stream.textStream) { /* consumed */ }
                clearTimeout(timeoutId);
                agentState = "idle";
                currentAbortController = null;
                thinkingSpinner.stop();
                const usage = await stream.totalUsage;
                const inputTokens = usage?.inputTokens || 0;
                const outputTokens = usage?.outputTokens || 0;
                const tokens = inputTokens + outputTokens;
                session.totalTokens += tokens;
                costTracker.addUsage("agent", provider, modelName, inputTokens, outputTokens);
                // Track last input tokens — this is the actual context window usage
                const lastContextUsage = inputTokens;
                // Store assistant response
                const finalText = await stream.text;
                logger.info("Response complete", { tokens, textLength: finalText.length });
                addMessage(session, "assistant", finalText);
                // Auto-save session after each exchange
                saveSession(session);
                // Check for auto-compaction — use actual context usage, not cumulative spend
                const compactionLevel = shouldCompact(lastContextUsage, modelName, contextLength);
                if (compactionLevel !== "none") {
                    const spinner = ora({ stream: process.stdout, text: `Compacting conversation (${compactionLevel})...`, prefixText: "  " }).start();
                    const plainMessages = session.messages.map(m => ({ role: m.role, content: m.content }));
                    const compacted = await compactMessages(model, plainMessages, compactionLevel);
                    // Rebuild session messages with timestamps
                    session.messages = compacted.map(m => ({
                        role: m.role,
                        content: m.content,
                        timestamp: new Date().toISOString(),
                    }));
                    saveSession(session);
                    spinner.succeed("Conversation compacted");
                }
                // Update pinned status bar — context bar shows actual window usage, not cumulative spend
                const bar = printStatusBar(provider, modelName, lastContextUsage, planMode ? "PLAN" : (trustAll ? "trust all" : "ask"), costTracker.getTotalCost(), contextLength);
                setStatusBar(bar);
            }
            catch (err) {
                agentState = "idle";
                currentAbortController = null;
                if (err instanceof Error && err.name === "AbortError") {
                    // Already handled by SIGINT handler
                }
                else {
                    logger.error("Agent error", { error: err instanceof Error ? err.message : String(err) });
                    printError(err instanceof Error ? err.message : String(err));
                }
            }
            processing = false;
            rl.resume();
            promptWithStatus();
        })(); // end async IIFE
    }
    rl.on("line", (input) => {
        // If a permission question is active, rl.question() handles it — don't process here
        if (permissions.questionActive)
            return;
        // Triple backtick multiline mode
        if (input.trim() === "```" && !multilineBacktick && !multilineBackslash) {
            multilineBacktick = true;
            multilineBuffer = [];
            process.stdout.write(chalk.dim("  ... "));
            return;
        }
        if (input.trim() === "```" && multilineBacktick) {
            multilineBacktick = false;
            const fullInput = multilineBuffer.join("\n");
            multilineBuffer = [];
            if (!fullInput.trim() || processing) {
                rl.prompt();
                return;
            }
            processInput(fullInput);
            return;
        }
        if (multilineBacktick) {
            multilineBuffer.push(input);
            process.stdout.write(chalk.dim("  ... "));
            return;
        }
        // Backslash continuation: \ as very last char (no trailing whitespace)
        if (input.endsWith("\\") && !input.endsWith("\\\\")) {
            if (!multilineBackslash) {
                multilineBackslash = true;
                multilineBuffer = [input.slice(0, -1)];
            }
            else {
                multilineBuffer.push(input.slice(0, -1));
            }
            process.stdout.write(chalk.dim("  ... "));
            return;
        }
        if (multilineBackslash) {
            // This line doesn't end with \ — it's the final line
            multilineBackslash = false;
            multilineBuffer.push(input);
            const fullInput = multilineBuffer.join("\n");
            multilineBuffer = [];
            if (!fullInput.trim() || processing) {
                rl.prompt();
                return;
            }
            processInput(fullInput);
            return;
        }
        const trimmed = input.trim();
        if (!trimmed || processing) {
            if (!processing)
                rl.prompt();
            return;
        }
        // ! prefix for direct bash execution
        if (trimmed.startsWith("!")) {
            const cmd = trimmed.slice(1).trim();
            if (cmd) {
                try {
                    const output = execSync(cmd, { cwd: workingDir, encoding: "utf-8", timeout: 30000 });
                    if (output.trim())
                        console.log(output);
                }
                catch (err) {
                    console.log(chalk.red(err.stderr || err.message));
                }
            }
            rl.prompt();
            return;
        }
        // Handle slash commands
        if (trimmed.startsWith("/")) {
            processing = true;
            rl.pause();
            handleSlashCommand(trimmed, cmdCtx).then(() => {
                processing = false;
                rl.resume();
                promptWithStatus();
            });
            return;
        }
        processInput(trimmed);
    });
    rl.on("close", () => {
        logger.info("Session ended", { totalTokens: session.totalTokens, messages: session.messages.length });
        logger.flush();
        const cleanup = () => {
            saveSession(session);
            exitTerminal();
            console.log(chalk.dim("  Goodbye!"));
            process.exit(0);
        };
        if (processing) {
            const checkDone = setInterval(() => {
                if (!processing) {
                    clearInterval(checkDone);
                    cleanup();
                }
            }, 500);
        }
        else {
            cleanup();
        }
    });
}
