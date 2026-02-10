import { spawn } from "child_process";
import chalk from "chalk";

/**
 * Run `npm install -g @workermill/agent@latest` and return whether it succeeded.
 */
export async function selfUpdate(): Promise<boolean> {
  console.log(chalk.cyan("  Updating @workermill/agent..."));

  return new Promise((resolve) => {
    const child = spawn("npm", ["install", "-g", "@workermill/agent@latest"], {
      stdio: "inherit",
      shell: true,
    });

    child.on("error", (err) => {
      console.error(chalk.red(`  Update failed: ${err.message}`));
      resolve(false);
    });

    child.on("close", (code) => {
      if (code === 0) {
        console.log(chalk.green("  Update successful."));
        resolve(true);
      } else {
        console.error(chalk.red(`  Update failed with exit code ${code}`));
        resolve(false);
      }
    });
  });
}

/**
 * Restart the current process by spawning a new one and exiting.
 */
export function restartAgent(): never {
  console.log(chalk.cyan("  Restarting agent..."));

  const child = spawn(process.argv[0], process.argv.slice(1), {
    stdio: "inherit",
    detached: true,
  });

  child.unref();
  process.exit(0);
}
