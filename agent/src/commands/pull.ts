/**
 * Pull Command — Pull/update the Docker sandbox image.
 *
 * When Docker sandbox mode is enabled, pulls the worker image from the registry.
 * When sandbox mode is not enabled, informs the user.
 */

import chalk from "chalk";
import { existsSync } from "fs";
import { loadConfigFromFile, getConfigFile } from "../config.js";

export async function pullCommand(): Promise<void> {
  console.log();

  if (!existsSync(getConfigFile())) {
    console.log(chalk.red("No configuration found."));
    console.log(`Run ${chalk.cyan("workermill-agent setup")} first.`);
    process.exit(1);
  }

  const config = loadConfigFromFile();

  if (config.sandbox !== "docker") {
    console.log(chalk.yellow("  Docker sandbox mode is not enabled."));
    console.log();
    console.log(
      chalk.dim(
        '  To enable, add "sandbox": "docker" to ~/.workermill/config.json',
      ),
    );
    console.log(chalk.dim("  or re-run: workermill-agent setup"));
    console.log();
    return;
  }

  console.log(chalk.dim("  Pulling Docker sandbox image..."));
  console.log();

  try {
    const { ensureImage } = await import("../docker-spawner.js");
    const imageTag = await ensureImage(config);
    console.log();
    console.log(chalk.green(`  ✓ Image ready: ${imageTag}`));
  } catch (err) {
    console.log();
    console.log(
      chalk.red(
        `  ✗ ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    process.exit(1);
  }

  console.log();
}
