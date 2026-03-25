import React, { useRef, useState, useEffect } from "react";
import { Box, Text, Static, useApp, useInput, useStdout } from "ink";
import { Markdown } from "./Markdown.js";
import { ToolCallDisplay } from "./ToolCall.js";
import { PermissionPrompt } from "./PermissionPrompt.js";
import { StatusBar } from "./StatusBar.js";
import { Input } from "./Input.js";
import { theme } from "./theme.js";
import type {
  Message,
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
  /** Committed (finalized) messages for the conversation history. */
  messages: Message[];
  /** Current agent status. */
  status: AgentStatus;
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
}

/** Braille spinner that animates every 80ms to show the terminal is alive. */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function Spinner({ color }: { color: string }): React.ReactElement {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(id);
  }, []);
  return <Text color={color}>{SPINNER_FRAMES[frame]}</Text>;
}

/** Simple yes/no confirm for orchestrator prompts. */
function OrchestratorConfirm({ request }: { request: { prompt: string; resolve: (yes: boolean) => void } }): React.ReactElement {
  const [answered, setAnswered] = React.useState(false);
  useInput((input) => {
    if (answered) return;
    if (input === "y" || input === "Y") { setAnswered(true); request.resolve(true); }
    if (input === "n" || input === "N") { setAnswered(true); request.resolve(false); }
  }, { isActive: !answered });
  return (
    <Box marginLeft={2} marginY={1}>
      <Text color={theme.permission}>{request.prompt} </Text>
      <Text dimColor>(y/n)</Text>
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
  const width = stdout?.columns || 80;

  useInput((input, key) => {
    // ESC cancels the running agent
    if (key.escape && props.status !== "idle") {
      props.onCancel();
      return;
    }

    // Double Ctrl+C when idle to exit
    if (key.ctrl && input === "c") {
      const now = Date.now();
      if (props.status === "idle" && now - lastCtrlCRef.current < 500) {
        exit();
        setTimeout(() => process.exit(0), 100);
        return;
      }
      lastCtrlCRef.current = now;
    }
  });

  const mode = props.planMode
    ? "PLAN"
    : props.trustAll
      ? "trust all"
      : "ask";

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

      {/* === Dynamic area — FIXED HEIGHT, never changes === */}
      {/* Only 3 lines ever: activity indicator + status bar + input */}

      {/* Line 1: Activity indicator (always exactly 1 line) */}
      <Box marginLeft={2} height={1}>
        {props.orchestratorStatus ? (
          <Text color={theme.warning}><Spinner color={theme.warning} /> {props.orchestratorStatus}</Text>
        ) : props.status === "thinking" ? (
          <Text color={theme.subtle}><Spinner color={theme.subtle} /> Thinking...</Text>
        ) : props.status === "streaming" ? (
          <Text color={theme.brand}><Spinner color={theme.brand} /> Streaming response...</Text>
        ) : props.status === "tool_running" ? (
          <Text color={theme.warning}><Spinner color={theme.warning} /> Running tool...</Text>
        ) : props.status === "permission" ? (
          <Text color={theme.permission}>● Waiting for permission...</Text>
        ) : (
          <Text>{" "}</Text>
        )}
      </Box>

      {/* Permission/confirm prompts — replace input when active */}
      {props.permissionRequest ? (
        <PermissionPrompt request={props.permissionRequest} />
      ) : props.orchestratorConfirm ? (
        <OrchestratorConfirm request={props.orchestratorConfirm} />
      ) : (
        <>
          {/* Line 2: Status bar */}
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
          />

          {/* Line 3: User input */}
          <Input
            onSubmit={props.onSubmit}
            isActive={props.status === "idle" && !props.orchestratorStatus}
            history={props.inputHistory}
          />
        </>
      )}
    </Box>
  );
}
