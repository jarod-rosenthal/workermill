#!/usr/bin/env npx ts-node

/**
 * Build and push a container image using Kaniko (daemon-less, works in Fargate)
 *
 * Inputs (environment variables):
 * - DOCKERFILE_PATH: Optional. Path to Dockerfile (defaults to "./Dockerfile")
 * - CONTEXT_DIR: Optional. Build context directory (defaults to ".")
 * - IMAGE_NAME: Required. Full image name including registry (e.g., "593971626975.dkr.ecr.us-east-1.amazonaws.com/oncallshift-dev/backend:latest")
 * - BUILD_ARGS: Optional. Comma-separated build args (e.g., "NODE_ENV=production,VERSION=1.0.0")
 * - AWS_REGION: Optional. AWS region for ECR auth (defaults to us-east-1)
 * - CACHE_REPO: Optional. ECR repo for layer caching
 *
 * Outputs (JSON to stdout):
 * - success: boolean
 * - imageName: string
 * - digest?: string
 * - error?: string
 */

import { execSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

interface Output {
  success: boolean;
  imageName?: string;
  digest?: string;
  error?: string;
}

function exec(cmd: string, cwd?: string): string {
  console.error(`[build_container] Running: ${cmd}`);
  return execSync(cmd, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large outputs
  }).trim();
}

async function main(): Promise<void> {
  const output: Output = { success: false };

  try {
    const dockerfilePath = process.env.DOCKERFILE_PATH || "./Dockerfile";
    const contextDir = process.env.CONTEXT_DIR || ".";
    const imageName = process.env.IMAGE_NAME;
    const buildArgs = process.env.BUILD_ARGS || "";
    const region = process.env.AWS_REGION || "us-east-1";
    const cacheRepo = process.env.CACHE_REPO;

    if (!imageName) {
      throw new Error("IMAGE_NAME environment variable is required");
    }

    output.imageName = imageName;

    // Verify Dockerfile exists
    const absoluteDockerfile = path.resolve(contextDir, dockerfilePath);
    if (!fs.existsSync(absoluteDockerfile)) {
      throw new Error(`Dockerfile not found: ${absoluteDockerfile}`);
    }

    // Extract ECR registry from image name for authentication
    const registryMatch = imageName.match(/^(\d+\.dkr\.ecr\.[^/]+\.amazonaws\.com)/);
    if (!registryMatch) {
      throw new Error(`Invalid ECR image name format: ${imageName}. Expected format: ACCOUNT.dkr.ecr.REGION.amazonaws.com/repo:tag`);
    }
    const registry = registryMatch[1];

    // Configure ECR authentication for Kaniko
    console.error(`[build_container] Configuring ECR authentication for ${registry}`);

    // Get ECR login token
    const ecrToken = exec(`aws ecr get-login-password --region ${region}`);

    // Create Kaniko docker config
    const kanikoConfigDir = "/kaniko/.docker";
    if (!fs.existsSync(kanikoConfigDir)) {
      fs.mkdirSync(kanikoConfigDir, { recursive: true });
    }

    const dockerConfig = {
      auths: {
        [registry]: {
          auth: Buffer.from(`AWS:${ecrToken}`).toString("base64"),
        },
      },
    };

    fs.writeFileSync(
      path.join(kanikoConfigDir, "config.json"),
      JSON.stringify(dockerConfig)
    );
    console.error(`[build_container] ECR authentication configured`);

    // Ensure ECR repository exists
    const repoName = imageName.replace(registry + "/", "").split(":")[0];
    console.error(`[build_container] Ensuring ECR repository exists: ${repoName}`);
    try {
      exec(`aws ecr describe-repositories --repository-names ${repoName} --region ${region}`);
    } catch {
      console.error(`[build_container] Creating ECR repository: ${repoName}`);
      exec(`aws ecr create-repository --repository-name ${repoName} --region ${region}`);
    }

    // Build Kaniko command
    // Note: These flags help avoid permission issues when running as non-root in Fargate:
    // --use-new-run: Uses new run implementation that's more compatible with non-root
    // --ignore-path: Excludes paths that cause permission issues
    // --force: Continue build despite non-fatal errors
    const kanikoArgs: string[] = [
      "--context", path.resolve(contextDir),
      "--dockerfile", absoluteDockerfile,
      "--destination", imageName,
      "--verbosity", "info",
      "--use-new-run",  // Better compatibility with non-root execution
      "--ignore-path", "/kaniko",  // Don't include kaniko directory in snapshots
      "--ignore-path", "/var/run",  // Common problematic path
      "--force",  // Continue despite non-fatal errors
    ];

    // Add build args
    if (buildArgs) {
      for (const arg of buildArgs.split(",")) {
        kanikoArgs.push("--build-arg", arg.trim());
      }
    }

    // Add cache configuration if specified
    if (cacheRepo) {
      kanikoArgs.push("--cache=true");
      kanikoArgs.push("--cache-repo", cacheRepo);
    }

    console.error(`[build_container] Building image: ${imageName}`);
    console.error(`[build_container] Context: ${contextDir}`);
    console.error(`[build_container] Dockerfile: ${dockerfilePath}`);

    // Run Kaniko
    const result = spawnSync("/kaniko/executor", kanikoArgs, {
      cwd: contextDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 50 * 1024 * 1024,
    });

    if (result.status !== 0) {
      console.error(`[build_container] Kaniko stderr: ${result.stderr}`);
      throw new Error(`Kaniko build failed: ${result.stderr || result.stdout}`);
    }

    console.error(`[build_container] Kaniko stdout: ${result.stdout}`);

    // Try to extract digest from output
    const digestMatch = (result.stdout + result.stderr).match(/digest:\s*(sha256:[a-f0-9]+)/i);
    if (digestMatch) {
      output.digest = digestMatch[1];
    }

    output.success = true;
    console.error(`[build_container] Successfully built and pushed: ${imageName}`);
  } catch (error: unknown) {
    output.error = error instanceof Error ? error.message : String(error);
    console.error(`[build_container] Error: ${output.error}`);
  }

  console.log(JSON.stringify(output));

  // Output markers for orchestrator
  if (output.success) {
    console.error(`::result::container_built`);
    console.error(`::image::${output.imageName}`);
    if (output.digest) {
      console.error(`::digest::${output.digest}`);
    }
  }

  process.exit(output.success ? 0 : 1);
}

main();
