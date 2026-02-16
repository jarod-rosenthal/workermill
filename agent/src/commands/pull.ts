/**
 * Pull Command — No longer needed (Docker removed).
 *
 * Workers now run as native Node.js processes bundled with the agent package.
 * Update the agent with: workermill-agent update
 */

import chalk from "chalk";

export async function pullCommand(): Promise<void> {
  console.log();
  console.log(chalk.yellow("  The 'pull' command is no longer needed."));
  console.log();
  console.log(chalk.dim("  Workers now run as native Node.js processes — no Docker image required."));
  console.log(chalk.dim("  To update the agent: workermill-agent update"));
  console.log();
}
