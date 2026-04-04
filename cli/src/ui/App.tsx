import React, { useRef, useState, useEffect } from "react";
import { Box, Text, Static, useApp, useInput, useStdout } from "ink";
import { Markdown } from "./Markdown.js";
import { ToolCallDisplay } from "./ToolCall.js";
import { PermissionPrompt } from "./PermissionPrompt.js";
import { StatusBar } from "./StatusBar.js";
import { Input } from "./Input.js";
import { theme } from "./theme.js";
import {
  getAssistantMarginTop,
  normalizeAssistantContent,
  shouldRenderUserDivider,
} from "./transcript-layout.js";
import { stopAllMCPServers } from "../mcp-client.js";
import { shutdown as shutdownLSP } from "../../../packages/engine/src/tools/lsp.js";
import { browserClose } from "../browser.js";
import type {
  Message,
  ToolCallInfo,
  PermissionRequest,
  AgentStatus,
} from "./types.js";

interface AppProps {
  provider: string;
  model: string;
  workingDir: string;
  maxContext: number;
  trustAll: boolean;
  planMode: boolean;
  /** Called when the user submits a new prompt. */
  onSubmit: (input: string) => void;
  /** Called when the user presses ESC to cancel the running agent. */
  onCancel: () => void;
  /** Called on double-ESC to roll back the last exchange. */
  onRollback: () => boolean;
  /** Called when user cycles permission mode with Shift+Tab. */
  onCyclePermissionMode: () => void;
  /** Current permission mode label for status bar. */
  permissionMode: string;
  /** Committed (finalized) messages for the conversation history. */
  messages: Message[];
  /** Current agent status. */
  status: AgentStatus;
  /** Human-readable detail for the current status. */
  statusDetail?: string;
  /** Active permission request, if any. */
  permissionRequest: PermissionRequest | null;
  /** Orchestrator confirm request (yes/no) */
  orchestratorConfirm: { prompt: string; resolve: (yes: boolean) => void } | null;
  /** Orchestrator status message (spinner replacement) */
  orchestratorStatus: string;
  /** Total tokens used in the session. */
  tokens: number;
  /** Total cost accumulated in the session. */
  cost: number;
  /** Current git branch name (empty string if not in a repo). */
  gitBranch: string;
  /** Past user inputs for history navigation. */
  inputHistory: string[];
  /** Display strings for each role. */
  roleModels?: { worker: string; planner: string; reviewer: string };
  /** Tool usage counts. */
  toolCounts?: Record<string, number>;
  /** Number of MCP server connections. */
  mcpCount?: number;
  /** Session start time (ms). */
  sessionStart?: number;
  /** Whether project instructions are loaded. */
  hasInstructions?: boolean;
  /** Latest build output line — rendered in the dynamic area above prompts. */
  buildPreviewLine?: string;
  /** Streaming tool calls — only latest shown in dynamic area during execution. */
  streamingToolCalls?: ToolCallInfo[];
  /** Tokens-per-second map keyed by provider/model. */
  tokPerSec?: Record<string, number>;
}

/** Static activity dot — no animation, no re-renders. */
function Spinner({ color }: { color: string }): React.ReactElement {
  return <Text color={color}>●</Text>;
}

const ORCHESTRATOR_CONFIRM_ACK_MS = 450;
const KITTY_KEYBOARD_ENABLE = "\x1b[>1u";
const KITTY_KEYBOARD_DISABLE = "\x1b[<u";

function formatCount(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1)}m`;
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    return `${thousands % 1 === 0 ? thousands.toFixed(0) : thousands.toFixed(1)}k`;
  }
  return String(value);
}

function formatElapsed(elapsedMs: number): string {
  const secs = Math.max(1, Math.round(elapsedMs / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem === 0 ? `${mins}m` : `${mins}m ${rem}s`;
}

function formatTurnReceipt(receipt: NonNullable<Message["turnReceipt"]>): string {
  const toolsLabel = receipt.toolCalls === 1 ? "tool" : "tools";
  return `↳ in ${formatCount(receipt.inputTokens)} • out ${formatCount(receipt.outputTokens)} • ${formatElapsed(receipt.elapsedMs)} • ${receipt.toolCalls} ${toolsLabel} • ~$${receipt.turnCost.toFixed(2)}`;
}

/** Confirm prompt for orchestrator — context-aware options. */
function OrchestratorConfirm({ request }: { request: { prompt: string; resolve: (yes: boolean, mode?: "always" | "trust") => void } }): React.ReactElement {
  // Reuse PermissionPrompt for tool permission prompts — one component, consistent UX
  const isToolPrompt = request.prompt.startsWith("Allow ");
  const isDangerousPrompt = request.prompt.includes("dangerous operation") || request.prompt.includes("may be sensitive");
  if (isToolPrompt || isDangerousPrompt) {
    // Parse tool name from "Allow <toolname>? <detail>"
    const match = request.prompt.match(/^Allow (\w+)\??\s*(.*)/);
    const toolName = match?.[1] || (isDangerousPrompt ? "operation" : "tool");
    const detail = match?.[2] || (isDangerousPrompt ? request.prompt : "");
    return (
      <PermissionPrompt request={{
        toolName,
        toolInput: detail ? { _display: detail } : {},
        isDangerous: isDangerousPrompt,
        dangerLabel: isDangerousPrompt ? request.prompt : undefined,
        resolve: (allowed: boolean, mode?: "always" | "trust") => {
          request.resolve(allowed, mode);
        },
      }} />
    );
  }

  // Non-tool prompts (plan approval, revision confirm, PR push) — simple y/a/n
  const [answered, setAnswered] = React.useState<string>("");
  const isRevisionPrompt = request.prompt.startsWith("Revise ");
  useInput((input, key) => {
    if (answered) return;
    const resolve = (label: string, yes: boolean, mode?: "always" | "trust") => {
      setAnswered(label);
      setTimeout(() => request.resolve(yes, mode), ORCHESTRATOR_CONFIRM_ACK_MS);
    };
    if (key.escape) resolve("esc", false);
    else if (input === "y" || input === "Y") resolve("y", true);
    else if (input === "n" || input === "N") resolve("n", false);
    else if (isRevisionPrompt && (input === "a" || input === "A")) resolve("a", true, "always");
  }, { isActive: !answered });

  const hint = isRevisionPrompt ? "(y)es (a)lways (n)o" : "(y/n)";

  return (
    <Box marginLeft={2} marginY={1}>
      <Text color={theme.permission}>{request.prompt} </Text>
      {answered ? (
        <Text color={theme.success} bold>{answered}</Text>
      ) : (
        <Text dimColor>{hint}</Text>
      )}
    </Box>
  );
}

/**
 * Root application component for the terminal AI agent UI.
 * Composes all sub-components into a full-screen Ink layout:
 *   - Branded header with model/provider info
 *   - Scrolling message history (via Static)
 *   - Live streaming area for in-progress responses
 *   - Permission prompt overlay
 *   - Status bar with session metrics
 *   - User text input
 */
export function App(props: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const lastCtrlCRef = useRef(0);
  const lastEscRef = useRef(0);

  // Ask supporting terminals (wezterm/kitty/ghostty/etc.) to disambiguate key
  // input so modified Enter combos can be delivered distinctly.
  useEffect(() => {
    if (!process.stdout.isTTY) return;
    process.stdout.write(KITTY_KEYBOARD_ENABLE);
    return () => {
      try {
        process.stdout.write(KITTY_KEYBOARD_DISABLE);
      } catch {
        // Best-effort cleanup.
      }
    };
  }, []);

  useInput((input, key) => {
    if (key.escape) {
      const now = Date.now();

      if (props.status !== "idle") {
        // First ESC while running — cancel the current operation
        props.onCancel();
        lastEscRef.current = now;
        return;
      }

      // Double ESC while idle — roll back last exchange
      if (props.status === "idle" && now - lastEscRef.current < 1500) {
        props.onRollback();
        lastEscRef.current = 0; // reset so triple ESC doesn't keep rolling back
        return;
      }

      lastEscRef.current = now;
      return;
    }

    // Shift+Tab: cycle permission mode (ask → auto-edit → trust all)
    // Allow during any status except permission (where a prompt is active)
    if (key.tab && key.shift && props.status !== "permission") {
      props.onCyclePermissionMode();
      return;
    }

    // Double Ctrl+C when idle to exit
    if (key.ctrl && input === "c") {
      const now = Date.now();
      if (props.status === "idle" && now - lastCtrlCRef.current < 500) {
        stopAllMCPServers();
        shutdownLSP();
        void browserClose();
        exit();
        setTimeout(() => process.exit(0), 100);
        return;
      }
      lastCtrlCRef.current = now;
    }
  }, { isActive: true });

  const mode = props.planMode
    ? "PLAN"
    : props.permissionMode;

  // marginLeft={2} on assistant boxes consumes 2 cols; cap at a sane max
  const markdownWidth = Math.max(40, (stdout?.columns ?? 80) - 2);
  const turnDivider = "\u2500".repeat(Math.max(24, Math.min(markdownWidth - 2, 72)));

  return (
    <Box flexDirection="column" width="100%">
      {/* Committed messages — rendered once via Static */}
      <Static items={props.messages}>
        {(message) => {
          // Tool-only assistant placeholders are committed with empty content.
          // Hide them so transcript spacing stays clean and predictable.
          if (message.role === "assistant" && !message.content.trim()) return null;
          const messageIndex = props.messages.findIndex((m) => m.id === message.id);

          if (message.role === "user") {
            return (
              <Box key={message.id} flexDirection="column" marginTop={1}>
                {shouldRenderUserDivider(messageIndex) ? (
                  <Box marginLeft={1}>
                    <Text color={theme.subtleDark}>{turnDivider}</Text>
                  </Box>
                ) : null}
                <Box marginLeft={1}>
                  <Text color={theme.brand} bold>{"❱ "}</Text>
                  <Text color={theme.text}>{message.content}</Text>
                </Box>
              </Box>
            );
          }

          const normalizedContent = normalizeAssistantContent(message.content);
          const assistantNeedsGap = getAssistantMarginTop(props.messages, messageIndex) > 0;
          return (
            <Box key={message.id} flexDirection="column">
              {assistantNeedsGap ? <Box height={1} /> : null}
              <Box flexDirection="column" marginLeft={2}>
                <Markdown content={normalizedContent} width={markdownWidth} />
                {message.turnReceipt ? (
                  <Box flexDirection="column" marginTop={0}>
                    <Text color={theme.subtle} dimColor>{formatTurnReceipt(message.turnReceipt)}</Text>
                    <Text color={theme.subtleDark} dimColor>{"── end response ──"}</Text>
                  </Box>
                ) : null}
              </Box>
            </Box>
          );
        }}
      </Static>

      {/* Tool call/activity — fixed region above prompts and status bar */}
      <Box flexDirection="column" minHeight={2}>
        {props.streamingToolCalls && props.streamingToolCalls.length > 0 ? (
          <Box marginLeft={2}>
            <ToolCallDisplay tool={props.streamingToolCalls[props.streamingToolCalls.length - 1]} />
          </Box>
        ) : (
          <Box height={1} />
        )}

        <Box marginLeft={2} height={1}>
          {props.orchestratorStatus ? (
            <Text color={theme.warning}><Spinner color={theme.warning} /> {props.orchestratorStatus}</Text>
          ) : props.status === "thinking" ? (
            <Text color={theme.subtle}><Spinner color={theme.subtle} /> Thinking...</Text>
          ) : props.status === "streaming" ? (
            <Text color={theme.brand}><Spinner color={theme.brand} /> Streaming response...</Text>
          ) : props.status === "tool_running" ? (
            <Text color={theme.warning}><Spinner color={theme.warning} /> {props.statusDetail || "Running tool..."}</Text>
          ) : props.status === "permission" ? (
            <Text color={theme.permission}>● Waiting for permission...</Text>
          ) : props.buildPreviewLine ? (
            <Text color={theme.subtle}>{props.buildPreviewLine}</Text>
          ) : (
            <Text>{" "}</Text>
          )}
        </Box>
      </Box>

      {/* Permission/confirm prompts — shown above status bar when active */}
      {props.permissionRequest ? (
        <PermissionPrompt request={props.permissionRequest} />
      ) : props.orchestratorConfirm ? (
        <OrchestratorConfirm key={props.orchestratorConfirm.prompt} request={props.orchestratorConfirm} />
      ) : props.status === "idle" && !props.orchestratorStatus ? (
        <Input
          onSubmit={props.onSubmit}
          isActive={true}
          history={props.inputHistory}
        />
      ) : null
      }

      {/* Status bar — always visible */}
      <StatusBar
        model={props.model}
        provider={props.provider}
        tokens={props.tokens}
        maxContext={props.maxContext}
        cost={props.cost}
        mode={mode}
        gitBranch={props.gitBranch}
        cwd={props.workingDir.split("/").pop() || ""}
        roleModels={props.roleModels}
        toolCounts={props.toolCounts}
        mcpCount={props.mcpCount}
        sessionStart={props.sessionStart}
        hasInstructions={props.hasInstructions}
        tokPerSec={props.tokPerSec}
      />
    </Box>
  );
}
