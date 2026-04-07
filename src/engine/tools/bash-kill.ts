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
}

interface BashKillResult {
  killed: boolean;
}

export async function execute({
  shellId,
  signal = "SIGTERM",
}: BashKillParams): Promise<BashKillResult> {
  const shell = activeShells.get(shellId);
  if (!shell) {
    return { killed: false };
  }

  if (!shell.done) {
    try {
      // Kill the process group since it was spawned detached
      process.kill(-shell.child.pid!, signal);
      shell.status = 'killed';
      shell.done = true;
    } catch (err) {
      // Process might already be dead
    }
  }

  // Remove from registry
  activeShells.delete(shellId);

  return { killed: true };
}