import type { ActiveTask, CompletedTask } from "./types";
import { MODEL_OPTIONS } from "./types";

export function formatCost(
  cost: number | string | undefined | null,
): string {
  if (cost === undefined || cost === null) return "0.00";
  const num = Number(cost);
  if (isNaN(num)) return "0.00";
  return num.toFixed(2);
}

export function formatModelName(
  modelId: string | undefined | null,
): string {
  if (!modelId) return "Sonnet 4";
  const option = MODEL_OPTIONS.find((m) => m.value === modelId);
  if (option) return option.shortLabel;
  // Fallback parsing for any model ID format
  const lower = modelId.toLowerCase();
  // Anthropic models
  if (lower.includes("opus") && lower.includes("4-6")) return "Opus 4.6";
  if (lower.includes("opus")) return "Opus 4";
  if (lower.includes("haiku")) return "Haiku 4.5";
  if (lower.includes("sonnet") && lower.includes("3-5"))
    return "Sonnet 3.5";
  if (lower.includes("sonnet")) return "Sonnet 4";
  // Google/Gemini models
  if (lower.includes("gemini-2.5-pro")) return "Gemini 2.5 Pro";
  if (lower.includes("gemini-2.0-flash")) return "Gemini 2.0 Flash";
  if (lower.includes("gemini-3-pro")) return "Gemini 3 Pro";
  if (lower.includes("gemini")) return "Gemini";
  // OpenAI models
  if (lower.includes("gpt-4o")) return "GPT-4o";
  if (lower.includes("gpt-5")) return "GPT-5";
  if (lower.includes("o1-mini")) return "o1-mini";
  if (lower.includes("o1")) return "o1";
  if (lower.includes("o3")) return "o3";
  // Ollama/local models
  if (lower.includes("qwen")) return "Qwen";
  if (lower.includes("deepseek")) return "DeepSeek";
  if (lower.includes("llama")) return "Llama";
  if (lower.includes("mistral")) return "Mistral";
  return modelId;
}

export function formatProviderName(
  provider: string | undefined | null,
): { name: string; icon: string } {
  switch (provider) {
    case "anthropic":
      return { name: "Anthropic", icon: "\u{1F916}" };
    case "openai":
      return { name: "OpenAI", icon: "\u{1F537}" };
    case "google":
      return { name: "Gemini", icon: "\u{1F535}" };
    case "ollama":
      return { name: "Ollama", icon: "\u{1F3E0}" };
    default:
      // Default to Anthropic for backwards compatibility (null/undefined providers)
      return { name: "Anthropic", icon: "\u{1F916}" };
  }
}

/**
 * Derive provider from a model name string.
 * E.g., "gemini-2.5-pro" -> "google", "claude-sonnet-4" -> "anthropic"
 */
export function getProviderFromModel(
  modelName: string | undefined | null,
): string | null {
  if (!modelName) return null;
  const lower = modelName.toLowerCase();
  if (lower.includes("gemini") || lower.includes("palm")) return "google";
  if (
    lower.includes("gpt") ||
    lower.includes("o1") ||
    lower.includes("o3") ||
    lower.includes("codex")
  )
    return "openai";
  if (
    lower.includes("claude") ||
    lower.includes("haiku") ||
    lower.includes("sonnet") ||
    lower.includes("opus")
  )
    return "anthropic";
  if (
    lower.includes("llama") ||
    lower.includes("qwen") ||
    lower.includes("deepseek") ||
    lower.includes("mistral")
  )
    return "ollama";
  return null;
}

/**
 * Get all unique providers used by a task (planning, execution, review)
 * Returns deduplicated list in order of usage (planner first, then executor, then manager/reviewer)
 */
export function getDerivedProviders(
  task: ActiveTask | CompletedTask,
): string[] {
  const providers: string[] = [];
  const seen = new Set<string>();

  const addProvider = (p: string | null | undefined) => {
    if (p && !seen.has(p)) {
      seen.add(p);
      providers.push(p);
    }
  };

  // 1. Check planJson.metadata for planner model
  const plannerModel = task.planJson?.metadata?.plannerModel;
  if (plannerModel) {
    addProvider(getProviderFromModel(plannerModel));
  }

  // 2. Add explicit workerProvider or derive from workerModel
  if (task.workerProvider) {
    addProvider(task.workerProvider);
  } else if (task.workerModel) {
    addProvider(getProviderFromModel(task.workerModel));
  }

  // 3. Add manager/review provider if the task has been reviewed
  if (task.managerProvider) {
    addProvider(task.managerProvider);
  } else if (task.managerModel) {
    addProvider(getProviderFromModel(task.managerModel));
  }

  // If we still have nothing, default to anthropic
  if (providers.length === 0) {
    providers.push("anthropic");
  }

  return providers;
}

/**
 * Get all models used by a task in execution order (planner first, then worker)
 * Returns list of formatted model names
 */
export function getDerivedModels(
  task: ActiveTask | CompletedTask,
): string[] {
  const models: string[] = [];

  // 1. Planner model (from planJson.metadata)
  const plannerModel = task.planJson?.metadata?.plannerModel;
  if (plannerModel) {
    models.push(formatModelName(plannerModel));
  }

  // 2. Worker/execution model
  if (task.workerModel) {
    const workerModelName = formatModelName(task.workerModel);
    // Only add if different from planner model (avoid duplicates like "Sonnet 4 + Sonnet 4")
    if (
      models.length === 0 ||
      models[models.length - 1] !== workerModelName
    ) {
      models.push(workerModelName);
    }
  }

  return models;
}

// Parse a log for errors/warnings using structured severity field + pattern matching
export function parseLogForError(
  message: string,
  severity?: string,
  logType?: string,
): {
  type: "error" | "warning";
  category: string;
  message: string;
  file?: string;
  line?: number;
} | null {
  const msg = message.trim();

  // Filter out false positives - messages that look like success/info even if marked as error
  // Agent SDK sometimes marks success output as "error" severity due to stderr usage
  const successIndicators = [
    /^Perfect!/i,
    /^Great!/i,
    /^Excellent!/i,
    /^Done!/i,
    /^Success/i,
    /^Completed/i,
    /^\[.*?\]\s*(Perfect|Great|Excellent|Done|Success|Completed)/i,
    /Result:\s*(Perfect|Great|Excellent|Done|Success)/i,
    /successfully\s+(created|completed|implemented|added|updated|fixed)/i,
    /\u2713/, // Checkmark indicates success
    /\u2705/, // Green checkmark
  ];

  const isFalsePositive = successIndicators.some((pattern) =>
    pattern.test(msg),
  );
  if (isFalsePositive) {
    return null; // Not an error - it's a success message
  }

  // First, check structured severity field (most reliable)
  if (severity === "error" || logType === "error") {
    // Additional filter: require actual error indicators for severity-based errors
    // This prevents agent output (which may use stderr) from being flagged
    const hasErrorIndicator =
      msg.includes("Error") ||
      msg.includes("error") ||
      msg.includes("FAIL") ||
      msg.includes("fail") ||
      msg.includes("ECONNREFUSED") ||
      msg.includes("ETIMEDOUT") ||
      msg.includes("EACCES") ||
      msg.includes("Permission denied") ||
      msg.includes("fatal:") ||
      msg.includes("CONFLICT") ||
      /TS\d+/.test(msg) || // TypeScript error codes
      /npm ERR/i.test(msg);

    if (!hasErrorIndicator) {
      return null; // Severity says error but content doesn't look like an error
    }

    // Try to categorize based on message content
    // These are shown as warnings during execution - only "Task Failed" (added for exit code != 0) is a true error
    if (msg.includes("TS") && msg.match(/TS\d+/)) {
      return { type: "warning", category: "TypeScript", message: msg };
    }
    if (msg.includes("npm") || msg.includes("NPM")) {
      return { type: "warning", category: "npm", message: msg };
    }
    if (
      msg.includes("git") ||
      msg.includes("Git") ||
      msg.includes("CONFLICT")
    ) {
      return { type: "warning", category: "Git", message: msg };
    }
    if (
      msg.includes("ECONNREFUSED") ||
      msg.includes("ETIMEDOUT") ||
      msg.includes("fetch failed")
    ) {
      return { type: "warning", category: "Network", message: msg };
    }
    if (msg.includes("Permission denied") || msg.includes("EACCES")) {
      return { type: "warning", category: "Permission", message: msg };
    }
    // Generic warning from structured field
    return { type: "warning", category: "Warning", message: msg };
  }

  if (severity === "warning" || logType === "warning") {
    return { type: "warning", category: "Warning", message: msg };
  }

  // TypeScript issues: "error TS2307: Cannot find module" or "src/file.ts(42,5): error TS..."
  // These are warnings during execution - only "Task Failed" (from exit code != 0) is a true error
  const tsMatch = msg.match(
    /(?:(.+?)\((\d+),\d+\):\s*)?error\s+TS(\d+):\s*(.+)/i,
  );
  if (tsMatch) {
    return {
      type: "warning",
      category: "TypeScript",
      message: tsMatch[4],
      file: tsMatch[1],
      line: tsMatch[2] ? parseInt(tsMatch[2]) : undefined,
    };
  }

  // ESLint issues: "src/file.ts:42:5 - error: ..."
  const eslintMatch = msg.match(
    /(.+?):(\d+):\d+\s*-?\s*error[:\s]+(.+)/i,
  );
  if (eslintMatch && !msg.includes("TS")) {
    return {
      type: "warning",
      category: "ESLint",
      message: eslintMatch[3],
      file: eslintMatch[1],
      line: parseInt(eslintMatch[2]),
    };
  }

  // Git issues
  if (msg.includes("CONFLICT") || msg.includes("Merge conflict")) {
    const fileMatch = msg.match(
      /CONFLICT.*?:\s*(?:Merge conflict in\s+)?(.+)/,
    );
    return {
      type: "warning",
      category: "Git",
      message: msg,
      file: fileMatch?.[1]?.trim(),
    };
  }
  if (msg.includes("fatal:") && msg.toLowerCase().includes("git")) {
    return {
      type: "warning",
      category: "Git",
      message: msg.replace(/fatal:\s*/i, ""),
    };
  }

  // npm/node issues
  if (msg.includes("npm ERR!") || msg.includes("npm error")) {
    return {
      type: "warning",
      category: "npm",
      message: msg.replace(/npm ERR!\s*/i, ""),
    };
  }

  // Test failures (Jest, Vitest, pytest)
  if (
    msg.includes("FAIL") &&
    (msg.includes(".test.") ||
      msg.includes(".spec.") ||
      msg.includes("test_"))
  ) {
    const fileMatch = msg.match(
      /FAIL\s+(.+?\.(test|spec)\.[jt]sx?)/i,
    );
    return {
      type: "warning",
      category: "Test",
      message: "Test failed",
      file: fileMatch?.[1],
    };
  }
  if (
    msg.includes("AssertionError") ||
    (msg.includes("Expected") && msg.includes("Received"))
  ) {
    return {
      type: "warning",
      category: "Test",
      message: msg,
    };
  }

  // Generic [ERROR] markers - still warnings during execution
  if (msg.includes("[ERROR]")) {
    return {
      type: "warning",
      category: "Warning",
      message: msg.replace(/\[ERROR\]\s*/i, ""),
    };
  }

  // Python/general messages with "Error:" or "error:"
  if (
    (msg.includes("Error:") || msg.includes("error:")) &&
    !msg.includes("[worker]")
  ) {
    // Try to extract file:line pattern
    const pyMatch = msg.match(/File "(.+?)", line (\d+)/);
    if (pyMatch) {
      return {
        type: "warning",
        category: "Python",
        message: msg.split("\n")[0],
        file: pyMatch[1],
        line: parseInt(pyMatch[2]),
      };
    }
    return {
      type: "warning",
      category: "Warning",
      message: msg,
    };
  }

  // Warnings
  if (
    msg.includes("[WARN]") ||
    msg.includes("Warning:") ||
    msg.includes("warning:")
  ) {
    return {
      type: "warning",
      category: "Warning",
      message: msg.replace(/\[(WARN|Warning)\]:?\s*/i, ""),
    };
  }

  // Network/connection issues - warnings during execution
  if (
    msg.includes("ECONNREFUSED") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("fetch failed")
  ) {
    return {
      type: "warning",
      category: "Network",
      message: msg,
    };
  }

  // Permission issues - warnings during execution
  if (msg.includes("EACCES") || msg.includes("Permission denied")) {
    return {
      type: "warning",
      category: "Permission",
      message: msg,
    };
  }

  // Broad fallback: catch any line containing "Error" or "error" that terminal would color red
  // These are warnings during execution - only "Task Failed" (from exit code != 0) is a true error
  // Skip common false positives like "[worker]" prefixes and informational messages
  if (
    (msg.includes("Error") || msg.includes("ERROR")) &&
    !msg.includes("[worker]") &&
    !msg.includes("No errors") &&
    !msg.includes("0 errors") &&
    !msg.includes("error free") &&
    !msg.toLowerCase().includes("without error")
  ) {
    return {
      type: "warning",
      category: "Warning",
      message: msg,
    };
  }

  return null;
}
