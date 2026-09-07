import { activeShells } from "./bash-background.js";

export const name = "bash_kill";

export const description =
  "Terminate a background shell process and its entire process group.";

export const parameters = {
  type: "object" as const,
  properties: {
    shellId: {
      type: "string" as const,
      description: "The shell ID returned by bash_background",
    },
    signal: {
      type: "string" as const,
      enum: ["SIGTERM", "SIGKILL"] as const,
      description: "Signal to send (default: SIGTERM)",
    },
  },
  required: ["shellId"] as const,
};

interface BashKillParams {
  shellId: string;
  signal?: "SIGTERM" | "SIGKILL";
  /** When supplied, only the owning run may cancel the shell. */
  runId?: string;
}

interface BashKillResult {
  killed: boolean;
}

export async function execute({
  shellId,
  signal = "SIGTERM",
  runId,
}: BashKillParams): Promise<BashKillResult> {
  const shell = activeShells.get(shellId);
  if (!shell || (runId && shell.runId !== runId)) {
    return { killed: false };
  }

  if (!shell.done) {
    shell.controller.abort();
    // The shared runner owns TERM -> KILL and process-group cleanup. SIGKILL
    // remains a compatibility hint; cancellation still follows that boundary.
    if (signal === "SIGKILL") shell.controller.abort();
  }

  return { killed: true };
}
