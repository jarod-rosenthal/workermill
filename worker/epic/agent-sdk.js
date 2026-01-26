/**
 * Agent SDK Wrapper for Epic Executor
 *
 * Spawns the Claude CLI (@anthropic-ai/claude-code) as a subprocess
 * with streaming JSON output for real tool execution.
 */
import { spawn } from "child_process";
import { createInterface } from "readline";
import axios from "axios";
/**
 * Run an agent with real tool execution via Claude CLI.
 * The agent can Read, Write, Edit files and run Bash commands.
 */
export async function runAgent(config, options) {
    const messages = [];
    // Track token usage for cost reporting (use Math.max since Claude reports cumulative)
    const tokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
    };
    let modelUsed = options.expertConfig.model || "sonnet";
    let lastPartialReportTime = 0;
    const PARTIAL_REPORT_INTERVAL = 30000; // 30 seconds
    // Build allowed tools list (only built-in tools)
    const allowedTools = filterBuiltinTools(options.expertConfig.tools);
    // Build environment variables for coordination
    // Note: TASK_ID uses parentTaskId (the WorkerTask ID) for API compatibility
    // The storyId is a WorkerContext ID which can't be used as taskId (foreign key constraint)
    const agentEnv = {
        ...process.env,
        ...options.env,
        API_BASE_URL: config.apiBaseUrl,
        ORG_API_KEY: config.orgApiKey,
        PARENT_TASK_ID: config.parentTaskId,
        TASK_ID: config.parentTaskId, // Use parent task ID for coordination posts
        STORY_ID: options.storyId, // Story context ID available if needed
        PERSONA: options.expertConfig.persona,
        // Required for Claude CLI
        ANTHROPIC_API_KEY: config.anthropicApiKey,
    };
    // Claude CLI is installed globally in the container
    const claudeCli = "claude";
    // Build CLI arguments - don't use --system-prompt (causes escaping issues with special chars)
    // Instead, prepend role context to the main prompt
    const args = [
        "--print", // Non-interactive mode
        "--verbose", // Required for stream-json with --print
        "--output-format", "stream-json", // Streaming JSON output
        "--model", mapModel(options.expertConfig.model),
        "--permission-mode", "bypassPermissions", // Allow all tool execution
    ];
    // Add allowed tools
    if (allowedTools.length > 0) {
        args.push("--allowedTools", allowedTools.join(","));
    }
    // Combine full system prompt with main prompt
    // The systemPrompt includes coordination instructions with curl examples for inter-agent communication
    // Since we pass via stdin (not CLI args), escaping is handled correctly
    const fullPrompt = options.expertConfig.systemPrompt + "\n\n---\n\n" + options.prompt;
    // NOTE: Prompt will be passed via stdin, not as command line argument
    // This avoids issues with special characters and very long prompts
    console.log(`[AgentSDK] Spawning Claude CLI for ${options.expertConfig.persona}`);
    console.log(`[AgentSDK] Working directory: ${options.repoPath}`);
    console.log(`[AgentSDK] Model: ${mapModel(options.expertConfig.model)}`);
    console.log(`[AgentSDK] Tools: ${allowedTools.join(", ")}`);
    // Debug: Log the full command for troubleshooting
    const promptPreview = options.prompt.substring(0, 200).replace(/\n/g, "\\n");
    console.log(`[AgentSDK] Prompt preview: ${promptPreview}...`);
    console.log(`[AgentSDK] Prompt length: ${options.prompt.length} chars`);
    return new Promise((resolve) => {
        let agentProcess;
        try {
            console.log(`[AgentSDK] Spawn command: ${claudeCli}`);
            console.log(`[AgentSDK] Spawn args count: ${args.length}`);
            agentProcess = spawn(claudeCli, args, {
                cwd: options.repoPath,
                env: agentEnv,
                stdio: ["pipe", "pipe", "pipe"],
                // Removed shell: true - can cause stdout buffering and escaping issues
            });
            console.log(`[AgentSDK] Process spawned, PID: ${agentProcess.pid}`);
            // Write prompt to stdin and close - Claude CLI reads from stdin in --print mode
            agentProcess.stdin.write(fullPrompt);
            agentProcess.stdin.end();
            console.log(`[AgentSDK] Wrote prompt to stdin (${fullPrompt.length} chars) and closed`);
        }
        catch (spawnError) {
            const errorMsg = spawnError instanceof Error ? spawnError.message : String(spawnError);
            console.error("[AgentSDK] Failed to spawn Claude CLI:", errorMsg);
            resolve({
                success: false,
                messages,
                error: `Failed to spawn Claude CLI: ${errorMsg}`,
            });
            return;
        }
        let lastOutput = "";
        let hasError = false;
        let errorMessage = "";
        // Log raw stdout for debugging - full content, no truncation
        agentProcess.stdout.on("data", (data) => {
            console.log(`[AgentSDK] stdout: ${data.toString()}`);
        });
        // Process stdout line by line (stream-json outputs one JSON per line)
        const rl = createInterface({
            input: agentProcess.stdout,
            crlfDelay: Infinity,
        });
        rl.on("line", (line) => {
            if (!line.trim())
                return;
            try {
                const event = JSON.parse(line);
                const parsedMessages = parseStreamEvent(event);
                // Extract token usage from event
                const hadUsage = extractUsageFromEvent(event, tokenUsage);
                // Track model if specified
                if (event.model) {
                    modelUsed = event.model;
                }
                // Report partial tokens periodically (every 30 seconds)
                const now = Date.now();
                if (hadUsage && now - lastPartialReportTime >= PARTIAL_REPORT_INTERVAL) {
                    lastPartialReportTime = now;
                    reportPartialTokenUsage(config, tokenUsage, modelUsed).catch((err) => {
                        console.error("[AgentSDK] Failed to report partial tokens:", err);
                    });
                }
                // Process ALL messages from this event (thinking, text, tool_use, etc.)
                for (const streamMsg of parsedMessages) {
                    messages.push(streamMsg);
                    options.onMessage?.(streamMsg);
                    // Track the last text output
                    if (streamMsg.type === "text" && streamMsg.content) {
                        lastOutput = streamMsg.content;
                    }
                    else if (streamMsg.type === "result" && streamMsg.content) {
                        lastOutput = streamMsg.content;
                    }
                }
            }
            catch {
                // Not JSON, might be raw output
                console.log(`[AgentSDK] Raw output: ${line}`);
            }
        });
        // Capture stderr for errors - log immediately for debugging
        let stderrBuffer = "";
        agentProcess.stderr.on("data", (data) => {
            const text = data.toString();
            stderrBuffer += text;
            // Log stderr in real-time for debugging
            console.error(`[AgentSDK] stderr: ${text.trim()}`);
        });
        agentProcess.on("error", (err) => {
            hasError = true;
            errorMessage = err.message;
            console.error("[AgentSDK] Process error:", err.message);
        });
        agentProcess.on("close", async (code) => {
            console.log(`[AgentSDK] Process exited with code ${code}`);
            if (stderrBuffer) {
                console.log(`[AgentSDK] stderr buffer: ${stderrBuffer.substring(0, 500)}`);
            }
            if (code !== 0 && !hasError) {
                hasError = true;
                errorMessage = stderrBuffer || `Process exited with code ${code}`;
            }
            // Report final token usage (even on failure to capture partial work)
            console.log(`[AgentSDK] Final token usage: input=${tokenUsage.inputTokens}, output=${tokenUsage.outputTokens}, cache_create=${tokenUsage.cacheCreationTokens}, cache_read=${tokenUsage.cacheReadTokens}`);
            try {
                await reportPartialTokenUsage(config, tokenUsage, modelUsed);
                console.log(`[AgentSDK] Token usage reported successfully`);
            }
            catch (err) {
                console.error(`[AgentSDK] Failed to report final token usage:`, err);
            }
            if (hasError) {
                console.error(`[AgentSDK] Agent failed: ${errorMessage}`);
                resolve({
                    success: false,
                    messages,
                    error: errorMessage,
                });
            }
            else {
                console.log(`[AgentSDK] Agent completed successfully`);
                // Add final result message if we have output
                if (lastOutput && !messages.some((m) => m.type === "result")) {
                    const resultMsg = { type: "result", content: lastOutput };
                    messages.push(resultMsg);
                    options.onMessage?.(resultMsg);
                }
                resolve({ success: true, messages });
            }
        });
    });
}
/**
 * Extract token usage from a stream event.
 * Claude reports cumulative tokens, so we use Math.max to track the highest values.
 * Returns true if usage data was found.
 */
function extractUsageFromEvent(event, tokenUsage) {
    // Check multiple paths where usage might appear
    const usagePaths = [
        event.usage,
        event.message?.usage,
        event.result?.usage,
        event.delta?.usage,
        event.content_block?.usage,
    ];
    for (const usage of usagePaths) {
        if (usage && typeof usage === "object") {
            const u = usage;
            if (typeof u.input_tokens === "number") {
                tokenUsage.inputTokens = Math.max(tokenUsage.inputTokens, u.input_tokens);
            }
            if (typeof u.output_tokens === "number") {
                tokenUsage.outputTokens = Math.max(tokenUsage.outputTokens, u.output_tokens);
            }
            if (typeof u.cache_creation_input_tokens === "number") {
                tokenUsage.cacheCreationTokens = Math.max(tokenUsage.cacheCreationTokens, u.cache_creation_input_tokens);
            }
            if (typeof u.cache_read_input_tokens === "number") {
                tokenUsage.cacheReadTokens = Math.max(tokenUsage.cacheReadTokens, u.cache_read_input_tokens);
            }
            return true;
        }
    }
    return false;
}
/**
 * Report partial token usage to the WorkerMill API.
 * Uses the /usage/partial endpoint which uses GREATEST() or additive mode.
 * Epic mode uses additive since each story is a separate Claude session.
 */
async function reportPartialTokenUsage(config, tokenUsage, model) {
    // Skip if no tokens yet
    if (tokenUsage.inputTokens === 0 && tokenUsage.outputTokens === 0) {
        return;
    }
    const url = `${config.apiBaseUrl}/api/tasks/${config.parentTaskId}/usage/partial`;
    try {
        await axios.post(url, {
            inputTokens: tokenUsage.inputTokens,
            outputTokens: tokenUsage.outputTokens,
            cacheCreationTokens: tokenUsage.cacheCreationTokens,
            cacheReadTokens: tokenUsage.cacheReadTokens,
            // Use additive mode for Epic since each story is a separate Claude session
            mode: "add",
        }, {
            headers: {
                "Content-Type": "application/json",
                "x-api-key": config.orgApiKey,
            },
            timeout: 5000,
        });
    }
    catch (err) {
        // Log but don't throw - token reporting is best-effort
        console.error("[AgentSDK] Partial token report failed:", err instanceof Error ? err.message : String(err));
    }
}
/**
 * Filter to only built-in tools that the Claude CLI supports.
 */
function filterBuiltinTools(tools) {
    const builtins = ["Read", "Write", "Edit", "Bash", "Glob", "Grep"];
    return tools.filter((t) => builtins.includes(t));
}
/**
 * Map model names to Claude CLI format.
 */
function mapModel(model) {
    // CLI accepts shorthand model names
    if (model.includes("opus"))
        return "opus";
    if (model.includes("sonnet"))
        return "sonnet";
    if (model.includes("haiku"))
        return "haiku";
    return model;
}
/**
 * Parse a streaming JSON event into StreamMessages.
 * Returns an array because a single event can contain multiple content blocks
 * (e.g., thinking + text + tool_use).
 */
function parseStreamEvent(event) {
    const messages = [];
    const eventType = event.type;
    // Assistant message with content - process ALL content blocks
    if (eventType === "assistant" && event.message) {
        const message = event.message;
        if (message.content && Array.isArray(message.content)) {
            for (const block of message.content) {
                // Handle thinking blocks (Claude's extended thinking)
                if (block.type === "thinking" && block.thinking) {
                    messages.push({ type: "thinking", content: block.thinking });
                }
                // Handle text blocks
                if (block.type === "text" && block.text) {
                    messages.push({ type: "text", content: block.text });
                }
                // Handle tool use blocks
                if (block.type === "tool_use" && block.name) {
                    messages.push({
                        type: "tool_use",
                        toolName: block.name,
                        toolInput: block.input,
                    });
                }
            }
        }
    }
    // Content block delta (streaming text)
    if (eventType === "content_block_delta" && event.delta) {
        const delta = event.delta;
        if (delta.type === "text_delta" && delta.text) {
            messages.push({ type: "text", content: delta.text });
        }
        if (delta.type === "thinking_delta" && delta.thinking) {
            messages.push({ type: "thinking", content: delta.thinking });
        }
    }
    // Tool use event
    if (eventType === "tool_use") {
        messages.push({
            type: "tool_use",
            toolName: event.name,
            toolInput: event.input,
        });
    }
    // Tool result event
    if (eventType === "tool_result") {
        messages.push({ type: "tool_result" });
    }
    // Final result
    if (eventType === "result") {
        messages.push({ type: "result", content: event.result || event.output });
    }
    // Text event
    if (eventType === "text") {
        messages.push({ type: "text", content: event.content || event.text });
    }
    return messages;
}
//# sourceMappingURL=agent-sdk.js.map