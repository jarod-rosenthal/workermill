import React, { useRef, useState, useEffect } from "react";
import { Box, Text, Static, useApp, useInput, useStdout } from "ink";
import { Markdown } from "./Markdown.js";
import { ToolCallDisplay } from "./ToolCall.js";
import { PermissionPrompt } from "./PermissionPrompt.js";
import { StatusBar } from "./StatusBar.js";
import { Input } from "./Input.js";
import { theme } from "./theme.js";
import { stopAllMCPServers } from "../mcp-client.js";
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
  /** Latest build output line — rendered at cursor in dynamic area. */
  buildPreviewLine?: string;
  /** Streaming tool calls — only latest shown in dynamic area during execution. */
  streamingToolCalls?: ToolCallInfo[];
}

/** Static activity dot — no animation, no re-renders. */
function Spinner({ color }: { color: string }): React.ReactElement {
  return <Text color={color}>●</Text>;
}

/** Confirm prompt for orchestrator — context-aware options. */
function OrchestratorConfirm({ request }: { request: { prompt: string; resolve: (yes: boolean, mode?: "always" | "trust") => void } }): React.ReactElement {
  const [answered, setAnswered] = React.useState(false);
  const isToolPrompt = request.prompt.startsWith("Allow ");
  const isRevisionPrompt = request.prompt.startsWith("Revise ");
  const hasAlways = isToolPrompt || isRevisionPrompt;
  useInput((input) => {
    if (answered) return;
    if (input === "y" || input === "Y") { setAnswered(true); request.resolve(true); }
    if (input === "n" || input === "N") { setAnswered(true); request.resolve(false); }
    if (hasAlways && (input === "a" || input === "A")) { setAnswered(true); request.resolve(true, "always"); }
    if (isToolPrompt && (input === "t" || input === "T")) { setAnswered(true); request.resolve(true, "trust"); }
  }, { isActive: !answered });

  let hint = "(y/n)";
  if (isToolPrompt) hint = "(y)es (a)lways (t)rust all (n)o";
  else if (isRevisionPrompt) hint = "(y)es (a)lways (n)o";

  return (
    <Box marginLeft={2} marginY={1}>
      <Text color={theme.permission}>{request.prompt} </Text>
      <Text dimColor>{hint}</Text>
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
  const width = stdout?.columns || 80;

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
    if (key.tab && key.shift && props.status === "idle") {
      props.onCyclePermissionMode();
      return;
    }

    // Double Ctrl+C when idle to exit
    if (key.ctrl && input === "c") {
      const now = Date.now();
      if (props.status === "idle" && now - lastCtrlCRef.current < 500) {
        stopAllMCPServers();
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

  return (
    <Box flexDirection="column" width="100%">
      {/* Header is printed by printWelcome() in index.ts via console.log
         before Ink takes over — no Static header needed here. */}

      {/* Committed messages — rendered once via Static as they arrive */}
      <Static items={props.messages}>
        {(message) => (
          <Box key={message.id} flexDirection="column" marginTop={message.role === "user" ? 1 : 0}>
            {message.role === "user" ? (
              <Box marginLeft={1}>
                <Text color={theme.brand} bold>{"❱ "}</Text>
                <Text color={theme.text}>{message.content}</Text>
              </Box>
            ) : (
              <Box flexDirection="column" marginLeft={2}>
                {message.toolCalls?.map((tc) => (
                  <ToolCallDisplay key={tc.id} tool={tc} />
                ))}
                {message.content ? (
                  <Markdown content={message.content} />
                ) : null}
              </Box>
            )}
          </Box>
        )}
      </Static>

      {/* Dynamic area */}
      <Box flexDirection="column">
        {/* Latest tool call — only when active */}
        {props.streamingToolCalls && props.streamingToolCalls.length > 0 ? (
          <Box marginLeft={2} height={1}>
            <ToolCallDisplay tool={props.streamingToolCalls[props.streamingToolCalls.length - 1]} />
          </Box>
        ) : null}

        {/* Activity indicator — only when active */}
        {props.status !== "idle" || props.orchestratorStatus ? (
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
            ) : (
              <Text>{" "}</Text>
            )}
          </Box>
        ) : null}

        {/* Permission/confirm prompts — replace input when active */}
        {props.permissionRequest ? (
          <PermissionPrompt request={props.permissionRequest} />
        ) : props.orchestratorConfirm ? (
          <OrchestratorConfirm request={props.orchestratorConfirm} />
        ) : (
          <>
            {/* User input */}
            <Input
              onSubmit={props.onSubmit}
              isActive={props.status === "idle" && !props.orchestratorStatus}
              history={props.inputHistory}
            />

            {/* Status bar */}
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
            />
          </>
        )}
      </Box>
    </Box>
  );
}
