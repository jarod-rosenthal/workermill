/**
 * Log level color classification for terminal log viewers.
 * Returns both a text color class and a box-shadow color for the left edge indicator.
 *
 * Uses inset box-shadow (not border) for the left edge — box-shadow doesn't affect
 * layout, so it performs better during scroll (no reflow).
 *
 * Pattern inspired by Trigger.dev's LogsTable.tsx.
 */

interface LogColorResult {
  /** Tailwind text color class */
  textClass: string;
  /** CSS box-shadow value for 2px left edge indicator */
  boxShadow: string;
}

interface LogInput {
  message: string;
  severity?: string;
  logType?: string;
  metadata?: {
    errorType?: "fatal" | "recoverable";
    [key: string]: unknown;
  };
}

// Pre-compiled regexes for performance (called per log line)
const PERSONA_PREFIX = /^\[.+\s+\w+\s+.+\]/; // [emoji persona providerIcon]
const STACK_TRACE = /^\s+at\s+|^Error:|^TypeError:|^RangeError:|^SyntaxError:/;

export function getLogColor(log: LogInput): LogColorResult {
  const msg = log.message;
  const isFatalError = log.metadata?.errorType === "fatal";
  const isError =
    log.severity === "error" ||
    log.logType === "error" ||
    msg.includes("[ERROR]") ||
    STACK_TRACE.test(msg);

  // Fatal errors — bright red
  if (isError && isFatalError) {
    return {
      textClass: "text-red-400",
      boxShadow: "inset 2px 0 0 0 rgb(239, 68, 68)",
    };
  }

  // Blockers — red
  if (msg.includes("[BLOCKER]") || msg.includes("escalat")) {
    return {
      textClass: "text-red-400",
      boxShadow: "inset 2px 0 0 0 rgb(239, 68, 68)",
    };
  }

  // Non-fatal errors — muted orange
  if (isError) {
    return {
      textClass: "text-orange-300/70",
      boxShadow: "inset 2px 0 0 0 rgb(251, 146, 60)",
    };
  }

  // Warnings — amber
  if (
    log.severity === "warning" ||
    log.logType === "warning" ||
    msg.includes("[WARN]") ||
    msg.includes("Warning")
  ) {
    return {
      textClass: "text-yellow-400",
      boxShadow: "inset 2px 0 0 0 rgb(234, 179, 8)",
    };
  }

  // Quality checks — purple
  if (msg.includes("[quality-runner]") || msg.includes("QUALITY")) {
    return {
      textClass: "text-purple-400",
      boxShadow: "inset 2px 0 0 0 rgb(139, 92, 246)",
    };
  }

  // Review events — indigo
  if (msg.includes("REVIEW_DECISION") || msg.includes("[tech_lead]")) {
    return {
      textClass: "text-indigo-400",
      boxShadow: "inset 2px 0 0 0 rgb(99, 102, 241)",
    };
  }

  // System events — blue
  if (
    msg.includes("[Epic]") ||
    msg.includes("[Executor]") ||
    msg.includes("[GitOps]") ||
    msg.includes("[Coordinator]") ||
    msg.includes("[Consolidation]")
  ) {
    return {
      textClass: "text-blue-400",
      boxShadow: "inset 2px 0 0 0 rgb(59, 130, 246)",
    };
  }

  // Success messages — green
  if (
    msg.includes("[SUCCESS]") ||
    msg.includes("Completed") ||
    msg.includes("success")
  ) {
    return {
      textClass: "text-green-400",
      boxShadow: "inset 2px 0 0 0 rgb(34, 197, 94)",
    };
  }

  // Persona prefix (expert activity) — teal
  if (PERSONA_PREFIX.test(msg)) {
    return {
      textClass: "text-teal-400",
      boxShadow: "inset 2px 0 0 0 rgb(20, 184, 166)",
    };
  }

  // Worker/startup messages — cyan
  if (
    msg.includes("[worker]") ||
    msg.includes("Claude") ||
    msg.includes("Starting")
  ) {
    return {
      textClass: "text-cyan-400",
      boxShadow: "inset 2px 0 0 0 rgb(34, 211, 238)",
    };
  }

  // Commands — purple
  if (msg.startsWith("$") || msg.includes("npm ") || msg.includes("git ")) {
    return {
      textClass: "text-purple-400",
      boxShadow: "inset 2px 0 0 0 rgb(139, 92, 246)",
    };
  }

  // Default — slate
  return {
    textClass: "text-gray-300",
    boxShadow: "inset 2px 0 0 0 rgb(148, 163, 184)",
  };
}
