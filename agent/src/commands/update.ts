import chalk from "chalk";
import { AGENT_VERSION } from "../version.js";
import { selfUpdate } from "../updater.js";

export async function updateCommand(): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan("  WorkerMill Agent Update"));
  console.log(chalk.dim("  ─────────────────────────────────────"));
  console.log(`  ${chalk.dim("Current version:")} ${AGENT_VERSION}`);
  console.log();

  const success = await selfUpdate();

  if (success) {
    console.log();
    console.log(chalk.green("  Update complete. If the agent is running, restart it to use the new version."));
  } else {
    console.log();
    console.error(chalk.red("  Update failed. Try downloading the latest release from https://github.com/workermill/workermill/releases"));
    process.exitCode = 1;
  }
}
