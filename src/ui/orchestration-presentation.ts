import type { UsageSummary } from "../cost-tracker.js";

export const SESSION_SUMMARY_DIVIDER = "────────────────────────";

// ---------------------------------------------------------------------------
// Persona emoji map -- EXACT match from tui.ts (PERSONA_EMOJIS)
// Presentation stays independent of React and chalk/tui.
// ---------------------------------------------------------------------------

const PERSONA_EMOJIS: Record<string, string> = {
  // Must match worker/epic/experts.ts — no invented personas
  frontend_developer: "\u{1F3A8}",   // 🎨
  backend_developer: "\u{1F4BB}",    // 💻
  devops_engineer: "\u{1F527}",      // 🔧
  security_engineer: "\u{1F512}",    // 🔐
  qa_engineer: "\u{1F9EA}",          // 🧪
  tech_writer: "\u{1F4DD}",          // 📝
  project_manager: "\u{1F4CB}",      // 📋
  architect: "\u{1F3D7}\uFE0F",      // 🏗️
  data_ml_engineer: "\u{1F4CA}",     // 📊
  mobile_developer: "\u{1F4F1}",     // 📱
  tech_lead: "\u{1F451}",            // 👑
  manager: "\u{1F454}",              // 👔
  support_agent: "\u{1F4AC}",        // 💬
  // CLI-specific roles (used by orchestrator, not in worker expert configs)
  planner: "\u{1F4A1}",              // 💡
  coordinator: "\u{1F3AF}",          // 🎯
  critic: "\u{1F50D}",               // 🔍
  reviewer: "\u{1F50D}",             // 🔍
};

export function getEmoji(persona: string): string {
  return PERSONA_EMOJIS[persona] || "\u{1F916}"; // 🤖
}

function formatTokenCount(tokens: number): string {
  return tokens.toLocaleString();
}

export function formatCost(cost: number): string {
  if (cost <= 0) return "$0.00";
  if (cost < 0.01) return "<$0.01";
  return `~$${cost.toFixed(2)}`;
}

export function formatModelBreakdown(summary: UsageSummary): string {
  if (summary.byModel.length === 0) return "";

  const lines: string[] = [];
  // Sort by cost descending so the most expensive model is first
  const sorted = [...summary.byModel].sort((a, b) => b.cost - a.cost);
  for (const model of sorted) {
    if (model.inputTokens <= 0 && model.outputTokens <= 0) continue;
    lines.push(`  ${model.provider}/${model.model}: ${formatTokenCount(model.inputTokens)} in · ${formatTokenCount(model.outputTokens)} out · ${formatCost(model.cost)}`);
  }
  return lines.join("\n");
}

export function addSessionSummaryDivider(
  addMessage: (message: string) => void,
  hasOperationalOutput: boolean,
): void {
  if (!hasOperationalOutput) return;
  addMessage(SESSION_SUMMARY_DIVIDER);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

function describeEditOperation(oldText: string, newText: string): "insert" | "delete" | "replace" | "noop" {
  if (!oldText && newText) return "insert";
  if (oldText && !newText) return "delete";
  if (oldText === newText) return "noop";
  return "replace";
}

function summarizePatch(patchText: string): { files: number; hunks: number; firstTarget: string } {
  const hunks = (patchText.match(/^@@/gm) || []).length;
  const targets = [...patchText.matchAll(/^\+\+\+\s+(?:[ab]\/)?(.+)$/gm)]
    .map((m) => m[1].trim())
    .filter((target) => target && target !== "/dev/null");
  const uniqueTargets = [...new Set(targets)];
  return {
    files: uniqueTargets.length,
    hunks,
    firstTarget: uniqueTargets[0] || "",
  };
}

/** Build a compact, differentiating tool detail so repeated edits are visibly distinct. */
export function formatToolCallDetail(
  toolName: string,
  toolInput: Record<string, unknown>,
  nextFileSequence?: (path: string) => number,
): string {
  const filePath = asString(toolInput.file_path) || asString(toolInput.path);
  const nextSeqFor = (path: string): string => {
    if (!nextFileSequence) return "";
    const n = nextFileSequence(path);
    return n > 0 ? `#${n} ` : "";
  };

  if (toolName === "edit_file") {
    const oldText = asString(toolInput.old_string);
    const newText = asString(toolInput.new_string);
    const replaceAll = toolInput.replaceAll === true ? " x*" : "";
    if (oldText || newText) {
      const seq = nextSeqFor(filePath);
      const op = describeEditOperation(oldText, newText);
      const bytes = `${oldText.length}->${newText.length}b`;
      const lines = `${countLines(oldText)}->${countLines(newText)}l`;
      return `${filePath}${filePath ? " " : ""}[${seq}${op} ${bytes} ${lines}${replaceAll}]`;
    }
    if (filePath) return filePath;
  }

  if (toolName === "write_file") {
    const content = asString(toolInput.content);
    if (content) {
      const seq = nextSeqFor(filePath);
      return `${filePath}${filePath ? " " : ""}[${seq}write ${content.length}b ${countLines(content)}l]`;
    }
    if (filePath) return filePath;
  }

  if (toolName === "patch") {
    const patchText = asString(toolInput.patch_text);
    if (patchText) {
      const { files, hunks, firstTarget } = summarizePatch(patchText);
      const target = firstTarget || filePath;
      const seq = target ? nextSeqFor(target) : "";
      return `${target}${target ? " " : ""}[${seq}${files || 1}f ${hunks}h patch]`;
    }
    if (filePath) return filePath;
  }

  // Generic display fallback across all tools.
  if (filePath) return filePath;
  if (toolInput.command) {
    const cmd = String(toolInput.command);
    return cmd.length > 120 ? cmd.slice(0, 117) + "..." : cmd;
  }
  if (toolInput.query) return String(toolInput.query).slice(0, 120);
  if (toolInput.prompt) return String(toolInput.prompt).slice(0, 120);
  if (toolInput.pattern) return `pattern: ${String(toolInput.pattern)}`;
  if (toolInput.url) return String(toolInput.url);
  if (toolInput.action) return String(toolInput.action);

  const keys = Object.keys(toolInput).slice(0, 3);
  if (keys.length > 0) {
    return keys.map(k => `${k}: ${String(toolInput[k]).slice(0, 80)}`).join(", ");
  }
  return "";
}
