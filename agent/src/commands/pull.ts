/**
 * Pull Command — Pull the latest worker Docker image.
 */

import chalk from "chalk";
import { spawnSync, execSync } from "child_process";
import { existsSync } from "fs";
import { loadConfigFromFile, getConfigFile } from "../config.js";
import { initApi, api } from "../api.js";

/**
 * Extract ECR registry hostname from a Docker image URL.
 * Returns null if the image is not from ECR.
 */
function extractEcrRegistry(imageUrl: string): string | null {
  const match = imageUrl.match(/^(\d+\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com)/);
  return match ? match[1] : null;
}

export async function pullCommand(): Promise<void> {
  if (!existsSync(getConfigFile())) {
    console.log(chalk.red("  No config found. Run 'workermill-agent setup' first."));
    process.exit(1);
  }

  const config = loadConfigFromFile();
  let workerImage = config.workerImage;

  // Fetch latest image URL from server (overrides local config)
  try {
    initApi(config.apiUrl, config.apiKey);
    const { data } = await api.get("/api/agent/config");
    if (data.workerImageUrl) {
      workerImage = data.workerImageUrl;
    }
  } catch {
    console.log(chalk.yellow("  ⚠ Could not fetch server config — using local image setting"));
  }

  // Authenticate to private ECR if the image is from ECR
  const ecrRegistry = extractEcrRegistry(workerImage);
  if (ecrRegistry) {
    console.log(chalk.dim("  Authenticating to private ECR..."));
    const regionMatch = ecrRegistry.match(/\.ecr\.([a-z0-9-]+)\.amazonaws\.com/);
    const region = regionMatch ? regionMatch[1] : "us-east-1";
    try {
      execSync(
        `aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${ecrRegistry}`,
        { stdio: "pipe", timeout: 30_000 },
      );
    } catch {
      console.log(chalk.red("  ✗ ECR authentication failed."));
      console.log(chalk.yellow("  Ensure AWS CLI is configured: aws configure"));
      process.exit(1);
    }
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
