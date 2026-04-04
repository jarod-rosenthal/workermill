import React, { useState, useCallback, useRef, useEffect } from "react";
import { useApp } from "ink";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { useAgent } from "./useAgent.js";
import { useOrchestrator } from "./useOrchestrator.js";
import { App } from "./App.js";
import { handleSlashCommand as dispatchSlashCommand, getGitBranch, type SlashCommandContext } from "./slash-commands.js";
import type { UseAgentOptions } from "./useAgent.js";
import { findModelInfo } from "../provider-registry.js";
import { resolveConfig, getProviderForPersona } from "../config.js";

/**
 * Resolve context window for a model.
 * Ollama: uses the user's configured contextLength.
 * Cloud: looks up from the pricing/model registry.
 * Fallback: 128k.
 */
function resolveContextWindow(provider: string, model: string, configContextLength?: number): number {
  if (provider === "ollama" || provider === "lmstudio") {
    return configContextLength || 128_000;
  }
  const info = findModelInfo(model);
  return info?.contextWindow || 128_000;
}

// ---------------------------------------------------------------------------
// History persistence
// ---------------------------------------------------------------------------

const HISTORY_DIR = path.join(os.homedir(), ".workermill");
const HISTORY_FILE = path.join(HISTORY_DIR, "history");
const MAX_HISTORY = 1000;

function loadHistory(): string[] {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = fs.readFileSync(HISTORY_FILE, "utf-8").trim();
      if (!raw) return [];
      return raw.split("\n").slice(-MAX_HISTORY);
    }
  } catch {
    // Ignore read errors — start with empty history.
  }
  return [];
}

function appendHistory(line: string): void {
  try {
    if (!fs.existsSync(HISTORY_DIR)) {
      fs.mkdirSync(HISTORY_DIR, { recursive: true });
    }
    fs.appendFileSync(HISTORY_FILE, line + "\n", "utf-8");
  } catch {
    // Ignore write errors — history is best-effort.
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RootProps extends UseAgentOptions {
  workingDir: string;
  /** Display strings for each role (e.g. "ollama/qwen3-coder:30b"). */
  roleModels?: { worker: string; planner: string; reviewer: string };
  /** Resolved CLI config (includes --auto-revise and other CLI overrides). */
  cliConfig?: import("../config.js").CliConfig;
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

/**
 * Root wrapper that connects the useAgent hook to the App component.
 * Handles ALL slash commands with static output (no LLM involvement),
 * shell escapes via `!`, and persistent input history.
 */
export function Root(props: RootProps): React.ReactElement {
  const { exit } = useApp();

  // Refresh git branch — extracted before useAgent so it can be passed as callback.
  const [gitBranch, setGitBranch] = useState(() => getGitBranch());
  const refreshGitBranch = useCallback(() => {
    import("child_process").then(({ exec: cpExec }) => {
      cpExec("git rev-parse --abbrev-ref HEAD", {
        cwd: process.cwd(),
        encoding: "utf-8",
        timeout: 2000,
      }, (_err, stdout) => {
        const branch = stdout?.trim();
        if (branch && branch !== "HEAD") {
          setGitBranch(prev => prev === branch ? prev : branch);
        }
      });
    });
  }, []);

  const agent = useAgent({ ...props, onBashComplete: refreshGitBranch });

  // Active provider/model/context — starts from props, updates on /model switch
  const [activeProvider, setActiveProvider] = useState(props.provider);
  const [activeModel, setActiveModel] = useState(props.model);
  const [activeContext, setActiveContext] = useState(
    resolveContextWindow(props.provider, props.model, props.contextLength)
  );
  // Role models — updates when planner/reviewer are switched via /model
  const [roleModels, setRoleModels] = useState(props.roleModels);

  // Wrap switchModel to also update the display state
  const switchModelAndDisplay = useCallback((provider: string, model: string) => {
    agent.switchModel(provider, model);
    setActiveProvider(provider);
    setActiveModel(model);
    // Re-resolve context from config (switchModel may have updated it)
    const cfg = resolveConfig();
    const provCfg = cfg?.providers?.[provider];
    setActiveContext(resolveContextWindow(provider, model, provCfg?.contextLength));
  }, [agent]);

  // Orchestrator for /build — pushes messages via agent.addSystemMessage
  const addOrchestratorMessage = useCallback(
    (content: string, role?: "user" | "assistant") => {
      if (role === "user") {
        agent.addUserMessage(content);
      } else {
        agent.addSystemMessage(content);
      }
    },
    [agent],
  );
  const [tokPerSec, setTokPerSecMap] = useState<Record<string, number>>({});
  const handleTokPerSec = useCallback((providerModel: string, tps: number) => {
    setTokPerSecMap(prev => ({ ...prev, [providerModel]: tps }));
  }, []);
  const orchestrator = useOrchestrator(
    addOrchestratorMessage,
    agent.setCost,
    props.cliConfig,
    agent.incrementToolCount,
    setGitBranch,
    handleTokPerSec,
  );

  // Track the last build task for /retry
  const lastBuildTask = useRef<string | null>(null);

  const [inputHistory, setInputHistory] = useState<string[]>(() => loadHistory());
  // Poll git branch every 5s (immediate refresh happens via onBashComplete)
  useEffect(() => {
    const id = setInterval(refreshGitBranch, 5_000);
    return () => clearInterval(id);
  }, [refreshGitBranch]);

  // Push an entry to the in-memory and on-disk history.
  const pushHistory = useCallback((line: string) => {
    setInputHistory((prev) => {
      const next = [...prev, line].slice(-MAX_HISTORY);
      return next;
    });
    appendHistory(line);
  }, []);

  // ------- Slash-command handler ------- //

  const handleSlashCommand = useCallback(
    (input: string): boolean => {
      const ctx: SlashCommandContext = {
        addSystemMessage: agent.addSystemMessage,
        addUserMessage: agent.addUserMessage,
        submit: agent.submit,
        provider: activeProvider,
        model: activeModel,
        workingDir: props.workingDir,
        session: agent.session,
        cost: agent.cost,
        tokens: agent.tokens,
        permissionMode: agent.permissionMode,
        trustAll: props.trustAll,
        isTrustAll: agent.isBypassMode,
        planMode: props.planMode,
        setPlanMode: agent.setPlanMode,
        setTrustAll: agent.setTrustAll,
        allowTool: agent.allowTool,
        denyTool: agent.denyTool,
        orchestratorRunning: orchestrator.running,
        startOrchestrator: orchestrator.start,
        retryOrchestrator: orchestrator.retry,
        startReview: (trustAll: boolean | (() => boolean), sandboxed: boolean, target?: string) => orchestrator.review(trustAll, sandboxed, target),
        lastBuildTask: lastBuildTask.current,
        setLastBuildTask: (task: string) => { lastBuildTask.current = task; },
        sandboxed: props.sandboxed,
        exit,
        switchModel: switchModelAndDisplay,
        updateRoleModels: () => {
          try {
            const cfg = resolveConfig();
            const w = getProviderForPersona(cfg);
            const p = getProviderForPersona(cfg, "planner");
            const r = getProviderForPersona(cfg, "tech_lead");
            setRoleModels({
              worker: `${w.provider}/${w.model}`,
              planner: `${p.provider}/${p.model}`,
              reviewer: `${r.provider}/${r.model}`,
            });
          } catch { /* config not ready */ }
        },
        forceCompact: agent.forceCompact,
      };
      return dispatchSlashCommand(input, ctx);
    },
    [agent, props, exit, orchestrator],
  );

  // ------- Shell escape handler ------- //

  const handleShellEscape = useCallback(
    (input: string): boolean => {
      if (!input.startsWith("!")) return false;

      const bashCmd = input.slice(1).trim();
      if (!bashCmd) {
        agent.addSystemMessage("Usage: `!<command>` -- run a shell command and display the output.");
        return true;
      }

      let output: string;
      let exitCode = 0;
      try {
        output = execSync(bashCmd, {
          cwd: props.workingDir,
          encoding: "utf-8",
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
        });
      } catch (err: unknown) {
        const execErr = err as { stdout?: string; stderr?: string; status?: number };
        output = (execErr.stdout || "") + (execErr.stderr || "");
        exitCode = execErr.status ?? 1;
      }

      const trimmedOutput = output.trim();
      const header = exitCode !== 0 ? `\`$ ${bashCmd}\` (exit ${exitCode})` : `\`$ ${bashCmd}\``;
      if (trimmedOutput) {
        agent.addSystemMessage(`${header}\n\n\`\`\`\n${trimmedOutput}\n\`\`\``);
      } else {
        agent.addSystemMessage(`${header}\n\n(no output)`);
      }

      // Update branch immediately — user just ran a shell command
      setGitBranch(getGitBranch());

      return true;
    },
    [agent, props.workingDir],
  );

  // ------- Main submit handler ------- //

  const handleSubmit = useCallback(
    (input: string) => {
      const trimmed = input.trim();
      if (!trimmed) return;

      // Record in history (all inputs, including commands).
      pushHistory(trimmed);

      // Catch CLI flags typed in chat
      if (trimmed === "--resume" || trimmed === "--fork") {
        agent.addSystemMessage(`\`${trimmed}\` is a launch flag, not a chat command. Use it when starting workermill:\n\n  \`workermill ${trimmed}\``);
        return;
      }

      // Slash commands -- fully static, no LLM.
      if (handleSlashCommand(trimmed)) {
        return;
      }

      // Shell escape -- execute locally, display result.
      if (handleShellEscape(trimmed)) {
        return;
      }

      // Regular prompt — send to agent. Git branch polled by interval.
      agent.submit(trimmed);
    },
    [agent, pushHistory, handleSlashCommand, handleShellEscape],
  );

  return (
    <App
      provider={activeProvider}
      model={activeModel}
      workingDir={props.workingDir}
      maxContext={activeContext}
      trustAll={props.trustAll}
      planMode={props.planMode}
      onSubmit={handleSubmit}
      onCancel={orchestrator.running ? orchestrator.cancel : agent.cancel}
      onRollback={agent.rollback}
      onCyclePermissionMode={agent.cyclePermissionMode}
      permissionMode={agent.permissionMode}
      messages={agent.messages}
      status={orchestrator.running ? "tool_running" : agent.status}
      statusDetail={orchestrator.running ? orchestrator.statusMessage : agent.statusDetail}
      permissionRequest={agent.permissionRequest}
      orchestratorConfirm={orchestrator.confirmRequest}
      orchestratorStatus={orchestrator.statusMessage}
      buildPreviewLine={orchestrator.previewLine}
      streamingToolCalls={agent.streamingToolCalls}
      tokens={agent.tokens}
      cost={agent.cost}
      gitBranch={gitBranch}
      inputHistory={inputHistory}
      roleModels={roleModels}
      toolCounts={agent.toolCounts}
      sessionStart={agent.sessionStart}
      tokPerSec={{ ...agent.tokPerSec, ...tokPerSec }}
    />
  );
}
