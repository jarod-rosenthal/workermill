/**
 * Build and push Docker image using Kaniko
 *
 * Kaniko allows building Docker images without requiring Docker daemon,
 * making it perfect for ECS Fargate containers.
 *
 * Environment variables:
 * - DOCKER_REGISTRY: ECR registry URL (e.g., AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/app)
 * - DOCKERFILE_PATH: Path to Dockerfile (default: ./Dockerfile)
 * - BUILD_CONTEXT: Build context path (default: .)
 * - IMAGE_TAG: Tag for the image (default: git short SHA)
 * - AWS_REGION: AWS region for ECR (default: us-east-1)
 */

import { execSync, spawnSync } from "child_process";
import { existsSync } from "fs";
import path from "path";

const registry = process.env.DOCKER_REGISTRY;
const dockerfile = process.env.DOCKERFILE_PATH || "./Dockerfile";
const context = process.env.BUILD_CONTEXT || ".";
const region = process.env.AWS_REGION || "us-east-1";

// Get image tag from env or git SHA
let tag = process.env.IMAGE_TAG;
if (!tag) {
  try {
    tag = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    tag = `build-${Date.now()}`;
  }
}

if (!registry) {
  console.error("ERROR: DOCKER_REGISTRY environment variable not set");
  console.error("Example: AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/myapp");
  process.exit(1);
}

// Resolve dockerfile path
const resolvedDockerfile = path.resolve(context, dockerfile);
if (!existsSync(resolvedDockerfile)) {
  console.error(`ERROR: Dockerfile not found at ${resolvedDockerfile}`);
  process.exit(1);
}

const destination = `${registry}:${tag}`;
const latestDestination = `${registry}:latest`;

console.log("=== Kaniko Docker Build ===");
console.log(`Registry: ${registry}`);
console.log(`Dockerfile: ${resolvedDockerfile}`);
console.log(`Context: ${context}`);
console.log(`Tag: ${tag}`);
console.log(`Destination: ${destination}`);
console.log("");

// Configure ECR credentials for Kaniko
// Kaniko's ECR credential helper uses the AWS SDK, which picks up task role credentials
const dockerConfigDir = "/kaniko/.docker";
const dockerConfigPath = `${dockerConfigDir}/config.json`;

// Create docker config with ECR credential helper
const dockerConfig = {
  credHelpers: {
    [`${registry.split("/")[0]}`]: "ecr-login",
  },
};

try {
  execSync(`mkdir -p ${dockerConfigDir}`, { stdio: "inherit" });
  execSync(
    `echo '${JSON.stringify(dockerConfig)}' > ${dockerConfigPath}`,
    { stdio: "inherit" }
  );
  console.log("ECR credential helper configured");
} catch (error) {
  console.warn("Warning: Could not configure ECR credentials, using default auth");
}

// Build Kaniko command
const kanikoArgs = [
  `/kaniko/executor`,
  `--dockerfile=${resolvedDockerfile}`,
  `--context=${path.resolve(context)}`,
  `--destination=${destination}`,
  `--destination=${latestDestination}`,
  `--cache=true`,
  `--cache-ttl=168h`, // 7 days cache
  `--snapshot-mode=redo`,
  `--use-new-run`,
];

console.log("Running Kaniko build...");
console.log(`Command: ${kanikoArgs.join(" ")}`);
console.log("");

const result = spawnSync(kanikoArgs[0], kanikoArgs.slice(1), {
  stdio: "inherit",
  env: {
    ...process.env,
    AWS_REGION: region,
  },
});

if (result.status !== 0) {
  console.error("");
  console.error("ERROR: Kaniko build failed");
  if (result.error) {
    console.error("Error:", result.error.message);
  }
  process.exit(result.status || 1);
}

console.log("");
console.log("=== Build Complete ===");
console.log(`Successfully pushed: ${destination}`);
console.log(`Successfully pushed: ${latestDestination}`);
console.log("");
console.log(`::image_pushed::${destination}`);
console.log(`::image_tag::${tag}`);
