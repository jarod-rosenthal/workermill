/**
 * /permissions and /trust command handlers — extracted from slash-commands.ts
 */

import {
  loadConfig,
  loadProjectSettings,
  loadLocalSettings,
  saveProjectSettings,
  type PermissionRuleConfig,
} from "../../config.js";
import type { SlashCommandContext } from "../slash-commands.js";

export function handlePermissionsCommand(arg: string, ctx: SlashCommandContext): void {
  if (!arg) {
    const modeLabel = ctx.permissionMode || "default";
    const global = loadConfig();
    const pSettings = loadProjectSettings();
    const lSettings = loadLocalSettings();

    // Collect rules with sources
    const rules: Array<{ rule: string; type: "allow" | "ask" | "deny"; source: "global" | "project" | "local" }> = [];

    const addRules = (config: PermissionRuleConfig | null | undefined, source: "global" | "project" | "local") => {
      if (!config) return;
      config.allow?.forEach(rule => rules.push({ rule, type: "allow", source }));
      config.ask?.forEach(rule => rules.push({ rule, type: "ask", source }));
      config.deny?.forEach(rule => rules.push({ rule, type: "deny", source }));
    };

    addRules(global?.permissions, "global");
    addRules(pSettings, "project");
    addRules(lSettings, "local");

    const rulesInfo = rules.length > 0
      ? `\n\n**Rules (${rules.length}):**\n` +
        rules.map(r => `[${r.source}] ${r.type === "allow" ? "Allow" : r.type === "deny" ? "Deny" : "Ask"}: \`${r.rule}\``).join("\n")
      : "";

    ctx.addSystemMessage(
      `**Permission mode:** ${modeLabel} *(shift+tab to cycle)*\n\n` +
      "**Modes:** default \u2192 acceptEdits \u2192 plan \u2192 bypassPermissions\n\n" +
      "Commands:\n" +
      "- `/permissions allow <tool>` \u2014 allow a tool permanently (saved to project settings)\n" +
      "- `/permissions deny <tool>` \u2014 deny a tool permanently (saved to project settings)\n" +
      "- `/permissions reset` \u2014 reset to default mode\n\n" +
      "Approving a bash command with **Yes, don't ask again** saves a permanent rule (saved to local settings)." +
      rulesInfo
    );
  } else {
    const parts = arg.split(/\s+/);
    const action = parts[0];
    const toolName = parts[1];

    switch (action) {
      case "trust":
      case "bypass":
        ctx.setTrustAll(true);
        ctx.addSystemMessage("**bypassPermissions mode ON.** All tools auto-approved.");
        break;
      case "ask":
      case "default":
        ctx.setTrustAll(false);
        ctx.addSystemMessage("**default mode ON.** Tools require approval.");
        break;
      case "allow": {
        if (!toolName) {
          ctx.addSystemMessage("Usage: `/permissions allow <tool or pattern>`\n\nExamples:\n- `/permissions allow bash` \u2014 allow all bash\n- `/permissions allow bash(npm run *)` \u2014 allow npm run commands\n- `/permissions allow edit_file` \u2014 allow all file edits");
        } else {
          // Save to project settings
          const pSettings = loadProjectSettings() || {};
          pSettings.allow = pSettings.allow || [];
          if (!pSettings.allow.includes(toolName)) {
            pSettings.allow.push(toolName);
            saveProjectSettings(pSettings);
          }
          // Also add to session for immediate effect
          ctx.allowTool(toolName.split("(")[0]); // session set uses bare tool name
          ctx.addSystemMessage(`**Allowed** \`${toolName}\` \u2014 saved to project settings.`);
        }
        break;
      }
      case "deny": {
        if (!toolName) {
          ctx.addSystemMessage("Usage: `/permissions deny <tool or pattern>`");
        } else {
          // Save to project settings
          const pSettings = loadProjectSettings() || {};
          pSettings.deny = pSettings.deny || [];
          if (!pSettings.deny.includes(toolName)) {
            pSettings.deny.push(toolName);
            saveProjectSettings(pSettings);
          }
          ctx.denyTool(toolName.split("(")[0]);
          ctx.addSystemMessage(`**Denied** \`${toolName}\` \u2014 saved to project settings.`);
        }
        break;
      }
      case "reset":
        ctx.setTrustAll(false);
        ctx.addSystemMessage("**Permissions reset** to ask mode.");
        break;
      default:
        ctx.addSystemMessage("Unknown action. Use: trust, ask, allow, deny, reset");
    }
  }
}

export function handleTrustCommand(_arg: string, ctx: SlashCommandContext): void {
  ctx.setTrustAll(true);
  ctx.addSystemMessage(
    "**Trust mode ON.** All non-dangerous tool calls will be auto-approved for this session. " +
    "Dangerous operations (force push, rm -rf, etc.) still require confirmation."
  );
}
