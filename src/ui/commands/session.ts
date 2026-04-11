/**
 * Session-management command handlers — extracted from slash-commands.ts
 *
 * Handles: /model, /cost, /status, /compact, /clear, /edit, /git, /diff, /changed, /sessions
 */

import { execFileSync, execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { listSessions, saveSession } from "../../session.js";
import { loadConfig, saveConfig } from "../../config.js";
import { getChangedFiles } from "../../checkpoints.js";
import { findModelInfo } from "../../provider-registry.js";
import { getApiKeyEnvVar, isLocalProvider as _isLocalProvider } from "../../provider-capabilities.js";
import type { SlashCommandContext } from "../slash-commands.js";
import { getGitStatus, handleSlashCommand } from "../slash-commands.js";

function splitEditorCommand(editor: string): string[] {
  return editor.split(/\s+/).filter(Boolean);
}

export function handleModelCommand(arg: string, ctx: SlashCommandContext): void {
  if (!arg) {
    ctx.addSystemMessage(
      `**Current model:** ${ctx.provider}/${ctx.model}\n\n` +
      "**Switch models:**\n" +
      "| What | Command |\n" +
      "|---|---|\n" +
      "| Worker model | `/model <provider>/<model>` |\n" +
      "| Planner model | `/model planner <provider>/<model>` |\n" +
      "| Reviewer model | `/model reviewer <provider>/<model>` |\n\n" +
      "Example: `/model reviewer openai/gpt-5.3-codex`\n\n" +
      "**Context window:** Add size after model name for local models:\n" +
      "`/model ollama/qwen3-coder:30b 64k` or `/model lmstudio/deepseek-r1 128k`\n" +
      "Local models default to 128k if not specified.\n\n" +
      "**Supported providers:** ollama, lmstudio, anthropic, openai, google\n\n" +
      "**Tip:** For a full catalog of available models, run \`wm models\` outside a session."
    );
  } else {
    // Detect role prefix: /model planner|reviewer <provider>/<model>
    const roleAliases: Record<string, string> = { planner: "planner", reviewer: "tech_lead", "tech_lead": "tech_lead" };
    const tokens = arg.split(/\s+/);
    let targetRole: string | null = null;
    let targetRoleDisplay: string | null = null;
    if (tokens.length >= 2 && roleAliases[tokens[0].toLowerCase()]) {
      targetRoleDisplay = tokens[0].toLowerCase();
      targetRole = roleAliases[targetRoleDisplay];
      tokens.shift(); // remove role prefix, rest is provider/model
    }
    const modelArg = tokens[0];
    // Check for optional context size (e.g. "256k", "128k", "1m")
    let contextOverride: number | undefined;
    let remainderStart = 1;
    if (tokens[1] && /^\d+[km]$/i.test(tokens[1])) {
      const ctxStr = tokens[1].toLowerCase();
      if (ctxStr.endsWith("m")) {
        contextOverride = parseInt(ctxStr, 10) * 1_048_576;
      } else {
        contextOverride = parseInt(ctxStr, 10) * 1024;
      }
      remainderStart = 2;
    }
    const remainder = tokens.slice(remainderStart).join(" ").trim();
    const modelParts = modelArg.split("/");
    let newProvider: string;
    let newModel: string;
    if (modelParts.length >= 2) {
      newProvider = modelParts[0];
      newModel = modelParts.slice(1).join("/");
    } else {
      newProvider = ctx.provider;
      newModel = modelArg;
    }

    // Check if the provider needs an API key and whether we have one
    const envVar = getApiKeyEnvVar(newProvider);
    const needsKey = !!envVar;
    const modelConfig = loadConfig();
    const existingProviderConfig = modelConfig?.providers?.[newProvider];
    const hasConfigKey = !!existingProviderConfig?.apiKey;
    const hasEnvKey = !!(envVar && process.env[envVar]);

    if (needsKey && !hasConfigKey && !hasEnvKey) {
      ctx.addSystemMessage(
        `**Cannot switch to \`${newProvider}\`** \u2014 no API key found.\n\n` +
        `Add your key: \`/settings key ${newProvider} <your-api-key>\`\n` +
        `Then run \`/model ${modelArg}\` again.`
      );
      return;
    }

    // Update config
    if (modelConfig) {
      if (!targetRole) {
        if (!modelConfig.providers[newProvider]) {
          const keyRef = hasEnvKey ? `{env:${envVar}}` : undefined;
          modelConfig.providers[newProvider] = { model: newModel, ...(keyRef ? { apiKey: keyRef } : {}), ...(contextOverride ? { contextLength: contextOverride } : {}) };
        } else {
          modelConfig.providers[newProvider].model = newModel;
          if (contextOverride) modelConfig.providers[newProvider].contextLength = contextOverride;
        }
        modelConfig.default = newProvider;
      } else {
        if (!modelConfig.providers[newProvider]) {
          const keyRef = hasEnvKey ? `{env:${envVar}}` : undefined;
          modelConfig.providers[newProvider] = { model: "", ...(keyRef ? { apiKey: keyRef } : {}) };
        }
        const roleProviderKey = `${newProvider}_${targetRole}`;
        const baseEntry = modelConfig.providers[newProvider];
        const apiKey = baseEntry?.apiKey || (hasEnvKey ? `{env:${envVar}}` : undefined);
        modelConfig.providers[roleProviderKey] = {
          model: newModel,
          ...(apiKey ? { apiKey } : {}),
          ...(baseEntry?.host ? { host: baseEntry.host } : {}),
          ...(contextOverride ? { contextLength: contextOverride } : {}),
        };
        modelConfig.routing = { ...modelConfig.routing, [targetRole]: roleProviderKey };
      }
      saveConfig(modelConfig);
    }

    // Display
    const ctxLabel = contextOverride
      ? ` (${contextOverride >= 1_048_576 ? `${contextOverride / 1_048_576}M` : `${contextOverride / 1024}k`} context)`
      : "";
    const roleLabel = targetRoleDisplay ? `**${targetRoleDisplay}** ` : "";

    if (targetRole) {
      ctx.addSystemMessage(
        `\n${roleLabel}switched to \`${newProvider}/${newModel}\`${ctxLabel} \u2014 active now.`
      );
      ctx.updateRoleModels?.();
    } else if (ctx.switchModel) {
      ctx.switchModel(newProvider, newModel);

      const isLocal = _isLocalProvider(newProvider);
      const configCtx = modelConfig?.providers?.[newProvider]?.contextLength;
      const newCtxWindow = contextOverride
        || (isLocal ? configCtx : undefined)
        || findModelInfo(newModel)?.contextWindow
        || (isLocal ? 128_000 : 256_000);
      const ctxHint = isLocal && !contextOverride && !configCtx
        ? `\n*Tip: Local models default to 128k context. Set explicitly: \`/model ${newProvider}/${newModel} 64k\`*`
        : "";
      if (ctx.tokens > 0 && ctx.tokens > newCtxWindow * 0.8 && ctx.forceCompact) {
        ctx.addSystemMessage(
          `\n**Model switched** to \`${newProvider}/${newModel}\`${ctxLabel || (isLocal ? ` (${newCtxWindow / 1024}k context)` : "")} \u2014 compacting conversation to fit...${ctxHint}`
        );
        void ctx.forceCompact().then(({ before, after }) => {
          ctx.addSystemMessage(`Compacted ${before} \u2192 ${after} messages.`);
        });
      } else {
        ctx.addSystemMessage(
          `\n**Model switched** to \`${newProvider}/${newModel}\`${ctxLabel || (isLocal ? ` (${newCtxWindow / 1024}k context)` : "")} \u2014 active now.${ctxHint}`
        );
      }
    } else {
      ctx.addSystemMessage(
        `**Model switched** to \`${newProvider}/${newModel}\` \u2014 config saved. Takes effect on next session.`
      );
    }

    // If there's a trailing command (e.g. "/model openai/gpt-5.4 /as backend_developer do X"),
    // dispatch it as a follow-up slash command.
    if (remainder.startsWith("/")) {
      handleSlashCommand(remainder, ctx);
    } else if (remainder) {
      ctx.submit(remainder);
    }
  }
}

export function handleCostCommand(_arg: string, ctx: SlashCommandContext): void {
  const costUsd = ctx.cost;
  const totalTokens = ctx.tokens;
  const sessionMessages = ctx.session.messages.length;
  ctx.addSystemMessage(
    `**Session Cost Estimate**\n\n` +
    `| Metric | Value |\n` +
    `|---|---|\n` +
    `| Model | ${ctx.provider}/${ctx.model} |\n` +
    `| Est. cost | ~$${costUsd.toFixed(2)} |\n` +
    `| Last input tokens | ${totalTokens.toLocaleString()} |\n` +
    `| Session tokens | ${ctx.session.totalTokens.toLocaleString()} |\n` +
    `| Messages | ${sessionMessages} |`
  );
}

export function handleStatusCommand(_arg: string, ctx: SlashCommandContext): void {
  const session = ctx.session;
  const msgCount = session.messages.length;
  const mode = ctx.permissionMode || "default";
  ctx.addSystemMessage(
    `**Session Status**\n\n` +
    `| Field | Value |\n` +
    `|---|---|\n` +
    `| Session ID | \`${session.id.slice(0, 8)}...\` |\n` +
    `| Provider / Model | ${ctx.provider}/${ctx.model} |\n` +
    `| Messages | ${msgCount} |\n` +
    `| Session tokens | ${session.totalTokens.toLocaleString()} |\n` +
    `| Cost | $${ctx.cost.toFixed(4)} |\n` +
    `| Mode | ${mode} |\n` +
    `| Working dir | \`${ctx.workingDir}\` |\n` +
    `| Started | ${session.startedAt} |`
  );
}

export function handleCompactCommand(arg: string, ctx: SlashCommandContext): void {
  if (!ctx.forceCompact) {
    ctx.addSystemMessage("Compaction not available.");
    return;
  }
  const msgCount = ctx.session.messages.length;
  if (msgCount <= 2 && ctx.tokens === 0) {
    ctx.addSystemMessage("Nothing to compact \u2014 conversation is empty.");
    return;
  }
  ctx.addSystemMessage(`**Compacting...** ~${ctx.tokens.toLocaleString()} tokens${arg ? ` (preserving: ${arg})` : ""}`);
  void ctx.forceCompact(arg || undefined).then(({ before, after }) => {
    ctx.addSystemMessage(`**Compacted.** ~${before.toLocaleString()} \u2192 ~${after.toLocaleString()} tokens.`);
  });
}

export function handleClearCommand(_arg: string, ctx: SlashCommandContext): void {
  const session = ctx.session;
  session.messages = [];
  session.totalTokens = 0;
  saveSession(session);
  ctx.addSystemMessage("Conversation cleared. Starting fresh.");
}

export function handleEditCommand(_arg: string, ctx: SlashCommandContext): void {
  const editor = process.env.EDITOR || process.env.VISUAL || "vi";
  const editorParts = splitEditorCommand(editor);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "workermill-"));
  const tmpFile = path.join(tmpDir, "input.md");
  try {
    fs.writeFileSync(tmpFile, "", "utf-8");
    execFileSync(editorParts[0] || "vi", [...editorParts.slice(1), tmpFile], {
      cwd: ctx.workingDir,
      stdio: "inherit",
      timeout: 5 * 60 * 1000,
    });
    const contents = fs.readFileSync(tmpFile, "utf-8").trim();
    if (contents) {
      ctx.addUserMessage(contents);
      ctx.submit(contents);
    } else {
      ctx.addSystemMessage("Editor closed with no content. Nothing submitted.");
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    ctx.addSystemMessage(`Failed to open editor (\`${editor}\`): ${errMsg}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function handleGitCommand(_arg: string, ctx: SlashCommandContext): void {
  const gitInfo = getGitStatus(ctx.workingDir);
  ctx.addSystemMessage(gitInfo);
}

export function handleDiffCommand(_arg: string, ctx: SlashCommandContext): void {
  try {
    const currentBr = execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null", {
      cwd: ctx.workingDir, encoding: "utf-8", timeout: 2000,
    }).trim();
    const isFeatureBranch = currentBr && currentBr !== "main" && currentBr !== "master";

    let baseBranch = "";
    if (isFeatureBranch) {
      try {
        execSync("git rev-parse --verify main 2>/dev/null", { cwd: ctx.workingDir, stdio: "pipe" });
        baseBranch = "main";
      } catch {
        try {
          execSync("git rev-parse --verify master 2>/dev/null", { cwd: ctx.workingDir, stdio: "pipe" });
          baseBranch = "master";
        } catch { /* neither exists */ }
      }
    }

    const diffRange = baseBranch ? `${baseBranch}..HEAD` : "";
    const diffStat = execSync(`git diff --stat ${diffRange} 2>/dev/null`, {
      cwd: ctx.workingDir, encoding: "utf-8", timeout: 5000,
    }).trim();
    const untracked = execSync("git ls-files --others --exclude-standard 2>/dev/null", {
      cwd: ctx.workingDir, encoding: "utf-8", timeout: 5000,
    }).trim();
    const diff = execSync(`git diff ${diffRange} 2>/dev/null`, {
      cwd: ctx.workingDir, encoding: "utf-8", timeout: 10000,
    }).trim();

    const parts: string[] = [];
    if (baseBranch) parts.push(`Comparing \`${currentBr}\` to \`${baseBranch}\``);
    if (diffStat) parts.push(`**Changes:**\n\`\`\`\n${diffStat}\n\`\`\``);
    if (untracked) parts.push(`**New files:**\n${untracked.split("\n").map(f => `- \`${f}\``).join("\n")}`);
    if (diff) {
      parts.push(`**Diff:**\n\`\`\`diff\n${diff}\n\`\`\``);
    }

    if (parts.length === 0) {
      ctx.addSystemMessage("No changes. Working tree is clean.");
    } else {
      ctx.addSystemMessage(parts.join("\n\n"));
    }
  } catch {
    ctx.addSystemMessage("Not a git repository, or git is not installed.");
  }
}

export function handleChangedCommand(_arg: string, ctx: SlashCommandContext): void {
  const changes = getChangedFiles();
  if (changes.length === 0) {
    ctx.addSystemMessage("No files changed in this session.");
  } else {
    const lines = changes.map(tc => `- \`${path.relative(ctx.workingDir, tc.path)}\` (${tc.tool}, ${new Date(tc.timestamp).toLocaleTimeString()})`);
    ctx.addSystemMessage(`**Changed Files** (${changes.length}):\n${lines.join("\n")}`);
  }
}

export function handleSessionsCommand(_arg: string, ctx: SlashCommandContext): void {
  const sessions = listSessions(20);
  if (sessions.length === 0) {
    ctx.addSystemMessage("No saved sessions found.");
  } else {
    const rows = sessions.map((s) => {
      const date = new Date(s.startedAt).toLocaleString();
      const name = s.name || s.preview;
      return `| \`${s.id.slice(0, 8)}\` | ${name} | ${s.messageCount} msgs | ${s.totalTokens.toLocaleString()} tokens | ${date} |`;
    });
    ctx.addSystemMessage(
      `**Recent Sessions** (${sessions.length})\n\n` +
      `| ID | Name | Messages | Tokens | Date |\n` +
      `|---|---|---|---|---|\n` +
      rows.join("\n")
    );
  }
}
