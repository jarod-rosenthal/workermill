/**
 * Pull Command — Pull the latest worker Docker image.
 */

import chalk from "chalk";
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { loadConfigFromFile, getConfigFile } from "../config.js";

export async function pullCommand(): Promise<void> {
  let workerImage = "public.ecr.aws/a7k5r0v0/workermill-worker:latest";

  // Use configured image if config exists
  if (existsSync(getConfigFile())) {
    const config = loadConfigFromFile();
    workerImage = config.workerImage || workerImage;
  }

  console.log();
  console.log(chalk.dim(`  Pulling worker image: ${workerImage}`));
  console.log(chalk.dim("  This may take a few minutes..."));
  console.log();

  const result = spawnSync("docker", ["pull", workerImage], {
    stdio: "inherit",
    timeout: 600_000,
  });

  console.log();
  if (result.status === 0) {
    console.log(chalk.green(`  ✓ Worker image updated`));
  } else {
    console.log(chalk.red("  ✗ Failed to pull worker image."));
    if (result.error) {
      console.log(chalk.yellow(`  Error: ${result.error.message}`));
    }
    console.log(chalk.yellow("  Is Docker Desktop running?"));
    process.exit(1);
  }
}
