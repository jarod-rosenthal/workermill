import { activeShells } from "./bash-background.js";

export const name = "bash_output";

export const description =
  "Retrieve accumulated output from a background shell. Optionally wait for the process to exit.";

export const parameters = {
  type: "object" as const,
  properties: {
    shellId: {
      type: "string" as const,
      description: "The shell ID returned by bash_background",
    },
    wait: {
      type: "boolean" as const,
      description: "Whether to wait for the process to exit (optional)",
    },
  },
  required: ["shellId"] as const,
};

interface BashOutputParams {
  shellId: string;
  wait?: boolean;
}

interface BashOutputResult {
  output: string;
  done: boolean;
  exitCode?: number;
  status: 'running' | 'done' | 'killed' | 'failed_to_start';
}

export async function execute({
  shellId,
  wait,
}: BashOutputParams): Promise<BashOutputResult> {
  const shell = activeShells.get(shellId);
  if (!shell) {
    throw new Error(`Shell ${shellId} not found`);
  }

  // Auto-cleanup shells that have been done for more than 10 minutes
  if (shell.done && shell.completionTime && Date.now() - shell.completionTime > 10 * 60 * 1000) {
    activeShells.delete(shellId);
    return {
      output: shell.buffer.join('\n'),
      done: true,
      exitCode: shell.exitCode,
      status: shell.status,
    };
  }

  if (wait && !shell.done) {
    await new Promise<void>((resolve) => {
      const checkDone = () => {
        if (shell.done) {
          resolve();
        } else {
          setTimeout(checkDone, 100);
        }
      };
      checkDone();
    });
  }

  return {
    output: shell.buffer.join('\n'),
    done: shell.done,
    exitCode: shell.exitCode,
    status: shell.status,
  };
}